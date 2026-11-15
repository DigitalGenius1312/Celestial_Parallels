import numpy as np
import pandas as pd

# Load your CSV file (make sure 'data.csv' is the exact name of your file)
df_master = pd.read_csv("Master_Suitability_S.csv")

# Your existing code
target_row = df_master[
    (df_master["body"] == "Moon")
    & (df_master["lat"] == 8.5)
    & (df_master["lon"] == 31.5)
].iloc[0]
S_c = target_row["S"]

earth_matches = df_master[
    (df_master["body"] == "Earth")
    & (np.abs(df_master["S"] - S_c) / S_c <= 0.005)
]

print(
    f"Target Moon S_c = {S_c:.4f} | Matching Earth 0.5° cells found:"
    f" {len(earth_matches)}"
)
print(earth_matches.head(10))