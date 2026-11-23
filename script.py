import json
import os
import sys
import threading
import time
import urllib.request
from typing import Dict, List, Optional, Tuple

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


print("--- INITIALIZING BICUBIC + HUBER/HELLINGER PINPOINT & ERROR PIPELINE ---")

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
    "C1": 0.28,
    "C1_MAFIC": 0.17,
    "C2": 0.20,
    "C3": 0.10,
    "C4": 0.05,
    "C5": 0.20,
}

TOP_N_DEFAULT: int = 5
MIN_SUITABILITY: float = 0.00
MIN_GEOLOGY_C1: float = 0.00
SHORELINE_OCEAN_QUANTILE: float = 0.280
EARTH_RADIUS_KM: float = 6371.0

FEATURES_TO_STANDARDIZE: List[str] = [
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
    values_arr = np.asarray(values, dtype=float)
    quantiles_arr = np.asarray(quantiles, dtype=float)

    valid = np.isfinite(values_arr)
    values_arr = values_arr[valid]
    if values_arr.size == 0:
        return np.full(quantiles_arr.shape, np.nan, dtype=float)

    if sample_weight is None:
        weights_arr = np.ones(values_arr.size, dtype=float)
    else:
        weights_arr = np.asarray(sample_weight, dtype=float)[valid]

    sorter = np.argsort(values_arr)
    values_sorted = values_arr[sorter]
    weights_sorted = weights_arr[sorter]
    total_weight = float(np.sum(weights_sorted))
    if total_weight <= 0.0:
        weights_sorted = np.ones_like(weights_sorted)
        total_weight = float(weights_sorted.size)

    wq = (np.cumsum(weights_sorted) - 0.5 * weights_sorted) / total_weight
    return np.interp(quantiles_arr, wq, values_sorted)


def _merge_component_layers(
    master_df: pd.DataFrame, comp_dfs: List[pd.DataFrame]
) -> pd.DataFrame:
    """Merge component DataFrames onto master without accumulating duplicate columns."""
    df_merged = master_df.copy()
    join_keys = ["body", "lat", "lon"]
    for df_comp in comp_dfs:
        overlapping = [
            col
            for col in df_comp.columns
            if col in df_merged.columns and col not in join_keys
        ]
        df_trimmed = df_comp.drop(columns=overlapping)
        df_merged = df_merged.merge(df_trimmed, on=join_keys, how="left")
    return df_merged


master = pd.read_csv(get_resource_path("Master_Suitability_S.csv"))
comp_files = ["C1.csv", "C2.csv", "C3.csv", "C4.csv", "C5.csv"]
comp_dfs = [pd.read_csv(get_resource_path(fname)) for fname in comp_files]

df_full = _merge_component_layers(master, comp_dfs)

# Shoreline quantile to exclude shallow marine shelf pixels
earth_mask_raw = df_full["body"] == "Earth"
earth_elev = df_full.loc[earth_mask_raw, "u_elevation"].to_numpy(dtype=float)
earth_lats = df_full.loc[earth_mask_raw, "lat"].to_numpy(dtype=float)
weights_lat = np.cos(np.radians(earth_lats))

earth_land_thresh = float(
    weighted_quantile(
        earth_elev,
        np.array([1.0 - SHORELINE_OCEAN_QUANTILE]),
        sample_weight=weights_lat,
    )[0]
)

# Earth water mask, NDVI proxy, and derived geological ratios
df_full["water_mask"] = (
    (df_full["body"] == "Earth") & (df_full["u_elevation"] < earth_land_thresh)
).astype(int)
df_full["ndvi"] = np.clip((df_full["u_hydration"] - 0.30) * 0.80, 0.0, 1.0)
df_full["is_valid_land"] = df_full["water_mask"] != 1
df_full["mafic_index"] = df_full["g2_basalt"] / (df_full["g1_silicate"] + 0.05)
df_full["ruggedness_ratio"] = df_full["u_roughness"] / (df_full["u_slope"] + 0.05)

# Intra-body feature standardization
for col in FEATURES_TO_STANDARDIZE:
    if col not in df_full.columns:
        continue
    new_col = f"{col}_body_z"
    df_full[new_col] = 0.0
    for body in df_full["body"].dropna().unique():
        body_mask = df_full["body"] == body
        stat_mask = (
            (body_mask & df_full["is_valid_land"]) if body == "Earth" else body_mask
        )
        vals = df_full.loc[stat_mask, col].to_numpy(dtype=float)
        mean_v = float(np.nanmean(vals))
        std_v = float(np.nanstd(vals))
        if not np.isfinite(std_v) or std_v == 0.0:
            std_v = 1.0
        df_full.loc[body_mask, new_col] = (
            df_full.loc[body_mask, col].to_numpy(dtype=float) - mean_v
        ) / std_v

# 1. Ice sheet mask: true polar ice caps
is_ice_sheet = (
    (df_full["body"] == "Earth")
    & (df_full["lat"].abs() > 62.0)
    & (df_full["z_Tmean_body_z"] < -1.80)
    & (df_full["u_roughness_body_z"] < -0.35)
)

# 2. Aridity mask using actual eolian dust & erosion layers
is_humid_forest = (
    (df_full["body"] == "Earth")
    & (df_full["u_dust_body_z"] < -0.25)
    & (df_full["lat"].abs() < 60.0)
)

df_full["ice_mask"] = is_ice_sheet.astype(int)
df_full["veg_mask"] = (is_humid_forest & (~is_ice_sheet)).astype(int)

active_df = df_full[df_full["is_valid_land"]].copy().reset_index(drop=True)
earth_all = active_df[active_df["body"] == "Earth"].copy()

# Standard barren/arid terrestrial pool
not_tropical_wet = (earth_all["lat"].abs() >= 14.0) | (
    (earth_all["lon"] > 42.0) & (earth_all["lon"] < 52.0) & (earth_all["lat"] > 0.0)
)
barren_mask = (
    not_tropical_wet
    & (earth_all["ice_mask"] == 0)
    & (earth_all["veg_mask"] == 0)
)
earth_active = earth_all[barren_mask].copy().reset_index(drop=True)
if earth_active.empty:
    earth_active = earth_all[not_tropical_wet].copy().reset_index(drop=True)

# Polar cold-trap pool directly from earth_all
polar_mask = (earth_all["lat"].abs() > 75.0) & (earth_all["ice_mask"] == 1)
earth_polar = earth_all[polar_mask].copy().reset_index(drop=True)

_NEEDED = list(
    dict.fromkeys(
        ALL_FEATURE_COLS
        + RAW_FEATURE_COLS
        + ["water_mask", "ice_mask", "veg_mask", "ndvi"]
    )
)
COL_POS = {c: i for i, c in enumerate(_NEEDED)}

# Robust Earth scale using MAD and IQR on barren rock/regolith pool
X_earth = earth_active[ALL_FEATURE_COLS].to_numpy(dtype=float)
EARTH_MEDIANS = np.nanmedian(X_earth, axis=0)
mad = np.nanmedian(np.abs(X_earth - EARTH_MEDIANS), axis=0) * 1.4826
q_scale = iqr(X_earth, axis=0, nan_policy="omit") / 1.349
raw_scale = np.where(mad > 1e-5, mad, np.where(q_scale > 1e-5, q_scale, 1.0))
ROBUST_SCALE = np.maximum(raw_scale, 0.15)
FEATURE_STDS = ROBUST_SCALE

X_earth_polar = earth_polar[ALL_FEATURE_COLS].to_numpy(dtype=float)

raw_earth_matrix = earth_active[RAW_FEATURE_COLS].to_numpy(dtype=float)
raw_mad = (
    np.nanmedian(
        np.abs(raw_earth_matrix - np.nanmedian(raw_earth_matrix, axis=0)), axis=0
    )
    * 1.4826
)
RAW_SCALE = np.maximum(raw_mad, 0.15)

# Bicubic interpolators for continuous features + nearest-neighbor for combined masks
CUBIC_INTERPS: Dict[str, RegularGridInterpolator] = {}
MASK_INTERPS: Dict[str, RegularGridInterpolator] = {}

for b in ["Earth", "Moon", "Mars"]:
    if not (df_full["body"] == b).any():
        continue

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

    # Combined exclusion mask: 1 = water, 2 = ice sheet, 4 = vegetated/humid
    combined_mask = (
        sub["water_mask"].to_numpy(dtype=float)
        + 2.0 * sub["ice_mask"].to_numpy(dtype=float)
        + 4.0 * sub["veg_mask"].to_numpy(dtype=float)
    ).reshape(len(lats_u), len(lons_u))

    MASK_INTERPS[b] = RegularGridInterpolator(
        (lats_u, lons_u),
        combined_mask,
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
    """Wrap longitudes to [-180.0, 180.0)."""
    return ((np.asarray(lon, dtype=float) + 180.0) % 360.0) - 180.0


def haversine_km(lat1, lon1, lat2, lon2, R: float = EARTH_RADIUS_KM):
    """Great-circle distance in kilometers using the Haversine formula."""
    phi1 = np.radians(lat1)
    phi2 = np.radians(lat2)
    dphi = np.radians(np.asarray(lat2, dtype=float) - np.asarray(lat1, dtype=float))
    dlambda = np.radians(np.asarray(lon2, dtype=float) - np.asarray(lon1, dtype=float))
    a = (
        np.sin(dphi / 2.0) ** 2
        + np.cos(phi1) * np.cos(phi2) * np.sin(dlambda / 2.0) ** 2
    )
    a = np.clip(a, 0.0, 1.0)
    return 2.0 * R * np.arctan2(np.sqrt(a), np.sqrt(1.0 - a))


def bicubic_batch(body: str, lats, lons, cols: List[str]) -> np.ndarray:
    """Evaluate bicubic interpolator for a batch of (lat, lon) coordinates."""
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
    """Evaluate bicubic interpolator for a single coordinate."""
    return bicubic_batch(body, [lat], [lon], feature_cols)[0]


def huber_similarity(diff_scaled: np.ndarray, delta: float = 1.35) -> np.ndarray:
    """Compute similarity from scaled residuals using Huber loss."""
    abs_d = np.abs(diff_scaled)
    huber_loss = np.where(
        abs_d <= delta, 0.5 * (abs_d**2), delta * (abs_d - 0.5 * delta)
    )
    return np.exp(-np.mean(huber_loss, axis=1))


def hellinger_similarity(x_sub: np.ndarray, ref_sub: np.ndarray) -> np.ndarray:
    """Compute bounded Hellinger similarity for compositional vectors."""
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
) -> Tuple[np.ndarray, Dict[str, np.ndarray]]:
    """Score candidate feature vectors with multiplicative mineralogical gating."""
    weights = resolve_weights(custom_weights)
    cat_scores: Dict[str, np.ndarray] = {}
    col_offset = 0
    s_raw = np.zeros(len(X_candidates), dtype=float)

    for cat, cols in FEATURE_GROUPS.items():
        k = len(cols)
        X_sub = X_candidates[:, col_offset : col_offset + k]
        ref_sub = ref_vec[col_offset : col_offset + k]
        scale_sub = ROBUST_SCALE[col_offset : col_offset + k]

        if cat == "C1":
            cat_score = hellinger_similarity(X_sub, ref_sub) ** 3
        elif cat == "C1_MAFIC":
            diff_scaled = (X_sub - ref_sub) / (0.65 * scale_sub)
            cat_score = huber_similarity(diff_scaled, delta=1.0)
        else:
            diff_scaled = (X_sub - ref_sub) / (0.75 * scale_sub)
            cat_score = huber_similarity(diff_scaled, delta=1.0)

        cat_scores[cat] = cat_score
        s_raw += cat_score * weights[cat]
        col_offset += k

    # Soft geological gate prevents flat non-volcanic basins from scoring overly high
    c1_total_weight = weights["C1"] + weights["C1_MAFIC"]
    if c1_total_weight > 0.0:
        c1_combined = (
            cat_scores["C1"] * weights["C1"]
            + cat_scores["C1_MAFIC"] * weights["C1_MAFIC"]
        ) / c1_total_weight
    else:
        c1_combined = 0.5 * (cat_scores["C1"] + cat_scores["C1_MAFIC"])
    cat_scores["C1_COMBINED"] = c1_combined

    geo_gate = 0.40 + 0.60 * c1_combined
    S_total = s_raw * geo_gate
    return S_total, cat_scores


# ==============================================================================
# 4. TWO-STEP PINPOINT & ERROR MODULE
# ==============================================================================
def _build_subgrid_mesh(c_lat: float, c_lon: float) -> Tuple[np.ndarray, np.ndarray]:
    """Build a deduplicated +/-0.25 deg (25x25) sub-grid around a candidate point."""
    lat_mesh = np.linspace(max(-89.9, c_lat - 0.25), min(89.9, c_lat + 0.25), 25)
    lon_mesh = np.linspace(c_lon - 0.25, c_lon + 0.25, 25)
    lat_grid, lon_grid = np.meshgrid(lat_mesh, lon_mesh, indexing="ij")

    la_r = np.round(lat_grid.ravel(), 4)
    lo_r = np.round(normalize_longitude(lon_grid.ravel()), 4)

    coords = np.column_stack([la_r, lo_r])
    _, unique_idx = np.unique(coords, axis=0, return_index=True)
    unique_idx = np.sort(unique_idx)
    return la_r[unique_idx], lo_r[unique_idx]


def _safe_nanargmax(arr: np.ndarray) -> Optional[int]:
    """Return index of maximum finite value, or None if all values are NaN/non-finite."""
    finite_mask = np.isfinite(arr)
    if not np.any(finite_mask):
        return None
    finite_indices = np.flatnonzero(finite_mask)
    return int(finite_indices[np.argmax(arr[finite_indices])])


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
    is_polar_target = abs(target_lat) >= 80.0

    if target_body_cap not in CUBIC_INTERPS:
        raise ValueError(f"Interpolator not available for body '{target_body_cap}'.")

    # Stage 1: Regional macro filter
    ref_vec = bicubic_interpolate_point(
        target_body_cap, target_lat, norm_lon, ALL_FEATURE_COLS
    )

    if target_body_cap == "Earth":
        dest_body_cap = destination_body.capitalize()
        cand_df = active_df[active_df["body"] == dest_body_cap].copy()
        X_cand = cand_df[ALL_FEATURE_COLS].to_numpy(dtype=float)
    else:
        dest_body_cap = "Earth"
        if is_polar_target and len(earth_polar) > 0:
            cand_df = earth_polar
            X_cand = X_earth_polar
        else:
            cand_df = earth_active
            X_cand = X_earth

    macro_S, _ = vectorized_score_vectors(
        X_cand, ref_vec, custom_weights=custom_weights
    )
    ranked_idx = np.argsort(-np.nan_to_num(macro_S, nan=-np.inf))
    macro_lats = cand_df["lat"].to_numpy()[ranked_idx]
    macro_lons = cand_df["lon"].to_numpy()[ranked_idx]

    candidates_results: List[dict] = []
    excluded_coords: List[Tuple[float, float]] = []

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

        # Stage 2: Sub-grid pinpoint snapper on a +/-0.25 deg (25x25) deduplicated mesh
        mesh_lat, mesh_lon = _build_subgrid_mesh(c_lat_f, c_lon_f)
        if mesh_lat.size == 0:
            continue

        vec = bicubic_batch(dest_body_cap, mesh_lat, mesh_lon, ALL_FEATURE_COLS)
        S_sub, cat_sub = vectorized_score_vectors(
            vec, ref_vec, custom_weights=custom_weights
        )

        if dest_body_cap == "Earth":
            pts = np.column_stack([mesh_lat, mesh_lon])
            mask_code = MASK_INTERPS["Earth"](pts).astype(int)
            is_water = (mask_code & 1) != 0
            is_ice = (mask_code & 2) != 0
            is_veg = (mask_code & 4) != 0

            not_tropical_wet = (np.abs(mesh_lat) >= 13.0) | (
                (mesh_lon > 42.0) & (mesh_lon < 52.0) & (mesh_lat > 0.0)
            )
            if is_polar_target:
                valid_mask = (~is_water) & (~is_veg)
            else:
                valid_mask = (~is_water) & (~is_ice) & (~is_veg) & not_tropical_wet
        else:
            valid_mask = np.ones(len(mesh_lat), dtype=bool)

        if not np.any(valid_mask):
            continue

        raw_i = _safe_nanargmax(S_sub)
        if raw_i is None:
            continue

        valid_idx = np.flatnonzero(valid_mask)
        best_rel = _safe_nanargmax(S_sub[valid_idx])
        if best_rel is None:
            continue
        best_i = int(valid_idx[best_rel])

        pin_lat = float(mesh_lat[best_i])
        pin_lon = float(mesh_lon[best_i])
        best_S = float(S_sub[best_i])
        best_c1 = float(cat_sub["C1_COMBINED"][best_i])
        best_vec = vec[best_i]

        if best_S < MIN_SUITABILITY or best_c1 < MIN_GEOLOGY_C1:
            continue

        grid_res_km = round(
            float(haversine_km(pin_lat, pin_lon, pin_lat, pin_lon + 0.01)), 2
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
                "pinpoint_error_km": round(min(error_km, 10.0), 2),
                "C1": round(best_c1, 4),
                "C1_RAW": round(float(cat_sub["C1"][best_i]), 4),
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