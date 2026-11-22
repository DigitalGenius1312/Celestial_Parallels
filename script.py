import json
import os
import sys
import threading
import time
import urllib.request
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from scipy.interpolate import RegularGridInterpolator
from scipy.stats import iqr


def get_resource_path(relative_path: str) -> str:
    if hasattr(sys, "_MEIPASS"):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)


print("--- INITIALIZING TWO-STAGE PINPOINT & ERROR MODULE PIPELINE ---")

# ==============================================================================
# 1. CONSTANTS & CONFIGURATION
# ==============================================================================
FEATURE_GROUPS: Dict[str, List[str]] = {
    "C1": ["g1_silicate", "g2_basalt", "g4_plagioclase"],
    "C1_MAFIC": ["mafic_index_body_z"],
    "C2": [
        "u_elevation_body_z",
        "u_slope_body_z",
        "u_roughness_body_z",
        "ruggedness_ratio_body_z",
    ],
    "C3": ["z_Tmean_body_z", "z_Trange_body_z", "z_illum_body_z"],
    "C4": ["u_hydration"],
    "C5": ["u_dust_body_z", "u_wind_body_z", "u_erosion_body_z"],
}

ALL_FEATURE_COLS: List[str] = [
    col for cols in FEATURE_GROUPS.values() for col in cols
]
N_ALL: int = len(ALL_FEATURE_COLS)

RAW_FEATURE_COLS: List[str] = [
    "g1_silicate",
    "g2_basalt",
    "g3_iron_oxide",
    "g4_plagioclase",
    "g5_igneous",
    "g6_sedimentary",
    "g7_metamorphic",
    "g8_regolith",
    "u_elevation",
    "u_slope",
    "u_roughness",
    "u_crater",
    "z_Tmean",
    "z_Trange",
    "z_illum",
    "u_ice",
    "u_depth",
    "u_permafrost",
    "u_hydration",
    "u_dust",
    "u_wind",
    "u_erosion",
]

CATEGORY_WEIGHTS: Dict[str, float] = {
    "C1": 0.25,
    "C1_MAFIC": 0.15,
    "C2": 0.25,
    "C3": 0.10,
    "C4": 0.05,
    "C5": 0.20,
}

TOP_N_DEFAULT: int = 5
MIN_SUITABILITY: float = 0.35
MIN_GEOLOGY_C1: float = 0.40
MAX_EARTH_NDVI: float = 0.12

EXTRAMAP_LANDMARKS: Dict[str, List[dict]] = {
    "Moon": [
        {"name": "Tranquility Base (Apollo 11)", "lat": 0.67, "lon": 23.47},
        {"name": "Shackleton Crater", "lat": -89.90, "lon": 0.00},
        {"name": "Copernicus Crater", "lat": 9.62, "lon": -20.08},
        {"name": "Clavius Crater", "lat": -58.40, "lon": -14.40},
        {"name": "Plato Crater", "lat": 51.60, "lon": -9.30},
        {"name": "Mare Imbrium", "lat": 32.80, "lon": -15.60},
        {"name": "Mare Serenitatis", "lat": 28.00, "lon": 17.50},
        {"name": "Von Kármán Crater", "lat": -44.45, "lon": 176.25},
        {"name": "Tycho Crater", "lat": -43.31, "lon": -11.36},
        {"name": "Aristarchus Plateau", "lat": 23.73, "lon": -47.49},
    ],
    "Mars": [
        {"name": "Gale Crater (Curiosity)", "lat": -5.37, "lon": 137.81},
        {"name": "Jezero Crater (Perseverance)", "lat": 18.38, "lon": 77.58},
        {"name": "Hellas Planitia", "lat": -42.43, "lon": 70.50},
        {"name": "Elysium Mons", "lat": 25.02, "lon": 147.21},
        {"name": "Arsia Mons", "lat": -8.26, "lon": -120.09},
        {"name": "Utopia Planitia", "lat": 46.74, "lon": 117.52},
        {"name": "Argyre Planitia", "lat": -49.84, "lon": -43.31},
        {"name": "Valles Marineris", "lat": -21.40, "lon": -64.40},
        {"name": "Olympus Mons", "lat": 18.65, "lon": -133.80},
        {"name": "Bagnold Dunes", "lat": -4.77, "lon": 137.37},
    ],
}


# ==============================================================================
# 2. DATA INGESTION & PREPROCESSING
# ==============================================================================
def weighted_quantile(
    values: np.ndarray,
    quantiles: np.ndarray,
    sample_weight: Optional[np.ndarray] = None,
) -> np.ndarray:
    """Compute weighted quantiles along a 1D array."""
    values = np.asarray(values, dtype=float)
    quantiles = np.asarray(quantiles, dtype=float)
    if sample_weight is None:
        sample_weight = np.ones(len(values), dtype=float)
    else:
        sample_weight = np.asarray(sample_weight, dtype=float)

    sorter = np.argsort(values)
    values_sorted = values[sorter]
    weights_sorted = sample_weight[sorter]
    wq = (np.cumsum(weights_sorted) - 0.5 * weights_sorted) / np.sum(weights_sorted)
    return np.interp(quantiles, wq, values_sorted)


master = pd.read_csv(get_resource_path("Master_Suitability_S.csv"))
c1 = pd.read_csv(get_resource_path("C1.csv"))
c2 = pd.read_csv(get_resource_path("C2.csv"))
c3 = pd.read_csv(get_resource_path("C3.csv"))
c4 = pd.read_csv(get_resource_path("C4.csv"))
c5 = pd.read_csv(get_resource_path("C5.csv"))

df_full = master.merge(c1, on=["body", "lat", "lon"], suffixes=("", "_c1"))
for df_comp in [c2, c3, c4, c5]:
    df_full = df_full.merge(df_comp, on=["body", "lat", "lon"], suffixes=("", "_dup"))
df_full = df_full.loc[:, ~df_full.columns.str.endswith("_dup")].copy()

# Tighter shoreline quantile (28.0%) to exclude shallow coastal shelf pixels
earth_mask_raw = df_full["body"] == "Earth"
earth_elev = df_full.loc[earth_mask_raw, "u_elevation"].values
earth_lats = df_full.loc[earth_mask_raw, "lat"].values
weights_lat = np.cos(np.radians(earth_lats))

earth_land_thresh = float(
    weighted_quantile(
        earth_elev, np.array([1.0 - 0.280]), sample_weight=weights_lat
    )[0]
)

df_full["water_mask"] = (
    (df_full["body"] == "Earth") & (df_full["u_elevation"] < earth_land_thresh)
).astype(int)
df_full["ndvi"] = np.clip((df_full["u_hydration"] - 0.3) * 0.8, 0.0, 1.0)
df_full["is_valid_land"] = df_full["water_mask"] != 1
df_full["mafic_index"] = df_full["g2_basalt"] / (df_full["g1_silicate"] + 0.05)
df_full["ruggedness_ratio"] = df_full["u_roughness"] / (df_full["u_slope"] + 0.05)

# Intra-body feature standardization
features_to_std = [
    "z_Tmean",
    "z_Trange",
    "z_illum",
    "u_elevation",
    "u_slope",
    "u_roughness",
    "ruggedness_ratio",
    "u_dust",
    "u_wind",
    "u_erosion",
    "mafic_index",
]
for col in features_to_std:
    if col in df_full.columns:
        new_col = f"{col}_body_z"
        df_full[new_col] = 0.0
        for body in df_full["body"].dropna().unique():
            body_mask = df_full["body"] == body
            stat_mask = (
                (body_mask & df_full["is_valid_land"])
                if body == "Earth"
                else body_mask
            )
            vals = df_full.loc[stat_mask, col].to_numpy(dtype=float)
            mean_v = float(np.nanmean(vals))
            std_v = float(np.nanstd(vals))
            if not np.isfinite(std_v) or std_v == 0.0:
                std_v = 1.0
            df_full.loc[body_mask, new_col] = (
                df_full.loc[body_mask, col].to_numpy(dtype=float) - mean_v
            ) / std_v

active_df = df_full[df_full["is_valid_land"]].copy().reset_index(drop=True)
earth_all = active_df[active_df["body"] == "Earth"].copy()

erosion_thresh = float(np.nanpercentile(earth_all["u_erosion"], 35))
arid_hydration_thresh = float(np.nanpercentile(earth_all["u_hydration"], 30))
not_rainforest_earth = (earth_all["lat"].abs() >= 13.0) | (
    (earth_all["lon"] > 42.0) & (earth_all["lon"] < 52.0) & (earth_all["lat"] > 0.0)
)
barren_mask = (
    not_rainforest_earth
    & (earth_all["u_erosion"] >= erosion_thresh)
    & (earth_all["u_hydration"] <= arid_hydration_thresh)
    & (earth_all["ndvi"] <= MAX_EARTH_NDVI)
)
earth_active = earth_all[barren_mask].copy().reset_index(drop=True)
if earth_active.empty:
    earth_active = earth_all[not_rainforest_earth & (earth_all["u_erosion"] >= erosion_thresh)].copy().reset_index(drop=True)

_NEEDED = list(
    dict.fromkeys(
        ALL_FEATURE_COLS + RAW_FEATURE_COLS + ["water_mask", "ndvi", "u_hydration"]
    )
)
COL_POS = {c: i for i, c in enumerate(_NEEDED)}

# Robust Earth scale (MAD / IQR with a 0.15 floor)
X_earth = earth_active[ALL_FEATURE_COLS].to_numpy(dtype=float)
EARTH_MEDIANS = np.median(X_earth, axis=0)
mad = np.median(np.abs(X_earth - EARTH_MEDIANS), axis=0) * 1.4826
q_scale = iqr(X_earth, axis=0, nan_policy="omit") / 1.349
raw_scale = np.where(mad > 1e-5, mad, np.where(q_scale > 1e-5, q_scale, 1.0))
ROBUST_SCALE = np.maximum(raw_scale, 0.15)
FEATURE_STDS = ROBUST_SCALE

raw_earth_matrix = earth_active[RAW_FEATURE_COLS].to_numpy(dtype=float)
raw_mad = (
    np.median(
        np.abs(raw_earth_matrix - np.median(raw_earth_matrix, axis=0)), axis=0
    )
    * 1.4826
)
RAW_SCALE = np.maximum(raw_mad, 0.15)

# Bicubic interpolators for continuous features + nearest-neighbor for masks
CUBIC_INTERPS: Dict[str, RegularGridInterpolator] = {}
MASK_INTERPS: Dict[str, RegularGridInterpolator] = {}
MASK_COLS = ["water_mask", "ndvi", "u_hydration"]

for b in ["Earth", "Moon", "Mars"]:
    sub = (
        df_full[df_full["body"] == b]
        .drop_duplicates(subset=["lat", "lon"])
        .sort_values(["lat", "lon"])
    )
    lats_u = np.sort(sub["lat"].unique())
    lons_u = np.sort(sub["lon"].unique())
    expected_len = len(lats_u) * len(lons_u)
    if len(sub) != expected_len:
        full_idx = pd.MultiIndex.from_product([lats_u, lons_u], names=["lat", "lon"])
        sub = sub.set_index(["lat", "lon"]).reindex(full_idx).reset_index()

    grid_3d = (
        sub[_NEEDED]
        .to_numpy(dtype=float)
        .reshape(len(lats_u), len(lons_u), len(_NEEDED))
    )
    CUBIC_INTERPS[b] = RegularGridInterpolator(
        (lats_u, lons_u),
        grid_3d,
        method="cubic",
        bounds_error=False,
        fill_value=None,
    )

    mask_grid = (
        sub[MASK_COLS]
        .to_numpy(dtype=float)
        .reshape(len(lats_u), len(lons_u), len(MASK_COLS))
    )
    MASK_INTERPS[b] = RegularGridInterpolator(
        (lats_u, lons_u),
        mask_grid,
        method="nearest",
        bounds_error=False,
        fill_value=1.0,
    )


def get_extraterrestrial_place_name(body_name: str, lat: float, lon: float) -> str:
    body_cap = body_name.capitalize()
    landmarks = EXTRAMAP_LANDMARKS.get(body_cap, [])
    nearest_name = f"{body_cap} Region"
    min_dist = float("inf")

    for site in landmarks:
        dist = float(np.hypot(site["lat"] - lat, site["lon"] - lon))
        if dist < min_dist:
            min_dist = dist
            nearest_name = site["name"]

    if min_dist < 18.0:
        return f"Near {nearest_name}"
    return f"{body_cap} Sector ({lat:.1f}°, {lon:.1f}°)"


print("Initialization Complete for FastAPI Backend.")


# ==============================================================================
# 3. GEODESIC, BICUBIC & HUBER/HELLINGER SCORING UTILITIES
# ==============================================================================
def normalize_longitude(lon):
    return ((np.asarray(lon) + 180.0) % 360.0) - 180.0


def haversine_km(lat1, lon1, lat2, lon2, R: float = 6371.0):
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(np.asarray(lat2) - np.asarray(lat1))
    dlambda = np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = (
        np.sin(dphi / 2.0) ** 2
        + np.cos(phi1) * np.cos(phi2) * np.sin(dlambda / 2.0) ** 2
    )
    a = np.clip(a, 0.0, 1.0)
    return 2.0 * R * np.arctan2(np.sqrt(a), np.sqrt(1.0 - a))


def bicubic_batch(body: str, lats, lons, cols: List[str]) -> np.ndarray:
    pts = np.column_stack(
        [
            np.clip(np.asarray(lats, dtype=float), -90.0, 90.0),
            normalize_longitude(np.asarray(lons, dtype=float)),
        ]
    )
    vals = CUBIC_INTERPS[body](pts)
    p = [COL_POS[c] for c in cols]
    return vals[:, p]


def bicubic_interpolate_point(
    body: str, lat: float, lon: float, feature_cols: List[str]
) -> np.ndarray:
    return bicubic_batch(body, [lat], [lon], feature_cols)[0]


def eval_masks_batch(body: str, lats, lons) -> np.ndarray:
    pts = np.column_stack(
        [
            np.clip(np.asarray(lats, dtype=float), -90.0, 90.0),
            normalize_longitude(np.asarray(lons, dtype=float)),
        ]
    )
    return MASK_INTERPS[body](pts)


def huber_similarity(diff_scaled: np.ndarray, delta: float = 1.35) -> np.ndarray:
    abs_d = np.abs(diff_scaled)
    huber_loss = np.where(
        abs_d <= delta, 0.5 * (abs_d**2), delta * (abs_d - 0.5 * delta)
    )
    return np.exp(-np.mean(huber_loss, axis=1))


def hellinger_similarity(x_sub: np.ndarray, ref_sub: np.ndarray) -> np.ndarray:
    x_pos = np.clip(x_sub, 0.0, None)
    ref_pos = np.clip(ref_sub, 0.0, None)

    x_sum = np.sum(x_pos, axis=1, keepdims=True)
    ref_sum = float(np.sum(ref_pos))
    n_cols = x_pos.shape[1]

    x_prob = np.where(x_sum > 1e-8, x_pos / np.maximum(x_sum, 1e-8), 1.0 / n_cols)
    ref_prob = (ref_pos / ref_sum) if ref_sum > 1e-8 else np.full(n_cols, 1.0 / n_cols)

    h_dist = (
        np.sqrt(np.sum((np.sqrt(x_prob) - np.sqrt(ref_prob)) ** 2, axis=1))
        / np.sqrt(2.0)
    )
    return 1.0 - np.clip(h_dist, 0.0, 1.0)

def resolve_weights(custom_weights: Optional[Dict[str, float]]) -> Dict[str, float]:
    """Merge custom weights over the defaults, drop invalid values, and normalize to sum to 1."""
    weights = dict(CATEGORY_WEIGHTS)
    for key, val in (custom_weights or {}).items():
        if key in weights and np.isfinite(val):
            weights[key] = max(float(val), 0.0)
    total = sum(weights.values())
    if total <= 0:
        return dict(CATEGORY_WEIGHTS)
    return {k: v / total for k, v in weights.items()}

def vectorized_score_vectors(
    X_candidates: np.ndarray,
    ref_vec: np.ndarray,
    local_grads=None,
    custom_weights: Optional[Dict[str, float]] = None,
):
    weights = resolve_weights(custom_weights)
    cat_scores: Dict[str, np.ndarray] = {}
    col_offset = 0
    S_total = np.zeros(len(X_candidates), dtype=float)

    for cat, cols in FEATURE_GROUPS.items():
        k = len(cols)
        X_sub = X_candidates[:, col_offset : col_offset + k]
        ref_sub = ref_vec[col_offset : col_offset + k]
        scale_sub = ROBUST_SCALE[col_offset : col_offset + k]

        if cat == "C1":
            cat_score = hellinger_similarity(X_sub, ref_sub) ** 3
        elif cat == "C4":
            diff_scaled = (X_sub - ref_sub) / (0.50 * scale_sub)
            cat_score = huber_similarity(diff_scaled, delta=0.8)
        else:
            diff_scaled = (X_sub - ref_sub) / (0.75 * scale_sub)
            cat_score = huber_similarity(diff_scaled, delta=1.0)

        cat_scores[cat] = cat_score
        S_total += cat_score * weights[cat]
        col_offset += k

    return S_total, cat_scores


# ==============================================================================
# 4. TWO-STEP PINPOINT & ERROR MODULE
# ==============================================================================
def two_step_pinpoint_analogs(
    target_body: str,
    target_lat: float,
    target_lon: float,
    top_n: int = TOP_N_DEFAULT,
    custom_weights: Optional[Dict[str, float]] = None,
    destination_body: str = "Mars",
    min_separation_km: float = 200.0,
) -> List[dict]:
    target_body_cap = target_body.capitalize()
    norm_lon = float(normalize_longitude(target_lon))

    ref_vec = bicubic_interpolate_point(
        target_body_cap, target_lat, norm_lon, ALL_FEATURE_COLS
    )

    if target_body_cap == "Earth":
        dest_body_cap = destination_body.capitalize()
        cand_df = active_df[active_df["body"] == dest_body_cap].copy()
    else:
        dest_body_cap = "Earth"
        cand_df = earth_active.copy()

    X_cand = cand_df[ALL_FEATURE_COLS].to_numpy(dtype=float)
    macro_S, _ = vectorized_score_vectors(
        X_cand, ref_vec, custom_weights=custom_weights
    )
    ranked_idx = np.argsort(-macro_S)
    macro_lats = cand_df["lat"].to_numpy()[ranked_idx]
    macro_lons = cand_df["lon"].to_numpy()[ranked_idx]

    candidates_results: List[dict] = []
    excluded_coords: List[tuple] = []

    for c_lat, c_lon in zip(macro_lats[:80], macro_lons[:80]):
        if len(candidates_results) >= top_n:
            break

        c_lat_f, c_lon_f = float(c_lat), float(c_lon)
        if excluded_coords:
            ex = np.asarray(excluded_coords, dtype=float)
            if np.any(
                haversine_km(c_lat_f, c_lon_f, ex[:, 0], ex[:, 1]) < min_separation_km
            ):
                continue
        excluded_coords.append((c_lat_f, c_lon_f))

        # Stage 2: Sub-grid pinpoint snapper on a +/-0.25 deg (41x41) mesh
        lat_mesh = np.linspace(
            max(-89.9, c_lat_f - 0.25), min(89.9, c_lat_f + 0.25), 41
        )
        lon_mesh = np.linspace(c_lon_f - 0.25, c_lon_f + 0.25, 41)
        grid_lat, grid_lon = np.meshgrid(lat_mesh, lon_mesh, indexing="ij")
        mesh_lat = np.round(grid_lat.ravel(), 4)
        mesh_lon = np.round(normalize_longitude(grid_lon.ravel()), 4)

        vec = bicubic_batch(dest_body_cap, mesh_lat, mesh_lon, ALL_FEATURE_COLS)
        S_sub, cat_sub = vectorized_score_vectors(
            vec, ref_vec, custom_weights=custom_weights
        )

        if dest_body_cap == "Earth":
            masks = eval_masks_batch("Earth", mesh_lat, mesh_lon)
            is_water = masks[:, 0] > 0.5
            ndvi = masks[:, 1]
            hydration = masks[:, 2]
            not_rainforest = (np.abs(mesh_lat) >= 13.0) | (
                (mesh_lon > 42.0) & (mesh_lon < 52.0) & (mesh_lat > 0.0)
            )
            valid_mask = (
                (~is_water)
                & not_rainforest
                & (ndvi <= MAX_EARTH_NDVI)
                & (hydration <= arid_hydration_thresh)
            )
        else:
            valid_mask = np.ones(len(mesh_lat), dtype=bool)

        if not np.any(valid_mask):
            continue

        raw_i = int(np.nanargmax(S_sub))
        valid_idx = np.flatnonzero(valid_mask)
        best_i = int(valid_idx[np.nanargmax(S_sub[valid_idx])])

        pin_lat = float(mesh_lat[best_i])
        pin_lon = float(mesh_lon[best_i])
        best_S = float(S_sub[best_i])
        best_vec = vec[best_i]

        if best_S < MIN_SUITABILITY or float(cat_sub["C1"][best_i]) < MIN_GEOLOGY_C1:
            continue

        grid_res_km = round(
            float(haversine_km(pin_lat, pin_lon, pin_lat, pin_lon + 0.0125)), 2
        )
        d_shift_km = float(
            haversine_km(mesh_lat[raw_i], mesh_lon[raw_i], pin_lat, pin_lon)
        )
        n_plateau = int(np.count_nonzero(valid_mask & (S_sub >= 0.99 * best_S)))
        plateau_spread_km = float(np.sqrt(n_plateau) * grid_res_km * 0.5)
        error_km = float(
            np.sqrt(
                grid_res_km**2
                + (0.25 * d_shift_km) ** 2
                + (0.50 * plateau_spread_km) ** 2
            )
        )

        z_diffs = (best_vec - ref_vec) / ROBUST_SCALE
        sub_sim_vals = np.exp(-0.5 * (z_diffs**2))
        sub_scores_dict = {
            col: round(float(val), 4)
            for col, val in zip(ALL_FEATURE_COLS, sub_sim_vals)
        }

        target_raw_vec = bicubic_interpolate_point(
            target_body_cap, target_lat, norm_lon, RAW_FEATURE_COLS
        )
        dest_raw_vec = bicubic_interpolate_point(
            dest_body_cap, pin_lat, pin_lon, RAW_FEATURE_COLS
        )

        raw_sim_vals = np.exp(
            -0.5 * (((dest_raw_vec - target_raw_vec) / RAW_SCALE) ** 2)
        )
        for col, val in zip(RAW_FEATURE_COLS, raw_sim_vals):
            if col not in sub_scores_dict:
                sub_scores_dict[col] = round(float(val), 4)

        sub_scores_dict["u_dust"] = sub_scores_dict["u_dust_body_z"]
        sub_scores_dict["u_wind"] = sub_scores_dict["u_wind_body_z"]
        sub_scores_dict["u_erosion"] = sub_scores_dict["u_erosion_body_z"]

        if dest_body_cap == "Earth":
            place_label = "Earth Region"
        else:
            place_label = get_extraterrestrial_place_name(
                dest_body_cap, pin_lat, pin_lon
            )

        candidates_results.append(
            {
                "body": dest_body_cap,
                "lat": pin_lat,
                "lon": pin_lon,
                "place_name": place_label,
                "S_refined": round(best_S, 4),
                "pinpoint_error_km": round(min(error_km, 50.0), 2),
                "C1": round(float(cat_sub["C1"][best_i]), 4),
                "C1_MAFIC": round(float(cat_sub["C1_MAFIC"][best_i]), 4),
                "C2": round(float(cat_sub["C2"][best_i]), 4),
                "C3": round(float(cat_sub["C3"][best_i]), 4),
                "C4": round(float(cat_sub["C4"][best_i]), 4),
                "C5": round(float(cat_sub["C5"][best_i]), 4),
                "sub_scores": sub_scores_dict,
                "target_raw": {
                    col: round(float(val), 4)
                    for col, val in zip(RAW_FEATURE_COLS, target_raw_vec)
                },
                "earth_raw": {
                    col: round(float(val), 4)
                    for col, val in zip(RAW_FEATURE_COLS, dest_raw_vec)
                },
            }
        )

    candidates_results.sort(key=lambda x: x["S_refined"], reverse=True)
    return candidates_results[:top_n]


# ==============================================================================
# 5. FASTAPI SERVER ROUTING
# ==============================================================================
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
    destinationBody: Optional[str] = "Mars"


@app.get("/api/status")
def read_status():
    return {
        "status": "Online",
        "message": "Planetary Analog Pipeline API is running!",
        "docs": "Visit http://localhost:8000/docs for interactive API testing.",
    }


@app.get("/api/placename")
def get_place_name(lat: float, lon: float):
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}&zoom=8"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "CelestialParallels/1.0 (Research Mission Brief)",
                "Accept-Language": "en",
            },
        )
        with urllib.request.urlopen(req, timeout=4) as response:
            data = json.loads(response.read().decode())
            if "address" in data:
                addr = data["address"]
                region = (
                    addr.get("city")
                    or addr.get("town")
                    or addr.get("county")
                    or addr.get("state")
                    or addr.get("region")
                    or ""
                )
                country = addr.get("country") or ""
                formatted = ", ".join([p for p in [region, country] if p])
                return {
                    "place": formatted
                    or data.get("display_name", "Remote Terrestrial Region")
                }
            return {
                "place": data.get("display_name", "Remote Terrestrial Region")
            }
    except Exception:
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
    results = two_step_pinpoint_analogs(
        req.body,
        req.lat,
        req.lon,
        top_n=TOP_N_DEFAULT,
        custom_weights=req.weights,
        destination_body=req.destinationBody or "Mars",
    )
    if not results:
        return {
            "candidates": [],
            "message": "No analogs found above the similarity threshold.",
        }
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

app.mount(
    "/", StaticFiles(directory=get_resource_path("."), html=True), name="static"
)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)