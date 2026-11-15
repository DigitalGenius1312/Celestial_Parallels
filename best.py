import numpy as np
from scipy.ndimage import uniform_filter
from scipy.spatial.distance import cosine
import cv2

class PlanetaryTopographicMatcher:
    def __init__(self, target_dem, resolution_m=1.0):
        """
        target_dem: 2D numpy array of the target region (Moon/Mars)
        resolution_m: Grid resolution in metres per pixel
        """
        self.target_dem = target_dem
        self.res = resolution_m
        self.target_features = self.extract_features(target_dem)
        self.base_similarity = 1.0  # Perfect match reference

    def extract_features(self, dem):
        """Extracts topographic feature descriptors from a DEM patch."""
        # Gradients for slope and aspect
        dy, dx = np.gradient(dem, self.res)
        slope = np.arctan(np.sqrt(dx**2 + dy**2))

        # Curvature approximations
        dxx = np.gradient(dx, self.res, axis=1)
        dyy = np.gradient(dy, self.res, axis=0)
        curvature = dxx + dyy

        # Terrain Roughness Index (TRI) using local standard deviation
        mean_dem = uniform_filter(dem, size=3)
        roughness = np.abs(dem - mean_dem)

        # Flatten and combine into a feature vector descriptor
        feature_vector = np.concatenate([
            slope.flatten(),
            curvature.flatten(),
            roughness.flatten()
        ])
        # Normalize vector
        norm = np.linalg.norm(feature_vector)
        if norm > 0:
            feature_vector = feature_vector / norm
        return feature_vector

    def compute_similarity(self, candidate_features):
        """Computes cosine similarity between target and candidate feature vectors."""
        # Ensure vectors are same length by padding or truncating if shapes differ slightly
        min_len = min(len(self.target_features), len(candidate_features))
        v1 = self.target_features[:min_len]
        v2 = candidate_features[:min_len]

        # Cosine similarity (1.0 = identical, 0.0 = orthogonal)
        return 1.0 - cosine(v1, v2)

    def adaptive_region_growth(self, earth_dem, seed_y, seed_x, initial_radius_m=200):
        """
        Grows an irregular region outward from a seed point on Earth DEM
        until the similarity coefficient shifts by > 5%.
        """
        pixel_radius = int(initial_radius_m / self.res)
        h, w = earth_dem.shape

        # 1. Extract initial 200m radius circular/masked seed region
        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.circle(mask, (seed_x, seed_y), pixel_radius, 1, -1)

        current_region_mask = mask.copy()
        current_dem_patch = earth_dem * current_region_mask
        current_features = self.extract_features(current_dem_patch)

        initial_similarity = self.compute_similarity(current_features)
        prev_similarity = initial_similarity

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

        expansion_step = 0
        max_steps = 200  # Safety limit

        while expansion_step < max_steps:
            # Dilate the region irregularly based on local topography gradient/continuity
            dilated_mask = cv2.dilate(current_region_mask, kernel)

            # Find newly added border pixels
            frontier_mask = dilated_mask - current_region_mask
            if np.sum(frontier_mask) == 0:
                break  # Cannot expand further

            # Extract expanded patch features
            expanded_dem_patch = earth_dem * dilated_mask
            expanded_features = self.extract_features(expanded_dem_patch)

            current_similarity = self.compute_similarity(expanded_features)

            # Calculate percentage shift relative to initial similarity
            percentage_shift = abs(current_similarity - initial_similarity) / initial_similarity * 100.0

            # Stopping Condition: Shift exceeds 5%
            if percentage_shift > 5.0:
                print(f"Stopping expansion at step {expansion_step}: "
                      f"Similarity shifted by {percentage_shift:.2f}% (exceeds 5% threshold).")
                break

            # Accept expansion
            current_region_mask = dilated_mask
            prev_similarity = current_similarity
            expansion_step += 1

        return current_region_mask, current_similarity, percentage_shift