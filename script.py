from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import time
import numpy as np
import pandas as pd
import os
import sys
import threading
import urllib.request
from typing import Optional, Dict
import json
from scipy.interpolate import RegularGridInterpolator
from scipy.stats import iqr


def get_resource_path(relative_path):
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)

print("--- INITIALIZING TWO-STAGE PINPOINT & ERROR MODULE PIPELINE ---")

# 1. Load Datasets
master = pd.read_csv(get_resource_path('Master_Suitability_S.csv'))
c1 = pd.read_csv(get_resource_path('C1.csv'))
c2 = pd.read_csv(get_resource_path('C2.csv'))
c3 = pd.read_csv(get_resource_path('C3.csv'))
c4 = pd.read_csv(get_resource_path('C4.csv'))
c5 = pd.read_csv(get_resource_path('C5.csv'))

df_full = master.merge(c1, on=['body', 'lat', 'lon'], suffixes=('', '_c1'))
for df_comp in [c2, c3, c4, c5]:
    df_full = df_full.merge(df_comp, on=['body', 'lat', 'lon'], suffixes=('', '_dup'))
df_full = df_full.loc[:, ~df_full.columns.str.endswith('_dup')]

# Area-weighted quantile calculation for Earth land threshold (29.2% subaerial continental land)
earth_mask_raw = df_full['body'] == 'Earth'
earth_elev = df_full.loc[earth_mask_raw, 'u_elevation'].values
earth_lats = df_full.loc[earth_mask_raw, 'lat'].values
weights_lat = np.cos(np.radians(earth_lats))

def weighted_quantile(values, quantiles, sample_weight=None):
    values = np.array(values)
    quantiles = np.array(quantiles)
    if sample_weight is None: sample_weight = np.ones(len(values))
    sorter = np.argsort(values)
    values = values[sorter]
    sample_weight = sample_weight[sorter]
    wq = (np.cumsum(sample_weight) - 0.5 * sample_weight) / np.sum(sample_weight)
    return np.interp(quantiles, wq, values)

earth_land_thresh = weighted_quantile(earth_elev, [1.0 - 0.292], sample_weight=weights_lat)[0]

# Construct water_mask, ndvi proxies, and derived indices
df_full['water_mask'] = ((df_full['body'] == 'Earth') & (df_full['u_elevation'] < earth_land_thresh)).astype(int)
df_full['ndvi'] = np.clip((df_full['u_hydration'] - 0.3) * 0.8, 0.0, 1.0)
df_full['is_valid_land'] = ~(df_full['water_mask'] == 1)
df_full['mafic_index'] = df_full['g2_basalt'] / (df_full['g1_silicate'] + 0.05)
df_full['ruggedness_ratio'] = df_full['u_roughness'] / (df_full['u_slope'] + 0.05)

# Intra-body feature standardization
features_to_std = [
    'z_Tmean', 'z_Trange', 'z_illum',
    'u_elevation', 'u_slope', 'u_roughness', 'ruggedness_ratio',
    'u_dust', 'u_wind', 'u_erosion', 'mafic_index',
]
for col in features_to_std:
    if col in df_full.columns:
        new_col = f"{col}_body_z"
        df_full[new_col] = 0.0
        for body in df_full['body'].unique():
            stat_mask = (df_full['body'] == body) & df_full['is_valid_land'] if body == 'Earth' else (df_full['body'] == body)
            vals = df_full.loc[stat_mask, col].values
            mean_v, std_v = np.mean(vals), np.std(vals)
            if std_v == 0: std_v = 1.0
            df_full.loc[df_full['body'] == body, new_col] = (df_full.loc[df_full['body'] == body, col].values - mean_v) / std_v

active_df = df_full[df_full['is_valid_land']].copy().reset_index(drop=True)
earth_all = active_df[active_df['body'] == 'Earth'].copy()
erosion_thresh = float(np.nanpercentile(earth_all['u_erosion'], 35))
not_rainforest_earth = (earth_all['lat'].abs() >= 13.0) | (
    (earth_all['lon'] > 42.0) & (earth_all['lon'] < 52.0) & (earth_all['lat'] > 0.0)
)
barren_mask = not_rainforest_earth & (earth_all['u_erosion'] >= erosion_thresh)
earth_active = earth_all[barren_mask].copy().reset_index(drop=True)

FEATURE_GROUPS = {
    'C1': ['g1_silicate', 'g2_basalt', 'g4_plagioclase'],
    'C1_MAFIC': ['mafic_index_body_z'],
    'C2': ['u_elevation_body_z', 'u_slope_body_z', 'u_roughness_body_z', 'ruggedness_ratio_body_z'],
    'C3': ['z_Tmean_body_z', 'z_Trange_body_z', 'z_illum_body_z'],
    'C4': ['u_hydration'],
    'C5': ['u_dust_body_z', 'u_wind_body_z', 'u_erosion_body_z'],
}
ALL_FEATURE_COLS = [c for cols in FEATURE_GROUPS.values() for c in cols]
N_ALL = len(ALL_FEATURE_COLS)
RAW_FEATURE_COLS = [
    'g1_silicate', 'g2_basalt', 'g3_iron_oxide', 'g4_plagioclase',
    'g5_igneous', 'g6_sedimentary', 'g7_metamorphic', 'g8_regolith',
    'u_elevation', 'u_slope', 'u_roughness', 'u_crater',
    'z_Tmean', 'z_Trange', 'z_illum',
    'u_ice', 'u_depth', 'u_permafrost', 'u_hydration',
    'u_dust', 'u_wind', 'u_erosion'
]
CATEGORY_WEIGHTS = {
    'C1': 0.25,
    'C1_MAFIC': 0.15,
    'C2': 0.25,
    'C3': 0.10,
    'C4': 0.05,
    'C5': 0.20,
}

_NEEDED = list(dict.fromkeys(ALL_FEATURE_COLS + RAW_FEATURE_COLS + ['water_mask', 'ndvi']))
COL_POS = {c: i for i, c in enumerate(_NEEDED)}

# 1. Robust Earth Scale (MAD / IQR with a 0.15 floor)
X_earth = earth_active[ALL_FEATURE_COLS].values
EARTH_MEDIANS = np.median(X_earth, axis=0)
mad = np.median(np.abs(X_earth - EARTH_MEDIANS), axis=0) * 1.4826
q_scale = iqr(X_earth, axis=0, nan_policy="omit") / 1.349
raw_scale = np.where(mad > 1e-5, mad, np.where(q_scale > 1e-5, q_scale, 1.0))
ROBUST_SCALE = np.maximum(raw_scale, 0.15)
FEATURE_STDS = ROBUST_SCALE

# Raw MAD scale with a 0.15 floor across all 22 RAW_FEATURE_COLS
raw_earth_matrix = earth_active[RAW_FEATURE_COLS].to_numpy(dtype=float)
raw_mad = np.median(np.abs(raw_earth_matrix - np.median(raw_earth_matrix, axis=0)), axis=0) * 1.4826
RAW_SCALE = np.maximum(raw_mad, 0.15)

# 2. Build Bicubic Interpolators per Body (fast 4x4 cubic spline on the 0.5° grid)
CUBIC_INTERPS = {}
for b in ['Earth', 'Moon', 'Mars']:
    sub = df_full[df_full['body'] == b].drop_duplicates(subset=['lat', 'lon']).sort_values(['lat', 'lon'])
    lats_u = np.sort(sub['lat'].unique())
    lons_u = np.sort(sub['lon'].unique())
    expected_len = len(lats_u) * len(lons_u)
    if len(sub) != expected_len:
        full_idx = pd.MultiIndex.from_product([lats_u, lons_u], names=['lat', 'lon'])
        sub = sub.set_index(['lat', 'lon']).reindex(full_idx).reset_index()
    grid_3d = sub[_NEEDED].values.reshape(len(lats_u), len(lons_u), len(_NEEDED))
    CUBIC_INTERPS[b] = RegularGridInterpolator(
        (lats_u, lons_u), grid_3d, method='cubic', bounds_error=False, fill_value=None
    )

print("Initialization Complete for FastAPI Backend.")


# Geodesic & Vectorized Scoring Utilities
def normalize_longitude(lon):
    return ((lon + 180.0) % 360.0) - 180.0

def haversine_km(lat1, lon1, lat2, lon2, R=6371.0):
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dlambda = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2.0)**2 + np.cos(phi1) * np.cos(phi2) * np.sin(dlambda / 2.0)**2
    a = np.clip(a, 0.0, 1.0)
    return 2.0 * R * np.arctan2(np.sqrt(a), np.sqrt(1.0 - a))


def bicubic_batch(body, lats, lons, cols):
    pts = np.column_stack([
        np.clip(np.asarray(lats, dtype=float), -90.0, 90.0),
        normalize_longitude(np.asarray(lons, dtype=float))
    ])
    vals = CUBIC_INTERPS[body](pts)
    p = [COL_POS[c] for c in cols]
    return vals[:, p]

def bicubic_interpolate_point(body, lat, lon, feature_cols):
    return bicubic_batch(body, [lat], [lon], feature_cols)[0]

def huber_similarity(diff_scaled, delta=1.35):
    abs_d = np.abs(diff_scaled)
    huber_loss = np.where(abs_d <= delta, 0.5 * (abs_d ** 2), delta * (abs_d - 0.5 * delta))
    return np.exp(-np.mean(huber_loss, axis=1))

def hellinger_similarity(X_sub, ref_sub):
    X_pos = np.clip(X_sub, 0.0, None)
    ref_pos = np.clip(ref_sub, 0.0, None)

    X_sum = np.sum(X_pos, axis=1, keepdims=True)
    ref_sum = float(np.sum(ref_pos))
    n_cols = X_pos.shape[1]

    X_prob = np.where(X_sum > 1e-8, X_pos / np.maximum(X_sum, 1e-8), 1.0 / n_cols)
    ref_prob = (ref_pos / ref_sum) if ref_sum > 1e-8 else np.full(n_cols, 1.0 / n_cols)

    h_dist = np.sqrt(np.sum((np.sqrt(X_prob) - np.sqrt(ref_prob)) ** 2, axis=1)) / np.sqrt(2.0)
    return 1.0 - np.clip(h_dist, 0.0, 1.0)

def vectorized_score_vectors(X_candidates, ref_vec, local_grads=None, custom_weights=None):
    weights = custom_weights if custom_weights else CATEGORY_WEIGHTS
    cat_scores = {}
    col_offset = 0
    S_total = np.zeros(len(X_candidates))

    for cat, cols in FEATURE_GROUPS.items():
        k = len(cols)
        X_sub = X_candidates[:, col_offset:col_offset+k]
        ref_sub = ref_vec[col_offset:col_offset+k]
        scale_sub = ROBUST_SCALE[col_offset:col_offset+k]

        if cat == 'C1':
            cat_score = hellinger_similarity(X_sub, ref_sub) ** 3
        else:
            diff_scaled = (X_sub - ref_sub) / (0.75 * scale_sub)
            cat_score = huber_similarity(diff_scaled, delta=1.0)

        cat_scores[cat] = cat_score
        S_total += cat_score * weights.get(cat, CATEGORY_WEIGHTS[cat])
        col_offset += k

    return S_total, cat_scores


def two_step_pinpoint_analogs(target_body, target_lat, target_lon, top_n=5, custom_weights=None):
    target_body_cap = target_body.capitalize()
    norm_lon = normalize_longitude(target_lon)

    ref_vec = bicubic_interpolate_point(target_body_cap, target_lat, norm_lon, ALL_FEATURE_COLS)
    macro_S, _ = vectorized_score_vectors(X_earth, ref_vec, custom_weights=custom_weights)
    earth_active['macro_S'] = macro_S

    sorted_macro = earth_active.sort_values(by='macro_S', ascending=False)
    macro_lats = sorted_macro['lat'].values
    macro_lons = sorted_macro['lon'].values

    candidates_results = []
    excluded_coords = []
    min_separation_km = 200.0

    for c_lat, c_lon in zip(macro_lats[:60], macro_lons[:60]):
        if len(candidates_results) >= top_n:
            break
        c_lat, c_lon = float(c_lat), float(c_lon)

        if excluded_coords:
            ex = np.asarray(excluded_coords)
            if np.any(haversine_km(c_lat, c_lon, ex[:, 0], ex[:, 1]) < min_separation_km):
                continue

        excluded_coords.append((c_lat, c_lon))

        lat_mesh = np.linspace(max(-89.9, c_lat - 0.25), min(89.9, c_lat + 0.25), 25)
        lon_mesh = np.linspace(c_lon - 0.25, c_lon + 0.25, 25)

        mesh_lat, mesh_lon, seen = [], [], set()
        for la in lat_mesh:
            for lo in lon_mesh:
                la_r, lo_r = round(la, 4), round(normalize_longitude(lo), 4)
                if (la_r, lo_r) in seen:
                    continue
                seen.add((la_r, lo_r))
                mesh_lat.append(la_r)
                mesh_lon.append(lo_r)
        mesh_lat = np.asarray(mesh_lat, dtype=float)
        mesh_lon = np.asarray(mesh_lon, dtype=float)

        vals_all = bicubic_batch('Earth', mesh_lat, mesh_lon, ALL_FEATURE_COLS + ['water_mask', 'ndvi'])
        vec = vals_all[:, :N_ALL]
        is_water = vals_all[:, N_ALL] > 0.05
        not_rainforest = (np.abs(mesh_lat) >= 13.0) | (
            (mesh_lon > 42.0) & (mesh_lon < 52.0) & (mesh_lat > 0.0)
        )
        valid_mask = (~is_water) & not_rainforest
        if not np.any(valid_mask):
            continue

        S_sub, cat_sub = vectorized_score_vectors(vec, ref_vec, custom_weights=custom_weights)


        not_rainforest = (np.abs(mesh_lat) >= 13.0) | ((mesh_lon > 42.0) & (mesh_lon < 52.0) & (mesh_lat > 0.0))
        valid_mask = (~is_water) & not_rainforest
        if not valid_mask.any():
            continue

        raw_i = int(np.nanargmax(S_sub))
        valid_idx = np.flatnonzero(valid_mask)
        best_i = int(valid_idx[np.nanargmax(S_sub[valid_idx])])

        pin_lat, pin_lon = mesh_lat[best_i], mesh_lon[best_i]
        best_S = S_sub[best_i]
        best_vec = vec[best_i]

        grid_res_km = round(haversine_km(pin_lat, pin_lon, pin_lat, pin_lon + 0.01), 2)
        d_shift_km = haversine_km(mesh_lat[raw_i], mesh_lon[raw_i], pin_lat, pin_lon)
        n_plateau = int(np.count_nonzero(valid_mask & (S_sub >= 0.99 * best_S)))
        plateau_spread_km = np.sqrt(n_plateau) * grid_res_km * 0.5
        error_km = np.sqrt(grid_res_km ** 2 + (0.25 * d_shift_km) ** 2 + (0.50 * plateau_spread_km) ** 2)

        # 1. Sub-scores for ALL_FEATURE_COLS (includes _body_z keys expected for C2, C3, C5)
        z_diffs = (best_vec - ref_vec) / ROBUST_SCALE
        sub_sim_vals = np.exp(-0.5 * (z_diffs ** 2))
        sub_scores_dict = {col: round(float(val), 4) for col, val in zip(ALL_FEATURE_COLS, sub_sim_vals)}

        # 2. Raw feature vectors and raw column sub-scores (0.15 MAD floor)
        target_raw_vec = bicubic_interpolate_point(target_body_cap, target_lat, norm_lon, RAW_FEATURE_COLS)
        earth_raw_vec = bicubic_interpolate_point('Earth', pin_lat, pin_lon, RAW_FEATURE_COLS)

        raw_sim_vals = np.exp(-0.5 * (((earth_raw_vec - target_raw_vec) / RAW_SCALE) ** 2))
        for col, val in zip(RAW_FEATURE_COLS, raw_sim_vals):
            if col not in sub_scores_dict:
                sub_scores_dict[col] = round(float(val), 4)

        # Map C5 raw names directly from their _body_z sub-scores
        sub_scores_dict["u_dust"] = sub_scores_dict["u_dust_body_z"]
        sub_scores_dict["u_wind"] = sub_scores_dict["u_wind_body_z"]
        sub_scores_dict["u_erosion"] = sub_scores_dict["u_erosion_body_z"]

        MIN_SUITABILITY = 0.35
        MIN_GEOLOGY_C1  = 0.40

        if best_S < MIN_SUITABILITY or cat_sub['C1'][best_i] < MIN_GEOLOGY_C1:
            continue

        candidates_results.append({
            'body': 'Earth',
            'lat': pin_lat,
            'lon': pin_lon,
            'S_refined': round(float(best_S), 4),
            'pinpoint_error_km': round(min(error_km, 10.0), 2),
            'C1': round(float(cat_sub['C1'][best_i]), 4),
            'C1_MAFIC': round(float(cat_sub['C1_MAFIC'][best_i]), 4),
            'C2': round(float(cat_sub['C2'][best_i]), 4),
            'C3': round(float(cat_sub['C3'][best_i]), 4),
            'C4': round(float(cat_sub['C4'][best_i]), 4),
            'C5': round(float(cat_sub['C5'][best_i]), 4),
            'sub_scores': sub_scores_dict,
            'target_raw': {col: round(float(val), 4) for col, val in zip(RAW_FEATURE_COLS, target_raw_vec)},
            'earth_raw': {col: round(float(val), 4) for col, val in zip(RAW_FEATURE_COLS, earth_raw_vec)}
        })

    candidates_results.sort(key=lambda x: x['S_refined'], reverse=True)

    return candidates_results

# FastAPI Server Routing
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class LocationRequest(BaseModel):
    body: str
    lat: float
    lon: float
    weights: Optional[Dict[str, float]] = None

@app.get("/api/status")
def read_status():
    return {
        "status": "Online",
        "message": "Planetary Analog Pipeline API is running!",
        "docs": "Visit http://localhost:8000/docs for interactive API testing."
    }

@app.get("/api/placename")
def get_place_name(lat: float, lon: float):
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}&zoom=8"
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'CelestialParallels/1.0 (Research Mission Brief)',
                'Accept-Language': 'en'
            }
        )
        with urllib.request.urlopen(req, timeout=4) as response:
            data = json.loads(response.read().decode())
            if 'address' in data:
                addr = data['address']
                region = addr.get('city') or addr.get('town') or addr.get('county') or addr.get('state') or addr.get('region') or ""
                country = addr.get('country') or ""
                formatted = ", ".join([p for p in [region, country] if p])
                return {"place": formatted or data.get('display_name', "Remote Terrestrial Region")}
            return {"place": data.get('display_name', "Remote Terrestrial Region")}
    except Exception as e:
        return {"place": "Remote Terrestrial Region"}

last_heartbeat = time.time()
heartbeat_started = False

@app.post("/api/heartbeat")
def receive_heartbeat():
    global last_heartbeat, heartbeat_started
    last_heartbeat = time.time()
    heartbeat_started = True
    return {"status": "alive"}

@app.post("/api/pinpoint")
def calculate_pinpoint(req: LocationRequest):
    results = two_step_pinpoint_analogs(req.body, req.lat, req.lon, top_n=5, custom_weights=req.weights)
    if not results:
        return {"candidates": [], "message": "No Earth analogs found above the similarity threshold."}
    return {"candidates": results}


@app.post("/api/shutdown")
def shutdown_app():
    os._exit(0)

def monitor_browser():
    while True:
        time.sleep(2)
        if heartbeat_started and (time.time() - last_heartbeat > 6):
            os._exit(0)

threading.Thread(target=monitor_browser, daemon=True).start()

# Mount static files so index.html, styles.css, and app.js serve at root /
app.mount("/", StaticFiles(directory=get_resource_path("."), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)