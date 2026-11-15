from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import time
import numpy as np
import pandas as pd
import os
import sys

def get_resource_path(relative_path):
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)

print("--- INITIALIZING TWO-STAGE PINPOINT & ERROR MODULE PIPELINE ---")

# 1. Load Datasets
master = pd.read_csv('Master_Suitability_S.csv')
c1 = pd.read_csv('C1.csv')
c2 = pd.read_csv('C2.csv')
c3 = pd.read_csv('C3.csv')
c4 = pd.read_csv('C4.csv')
c5 = pd.read_csv('C5.csv')

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

# Construct water_mask and ndvi proxies from dataset variables for Earth
df_full['water_mask'] = ((df_full['body'] == 'Earth') & (df_full['u_elevation'] < earth_land_thresh)).astype(int)
df_full['ndvi'] = np.clip((df_full['u_hydration'] - 0.3) * 0.8, 0.0, 1.0)
df_full['is_valid_land'] = ~(df_full['water_mask'] == 1)

# Intra-body feature standardization
features_to_std = ['z_Tmean', 'z_Trange', 'z_illum', 'u_elevation', 'u_slope', 'u_roughness']
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
earth_active = active_df[active_df['body'] == 'Earth'].copy().reset_index(drop=True)

FEATURE_GROUPS = {
    'C1': ['g1_silicate', 'g2_basalt', 'g3_iron_oxide', 'g4_plagioclase', 'g5_igneous', 'g6_sedimentary', 'g7_metamorphic', 'g8_regolith'],
    'C2': ['u_elevation_body_z', 'u_slope_body_z', 'u_roughness_body_z', 'u_crater'],
    'C3': ['z_Tmean_body_z', 'z_Trange_body_z', 'z_illum_body_z'],
    'C4': ['u_ice', 'u_depth', 'u_permafrost', 'u_hydration'],
    'C5': ['u_dust', 'u_wind', 'u_erosion']
}
ALL_FEATURE_COLS = [c for cols in FEATURE_GROUPS.values() for c in cols]
CATEGORY_WEIGHTS = {'C1': 0.20, 'C2': 0.25, 'C3': 0.20, 'C4': 0.20, 'C5': 0.15}

# Precompute shrunk inverse covariance matrices
INV_COVS = {}
X_active_all = active_df[ALL_FEATURE_COLS].values
col_idx = 0
for cat, cols in FEATURE_GROUPS.items():
    k = len(cols)
    X_sub = X_active_all[:, col_idx:col_idx+k]
    sample_cov = np.cov(X_sub, rowvar=False)
    shrunk_cov = 0.85 * sample_cov + 0.15 * np.diag(np.diag(sample_cov)) + np.eye(k) * 1e-4
    INV_COVS[cat] = np.linalg.pinv(shrunk_cov)
    col_idx += k

X_earth = earth_active[ALL_FEATURE_COLS].values

BODY_GRIDS = {}
for b in ['Earth', 'Moon', 'Mars']:
    BODY_GRIDS[b] = df_full[df_full['body'] == b].set_index(['lat', 'lon'])

print("Initialization Complete for FastAPI Backend.")

# Geodesic & Vectorized Scoring Utilities
def normalize_longitude(lon):
    return ((lon + 180.0) % 360.0) - 180.0

def haversine_km(lat1, lon1, lat2, lon2, R=6371.0):
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dlambda = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2.0)**2 + np.cos(phi1) * np.cos(phi2) * np.sin(dlambda / 2.0)**2
    return 2.0 * R * np.arctan2(np.sqrt(a), np.sqrt(1.0 - a))

def bilinear_interpolate_point(body_grid_df, lat, lon, feature_cols):
    lon = normalize_longitude(lon)
    lat = np.clip(lat, -90.0, 90.0)
    lat0 = np.floor(lat * 2.0) / 2.0
    lat1 = min(90.0, lat0 + 0.5)
    lon0 = np.floor(lon * 2.0) / 2.0
    lon1 = lon0 + 0.5
    if lon1 > 180.0: lon1 = -180.0

    wy = (lat - lat0) / 0.5 if lat1 != lat0 else 0.0
    wx = (lon - lon0) / 0.5 if lon1 != lon0 else 0.0

    def get_vec(la, lo):
        try:
            return body_grid_df.loc[(la, lo), feature_cols].values.astype(float)
        except KeyError:
            return body_grid_df.iloc[0][feature_cols].values.astype(float)

    v00 = get_vec(lat0, lon0)
    v10 = get_vec(lat0, lon1)
    v01 = get_vec(lat1, lon0)
    v11 = get_vec(lat1, lon1)

    interp_vec = (v00 * (1 - wx) * (1 - wy) +
                 v10 * wx * (1 - wy) +
                 v01 * (1 - wx) * wy +
                 v11 * wx * wy)
    
    grad_x = np.linalg.norm((v10 - v00 + v11 - v01) / 2.0)
    grad_y = np.linalg.norm((v01 - v00 + v11 - v10) / 2.0)
    return interp_vec, np.sqrt(grad_x**2 + grad_y**2)

def vectorized_score_vectors(X_candidates, ref_vec, local_grads=None):
    cat_scores = {}
    col_offset = 0
    S_total = np.zeros(len(X_candidates))
    for cat, cols in FEATURE_GROUPS.items():
        k = len(cols)
        X_sub = X_candidates[:, col_offset:col_offset+k]
        ref_sub = ref_vec[col_offset:col_offset+k]
        inv_cov = INV_COVS[cat]
        
        diff = X_sub - ref_sub
        mahal_sq = np.sum(np.dot(diff, inv_cov) * diff, axis=1)
        e_cov = 1.0 / (1.0 + (mahal_sq / (k * 1.5)))
        e_geo = np.exp(-0.05 * (local_grads ** 2)) if local_grads is not None else 1.0
            
        gamma = 1.0 / (2.0 * k)
        cat_score = np.exp(-gamma * mahal_sq) * e_cov * e_geo
        cat_scores[cat] = cat_score
        S_total += cat_score * CATEGORY_WEIGHTS[cat]
        col_offset += k
    return S_total, cat_scores

def two_step_pinpoint_analogs(target_body, target_lat, target_lon, top_n=5):
    target_body_cap = target_body.capitalize()
    norm_lon = normalize_longitude(target_lon)
    
    ref_vec, _ = bilinear_interpolate_point(BODY_GRIDS[target_body_cap], target_lat, norm_lon, ALL_FEATURE_COLS)
    macro_S, _ = vectorized_score_vectors(X_earth, ref_vec)
    earth_active['macro_S'] = macro_S
    
    best_macro = earth_active.sort_values(by='macro_S', ascending=False).iloc[0]
    c_lat, c_lon = best_macro['lat'], best_macro['lon']
    
    lat_mesh = np.linspace(max(-89.9, c_lat - 0.25), min(89.9, c_lat + 0.25), 25)
    lon_mesh = np.linspace(c_lon - 0.25, c_lon + 0.25, 25)
    
    sub_candidates = []
    seen = set()
    for la in lat_mesh:
        for lo in lon_mesh:
            la_r, lo_r = round(la, 4), round(normalize_longitude(lo), 4)
            if (la_r, lo_r) in seen: continue
            seen.add((la_r, lo_r))
            
            w_val, _ = bilinear_interpolate_point(BODY_GRIDS['Earth'], la_r, lo_r, ['water_mask'])
            ndvi_val, _ = bilinear_interpolate_point(BODY_GRIDS['Earth'], la_r, lo_r, ['ndvi'])
            vec, grad = bilinear_interpolate_point(BODY_GRIDS['Earth'], la_r, lo_r, ALL_FEATURE_COLS)
            
            sub_candidates.append({
                'lat': la_r,
                'lon': lo_r,
                'water_mask': int(w_val[0] > 0.5),
                'ndvi': ndvi_val[0],
                'vec': vec,
                'grad': grad,
                'grid_res_km': round(haversine_km(la_r, lo_r, la_r, lo_r + 0.01), 2)
            })
            
    local_df = pd.DataFrame(sub_candidates)
    if local_df.empty:
        res_fallback = pd.DataFrame([{
            'body': 'Earth', 'lat': c_lat, 'lon': c_lon, 'S_refined': best_macro['macro_S'],
            'grid_res_km': 1.11, 'pinpoint_error_km': 5.0
        }])
        res_fallback.index = [1]
        return res_fallback

    X_sub = np.array(local_df['vec'].tolist())
    grads = np.array(local_df['grad'].tolist())
    S_sub, cat_sub = vectorized_score_vectors(X_sub, ref_vec, local_grads=grads)
    local_df['S_refined'] = S_sub
        
    valid = local_df[(local_df['water_mask'] == 0) & (local_df['ndvi'] < 0.25)].copy()
    if valid.empty:
        valid = local_df[local_df['water_mask'] == 0].copy()
    if valid.empty:
        valid = local_df.copy()
        
    raw_peak = local_df.loc[local_df['S_refined'].idxmax()]
    raw_lat, raw_lon = raw_peak['lat'], raw_peak['lon']
    
    best = valid.loc[valid['S_refined'].idxmax()]
    pin_lat, pin_lon = best['lat'], best['lon']
    
    d_shift_km = haversine_km(raw_lat, raw_lon, pin_lat, pin_lon)
    top_plateau = valid[valid['S_refined'] >= 0.99 * best['S_refined']]
    plateau_spread_km = np.sqrt(len(top_plateau)) * best['grid_res_km'] * 0.5
    
    error_km = np.sqrt(
        best['grid_res_km']**2 +
        (0.25 * d_shift_km)**2 +
        (0.50 * plateau_spread_km)**2
    )
    final_error = round(min(error_km, 10.0), 2)
    
    res_df = pd.DataFrame([{
        'body': 'Earth',
        'lat': pin_lat,
        'lon': pin_lon,
        'S_refined': round(best['S_refined'], 4),
        'pinpoint_error_km': final_error
    }])
    return res_df

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

@app.get("/api/status")
def read_status():
    return {
        "status": "Online",
        "message": "Planetary Analog Pipeline API is running!",
        "docs": "Visit http://localhost:8000/docs for interactive API testing."
    }
    
@app.post("/api/pinpoint")
def calculate_pinpoint(req: LocationRequest):
    result_df = two_step_pinpoint_analogs(req.body, req.lat, req.lon, top_n=1)
    best = result_df.iloc[0]
    return {
        "earth_lat": float(best['lat']),
        "earth_lon": float(best['lon']),
        "error_km": float(best['pinpoint_error_km']),
        "S_score": float(best['S_refined'])
    }

# Mount static files so index.html, styles.css, and app.js serve at root /
app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
