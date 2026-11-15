import numpy as np
import pandas as pd
from scipy.spatial import KDTree

print("--- INITIALIZING BULLETPROOF ANALOG PIPELINE WITH MAHALANOBIS ERROR CORRECTION ---")

# 1. Load Datasets
master = pd.read_csv('Master_Suitability_S.csv')
c1 = pd.read_csv('C1.csv')
c2 = pd.read_csv('C2.csv')
c3 = pd.read_csv('C3.csv')
c4 = pd.read_csv('C4.csv')
c5 = pd.read_csv('C5.csv')

# Merge datasets
df_full = master.merge(c1, on=['body', 'lat', 'lon'], suffixes=('', '_c1'))
for df_comp in [c2, c3, c4, c5]:
    df_full = df_full.merge(df_comp, on=['body', 'lat', 'lon'], suffixes=('', '_dup'))
df_full = df_full.loc[:, ~df_full.columns.str.endswith('_dup')]

def apply_bulletproof_preprocessing(df):
    """
    Applies area-weighted subaerial land masking and computes Z-scores strictly
    on valid continental land for Earth, eliminating ocean/shelf contamination.
    """
    df_out = df.copy()

    # Area-weighted quantile calculation for Earth (accounting for latitudinal grid convergence)
    earth_mask_raw = df_out['body'] == 'Earth'
    earth_elev = df_out.loc[earth_mask_raw, 'u_elevation'].values
    earth_lats = df_out.loc[earth_mask_raw, 'lat'].values
    weights_lat = np.cos(np.radians(earth_lats))

    def weighted_quantile(values, quantiles, sample_weight=None):
        values = np.array(values)
        quantiles = np.array(quantiles)
        if sample_weight is None: sample_weight = np.ones(len(values))
        sample_weight = np.array(sample_weight)
        sorter = np.argsort(values)
        values = values[sorter]
        sample_weight = sample_weight[sorter]
        wq = np.cumsum(sample_weight) - 0.5 * sample_weight
        wq /= np.sum(sample_weight)
        return np.interp(quantiles, wq, values)

    earth_land_thresh = weighted_quantile(earth_elev, [1.0 - 0.292], sample_weight=weights_lat)[0]
    print(f"Area-Weighted Earth Land Threshold (u_elevation >= {earth_land_thresh:.4f}):")

    # Absolute Earth Land Mask
    is_earth_ocean = earth_mask_raw & (df_out['u_elevation'] < earth_land_thresh)
    df_out['is_valid_land'] = ~is_earth_ocean

    # Standardize features per body using ONLY valid land rows for Earth
    features_to_std = ['z_Tmean', 'z_Trange', 'z_illum', 'u_elevation', 'u_slope', 'u_roughness']
    for col in features_to_std:
        if col in df_out.columns:
            new_col = f"{col}_body_z"
            df_out[new_col] = 0.0
            for body in df_out['body'].unique():
                if body == 'Earth':
                    stat_mask = (df_out['body'] == 'Earth') & (df_out['is_valid_land'])
                else:
                    stat_mask = df_out['body'] == body

                vals = df_out.loc[stat_mask, col].values
                mean_v, std_v = np.mean(vals), np.std(vals)
                if std_v == 0: std_v = 1.0

                body_mask = df_out['body'] == body
                df_out.loc[body_mask, new_col] = (df_out.loc[body_mask, col].values - mean_v) / std_v

    return df_out

df_processed = apply_bulletproof_preprocessing(df_full)
print(f"Total Rows in Dataset       : {len(df_processed):,}")
print(f"Valid Terrestrial Land Rows : {df_processed['is_valid_land'].sum():,} (Oceans & submarine ridges purged)\n")

def spherical_to_cartesian(lat, lon, radius=1.0):
    lat_rad, lon_rad = np.radians(lat), np.radians(lon)
    return np.column_stack((radius * np.cos(lat_rad) * np.cos(lon_rad),
                            radius * np.cos(lat_rad) * np.sin(lon_rad),
                            radius * np.sin(lat_rad)))

def compute_scientific_similarity_with_error_factor(df, reference_lat, reference_lon, reference_body):
    """
    Computes Gaussian RBF similarity integrated with a scientifically rigorous 
    covariance error factor (Mahalanobis-informed distance adjustment).
    """
    active_df = df[df['is_valid_land']].copy().reset_index(drop=True)
    body_df = df[df['body'].str.lower() == reference_body.lower()].reset_index(drop=True)

    ref_row = active_df[(active_df['body'].str.lower() == reference_body.lower()) &
                        (active_df['lat'] == reference_lat) &
                        (active_df['lon'] == reference_lon)]
    if ref_row.empty:
        ref_row = body_df[(body_df['lat'] == reference_lat) & (body_df['lon'] == reference_lon)]
        if ref_row.empty:
            raise ValueError(f"Reference coordinates ({reference_lat}, {reference_lon}) on {reference_body} not found.")

    groups = {
        'C1': ['g1_silicate', 'g2_basalt', 'g3_iron_oxide', 'g4_plagioclase', 'g5_igneous', 'g6_sedimentary', 'g7_metamorphic', 'g8_regolith'],
        'C2': ['u_elevation_body_z', 'u_slope_body_z', 'u_roughness_body_z', 'u_crater'],
        'C3': ['z_Tmean_body_z', 'z_Trange_body_z', 'z_illum_body_z'],
        'C4': ['u_ice', 'u_depth', 'u_permafrost', 'u_hydration'],
        'C5': ['u_dust', 'u_wind', 'u_erosion']
    }

    scores = pd.DataFrame({'body': active_df['body'], 'lat': active_df['lat'], 'lon': active_df['lon']})
    category_scores = {}

    for cat, cols in groups.items():
        valid_cols = [c for c in cols if c in active_df.columns]
        if not valid_cols: continue
        X = active_df[valid_cols].values
        ref_vec = ref_row[valid_cols].values[0]

        # Compute empirical covariance matrix and invert for Mahalanobis distance
        # Added ridge regularization (epsilon) to ensure mathematical stability
        cov_matrix = np.cov(X, rowvar=False) + np.eye(X.shape[1]) * 1e-4
        inv_cov = np.linalg.pinv(cov_matrix)

        # Mahalanobis Error Factor adjustment per feature vector
        diff = X - ref_vec
        mahal_dist_sq = np.sum(np.dot(diff, inv_cov) * diff, axis=1)
        
        # Normalized error factor scaling based on degrees of freedom (dimensionality k)
        k = len(valid_cols)
        error_factor = 1.0 / (1.0 + (mahal_dist_sq / k))

        gamma = 1.0 / k
        # Combined Gaussian RBF kernel with Mahalanobis covariance error factor
        category_scores[cat] = np.exp(-gamma * mahal_dist_sq) * error_factor
        scores[cat] = category_scores[cat]

    cat_df = pd.DataFrame(category_scores)
    weights = {'C1': 0.2, 'C2': 0.25, 'C3': 0.2, 'C4': 0.2, 'C5': 0.15}
    scores['S_advanced'] = sum(cat_df[cat] * weights[cat] for cat in cat_df.columns)
    return scores

def find_top_terrestrial_analogs(df, target_body, target_lat, target_lon, top_n=10):
    body_df = df[df['body'].str.lower() == target_body.lower()].reset_index(drop=True)
    body_coords_3d = spherical_to_cartesian(body_df['lat'].values, body_df['lon'].values)
    tree = KDTree(body_coords_3d)

    query_3d = spherical_to_cartesian(np.array([target_lat]), np.array([target_lon]))
    _, idx = tree.query(query_3d)
    snapped_row = body_df.iloc[idx[0]]

    print(f"\nTarget Input : {target_body} ({target_lat}°, {target_lon}°)")
    print(f"Snapped Node : {target_body} ({snapped_row['lat']}°, {snapped_row['lon']}°)")

    all_scores = compute_scientific_similarity_with_error_factor(df, snapped_row['lat'], snapped_row['lon'], snapped_row['body'])
    earth_analogs = all_scores[all_scores['body'] == 'Earth'].copy()

    top_matches = earth_analogs.sort_values(by='S_advanced', ascending=False).head(top_n).reset_index(drop=True)
    top_matches.index = top_matches.index + 1
    top_matches.index.name = 'Rank'
    return top_matches

def show_results(df_results, cols):
    output_subset = df_results[cols]
    try:
        display(output_subset)
    except NameError:
        print(output_subset.to_string())

# ==============================================================================
# BATCH TESTING ALL 20 SITES
# ==============================================================================

reference_sites = [
    # Moon Sites
    ("Moon", 9.62, -20.08, "Copernicus Crater"),
    ("Moon", -58.4, -14.4, "Clavius Crater"),
    ("Moon", 51.6, -9.3, "Plato Crater"),
    ("Moon", 32.8, -15.6, "Mare Imbrium"),
    ("Moon", 28.0, 17.5, "Mare Serenitatis"),
    ("Moon", -44.45, 176.25, "Von Kármán Crater"),
    # Mars Sites
    ("Mars", -5.37, 137.81, "Gale Crater"),
    ("Mars", -42.43, 70.50, "Hellas Planitia"),
    ("Mars", 25.02, 147.21, "Elysium Mons"),
    ("Mars", -8.26, 239.91, "Arsia Mons"),
    ("Mars", 46.74, 117.52, "Utopia Planitia"),
    ("Mars", -49.84, 316.69, "Argyre Planitia")
]

for body, lat, lon, name in reference_sites:
    print(f"\n==================================================")
    print(f"ANALOG SEARCH: {name} ({body})")
    print(f"==================================================")
    results = find_top_terrestrial_analogs(df_processed, target_body=body, target_lat=lat, target_lon=lon, top_n=5)
    show_results(results, ['body', 'lat', 'lon', 'S_advanced', 'C1', 'C2', 'C3', 'C4', 'C5'])