# Celestial Parallels (v1.2.0)

**Planetary Analog Site Selection Model & Interactive 3D Digital Twin Explorer**  
**Publication & Methodology:** [[Celestial Parallels: Mapping Lunar and Martian Sites to Terrestrial Analogs](https://doi.org/10.5281/zenodo.24465634)]

---

### **1. Project Functionality & Architecture**

The project pairs a Planetary Analog Site Selection Model with an interactive 3D web visualization engine to map locations on the Moon and Mars to geologically and environmentally similar dry-land counterparts on Earth.

The architecture is a two-stage funnel behind a FastAPI backend, with a CesiumJS 3D digital twin as the front end:

- **Phase 1: Data Ingestion & Harmonization.** Merges 0.5-degree planetary grids for Earth, the Moon and Mars on (body, lat, lon). The 22 raw parameters fall into five categories: mineralogy/geology (C1), terrain/topography (C2), thermal/illumination (C3), water/ice resources (C4), and atmospheric/dust dynamics (C5). Scoring uses a 15-feature vector in six weighted groups: C1 mineral fractions (`g1_silicate`, `g2_basalt`, `g4_plagioclase`), C1_MAFIC (mafic index), C2, C3, C4 and C5. All 22 raw parameters are kept for the side-by-side comparison.
- **Phase 2: Masking & Standardization.**
  - Earth is restricted to land using a cos(latitude)-weighted elevation quantile that retains 28.0% of area, which also excludes shallow shelf cells.
  - Eleven variables are Z-scored independently per body, and two indices are derived first: the mafic index `g2_basalt / (g1_silicate + 0.05)` and the ruggedness ratio `u_roughness / (u_slope + 0.05)`.
  - An ice-sheet mask (`|lat| > 62°`, cold, smooth) and a humid-surface mask (`|lat| < 60°`, low standardized dust) are computed for Earth.
  - The main Earth candidate pool is land that is neither ice nor humid and lies outside the tropics (`|lat| >= 14°`, with a Horn of Africa exception). A separate polar ice pool (`|lat| > 75°`) serves polar targets.
  - Robust per-feature scales use the median absolute deviation (MAD) of the main Earth pool, with an IQR fallback and a floor of 0.15.
- **Phase 3: Stage 1 Regional Filter (Macro Search).** Interpolates the target's feature vector with bicubic (tensor-product cubic spline) interpolation, then scores every Earth candidate cell by category:
  - C1 uses Hellinger similarity on the normalized mineral fractions, cubed.
  - The mafic index, C2, C3, C4 and C5 use Huber-loss similarity on robust-scaled residuals.
  - The weighted sum is multiplied by a soft mineralogical gate, `0.40 + 0.60 × (combined C1 score)`, so flat non-volcanic basins cannot score highly on topography alone.
  - Cells are ranked and the top 80 are examined, keeping candidates at least 200 km apart until five are found.
- **Phase 4: Stage 2 Pinpoint Snapper (Micro Refinement).** Refines each macro cell on a 25 × 25 mesh spanning ±0.25° (about 2.3 km spacing) with bicubic interpolation. Mesh points in water, ice (except for polar targets), humid surfaces, or the tropics are excluded, and the highest-scoring valid point becomes the pinpoint.
- **Phase 5: Uncertainty Modeling & Multi-Parameter Scoring.** Computes a heuristic error radius (capped at 10 km) from the local resolution, the shift between the unfiltered and filtered peaks, and the width of the near-optimal plateau. It also returns a per-parameter similarity for all 22 raw parameters.
- **Phase 6: 3D Visualization, Tuning & Reporting.** A CesiumJS explorer renders multi-ellipsoid bodies, error overlays, reverse-geocoded English terrestrial region names, C1–C5 weight sliders with nine presets, side-by-side physical comparisons, and CSV and Mission Brief exports.

**Weights.** When no weights are supplied, the backend uses `C1 0.28, C1_MAFIC 0.17, C2 0.20, C3 0.10, C4 0.05, C5 0.20`. Weights sent by the interface are merged over these defaults, invalid values are discarded, and the result is renormalized to sum to 1, so suitability always stays within 0–100%. The mafic index has no slider and keeps its default before renormalization.

---

### **2. Key Benefits**

- **Surface-Aware Matching:** Land, ice-sheet and humid-surface masks keep the search on subaerial terrain and prevent pairings such as Martian impact craters to Earth's oceanic trenches.
- **Robust, Type-Appropriate Scoring:** Compositional mineral fractions are compared with Hellinger similarity, and continuous variables with Huber-loss similarity, so a single extreme feature cannot drive a category to zero.
- **Localized Pinpoints with an Explicit Uncertainty Estimate:** Bicubic interpolation plus local mesh snapping. On the 20 benchmark targets in the paper, the rank-1 error radii range from 1.0 to 6.8 km (mean 2.5 km).
- **Granular 22-Parameter Transparency:** Breakdowns across Mineralogy (C1), Topography (C2), Thermal Properties (C3), Subsurface Resources (C4), and Eolian Dynamics (C5).
- **Mission-Specific Weight Tuning:** Adjust category importance directly, or start from nine presets: *Balanced*, *Rover Mobility*, *ISRU and Ice Drilling*, *Geologic Science*, *Astrobiology*, *Landing Site Safety*, *Thermal and Power*, *Aeolian Processes* and *Hardware Testing*.
- **Side-by-Side Physical Verification:** Instant inspection of target vs. Earth measurements (basalt fraction, iron oxide, elevation, mean temperature and more).
- **A Clean, Accessible Interface:** Responsive docked panels, keyboard navigation, screen-reader labels, and non-blocking notifications.
- **High Computational Efficiency:** Vectorized NumPy scoring and precomputed interpolators, masks and pools. Each query in the 20-target benchmark completed in under 50 ms.

---

### **3. Intended Impact**

- **Mission Planning & Rover Traverses:** Identifies terrestrial analogs mirroring the mineralogical, topographic and thermal conditions of targets like Gale/Jezero Crater or Shackleton Crater.
- **Astronaut & Analog Training:** Provides geographic analogs for testing spacesuits, habitats, and In-Situ Resource Utilization (ISRU) technology.
- **Educational Engagement:** Lets students and enthusiasts explore planetary topography and run geospatial queries in an open-access 3D interface.

---

### **4. Limitations**

Please read these before using results for planning:

- **No gravity.** The model does not factor gravity into its calculations, so behavior under free fall, gravity-dependent eolian dynamics, rover locomotion and astronaut mobility are not represented.
- **No biological, habitability or certain subsurface factors.** These are not part of the feature set.
- **Coastal water bodies.** Although the search is restricted to terrestrial analogs, the algorithm can still occasionally return water bodies near coastlines, because masks are read from a 0.5° grid.
- **No quantitative ground-truth validation.** The geological review in the paper is qualitative, and the error radius is a heuristic, not a calibrated bound.
- **Shallow ranking.** The five returned candidates often score within a point or two of each other, sometimes in very different regions. Treat the list as a set of comparable alternatives, not a strict ordering.
- **Surface filters are proxies.** The humid-surface mask uses standardized dust as a proxy, so some humid, vegetated regions can still be returned.
- **Hand-set constants.** Residual scales, the gate, mask thresholds and default weights were chosen by hand, and their sensitivity has not been tested.

---

### **5. Technology Stack**

- **Languages:** Python (backend calculation engine), JavaScript ES6+ (front-end logic), HTML5 / CSS3.
- **Data Science & Math:** Pandas, NumPy, SciPy (`RegularGridInterpolator` for bicubic and nearest-neighbor interpolation, robust statistics).
- **Backend:** FastAPI (REST API routing), Uvicorn (ASGI server).
- **Geospatial & 3D:** CesiumJS v1.115 (3D globe engine), Cesium Ion 3D Tilesets, OpenStreetMap Nominatim (English-localized reverse geocoding).
- **Interface:** Hand-written CSS design system with design tokens, set in Public Sans and Source Serif 4.
- **Packaging & Environment:** PyInstaller, GitHub Actions CI/CD, Code OSS on Arch Linux, and VS Code on Windows 11.

---

### **6. Design Notes & Challenges Addressed**

- **Macro-to-Micro Search:** A fast global ranking over the 0.5° grid, followed by local bicubic refinement of only the best candidates.
- **Latitudinal Grid Convergence:** cos(latitude) weights are used when computing the land threshold, to account for meridian convergence near the poles.
- **Climatic & Atmospheric Skews:** Strict intra-body Z-score normalization bridges extreme pressure and temperature gaps between bodies.
- **Polar Targets:** Targets poleward of 80° are matched against a dedicated Earth ice-sheet pool, and ice is allowed in their Stage 2 filter.
- **Weight Normalization:** Weights are always renormalized to sum to 1, so suitability never exceeds 100% for any preset or slider setting.
- **Asynchronous Latency Management:** Lightweight JSON payloads and asynchronous fetch requests keep the UI responsive during sub-grid calculations.

---

### **7. How to Download & Use**

You can run **Celestial Parallels** as a pre-built standalone desktop application or directly from source.

#### Option A: Download the Pre-Built Desktop App (Recommended)

1. Download the packaged application archive for your OS from the [Releases](https://github.com/DigitalGenius1312/Celestial_Parallels/releases) page:
  - **Windows:** `Celestial-Parallels-windows-latest.zip`
  - **macOS:** `Celestial-Parallels-macos-latest.zip`
  - **Linux:** `Celestial-Parallels-ubuntu-latest.zip` *(compatible with Ubuntu 24.04+, Debian 12+, Linux Mint 22+, Pop!_OS, Fedora, and Arch-based distributions)*
2. Extract the `.zip` archive into a local folder.
3. Launch the application:
  - **Windows:** Double-click `Celestial Parallels.exe` *(click **More info** -> **Run anyway** if SmartScreen prompts)*.
  - **macOS:** Right-click (or `Control`-click) `Celestial Parallels.app` -> **Open** -> **Open**.
  - **Linux:** Open a terminal in the extracted directory and run:
     ```bash
     chmod +x "Celestial Parallels"
     rm -f _internal/libreadline*
     ./"Celestial Parallels"
     ```

#### Option B: Run from Source (For Developers)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/DigitalGenius1312/Celestial_Parallels
   cd Celestial_Parallels
   pip install -r requirements.txt
   ```
2. Verify dataset CSVs (`Master_Suitability_S.csv`, `C1.csv`–`C5.csv`) sit alongside `script.py` and run:
   ```bash
   python desktop_app.py
   ```

#### Explorer Controls
* **Navigation:** Switch worlds with the **Earth / Mars / Moon** switcher at the top (or press `1`, `2`, `3`); left-click to rotate/pan; use middle mouse drag for Z-axis tilt (Earth); scroll wheel to zoom. On Earth, search for any place from the search bar.
* **Target Selection:** Pick a site from the sites panel on the left, double/right-click anywhere on the globe to auto-fill coordinates, or use **Add a site by coordinates** to enter latitude and longitude manually (`+N`/`+E`, `-S`/`-W`). Your own sites appear in **Your sites**, and the **Filter sites** box narrows either list.
* **Analysis:** Run **Mars match**, **Moon match** or **Find Earth analog** on any site. The results panel on the right lists the top five candidates as tabs (`#1`–`#5`) with the match score, error radius, and a similarity breakdown by category. Select a category row for its sub-scores, then use **Compare all 22 parameters**, **Export CSV** or **Mission brief**.
* **Weights:** Open **Mission weights** in the sites panel to adjust the C1–C5 sliders or pick a preset. Weights rebalance automatically to total 100%.
* **Keyboard:** `1` / `2` / `3` switch worlds, `Esc` closes any open dialog, and category rows respond to `Enter` and `Space`.

#### Weight Presets

All presets are starting points. Adjust the sliders afterwards to fit your own mission constraints.

| Preset | C1 Mineralogy | C2 Topography | C3 Thermal | C4 Subsurface | C5 Eolian | Best for |
|---|---|---|---|---|---|---|
| Balanced | 20 | 25 | 20 | 20 | 15 | General-purpose matching |
| Rover mobility | 10 | 40 | 15 | 10 | 25 | Traverse and trafficability studies |
| ISRU and ice drilling | 15 | 15 | 20 | 40 | 10 | Resource extraction tests |
| Geologic science | 45 | 20 | 10 | 10 | 15 | Sample return and field geology |
| Astrobiology | 30 | 10 | 20 | 30 | 10 | Habitability studies |
| Landing site safety | 5 | 45 | 15 | 5 | 30 | Entry, descent and landing |
| Thermal and power | 10 | 15 | 45 | 10 | 20 | Solar power and thermal design |
| Aeolian processes | 15 | 25 | 10 | 5 | 45 | Wind-driven surface processes |
| Hardware testing | 10 | 15 | 30 | 10 | 35 | Dust and thermal cycling tests |

The presets set C1–C5 only. Because the mafic index keeps its default weight, the effective Mineralogy share is slightly higher than shown, and everything is renormalized. The presets adjust terrain categories and do not account for gravity, so *Rover mobility* reflects terrain similarity and not locomotion in reduced gravity.

#### API

`POST /api/pinpoint` accepts:

```json
{
  "body": "Moon",
  "lat": 0.67,
  "lon": 23.47,
  "weights": { "C1": 0.2, "C2": 0.25, "C3": 0.2, "C4": 0.2, "C5": 0.15 },
  "destinationBody": "Mars"
}
```

`weights` is optional and may include `C1`, `C1_MAFIC`, `C2`, `C3`, `C4` and `C5`. `destinationBody` applies only when the target body is Earth. The response contains up to five `candidates` sorted by `S_refined` (0–1), each with `lat`, `lon`, `pinpoint_error_km`, the category scores `C1` (combined mineralogy), `C1_RAW`, `C1_MAFIC`, `C2`–`C5`, per-parameter `sub_scores`, and the raw parameter values at the target (`target_raw`) and the pinpoint (`earth_raw`).

#### Deploying as a Shared Web Service

The default setup is built for a single-user desktop app. Before hosting it for many users:
- **Remove the desktop lifecycle endpoints.** `/api/heartbeat` and `/api/shutdown` stop the server when a browser tab closes, which would take down a shared instance.
- **Restrict your Cesium ion token** to your own domain in the Cesium ion dashboard, since it is delivered to the browser.
- **Proxy geocoding through your own backend.** The public OpenStreetMap Nominatim service has a strict usage policy and is not suitable for heavy traffic.
- **Tighten CORS.** The backend currently allows all origins.
- **Self-host the fonts** (Public Sans and Source Serif 4) instead of loading them from Google Fonts.

---

### **8. Citation**
If you use **Celestial Parallels** in your research, please cite:
[[Celestial Parallels: Mapping Lunar and Martian Sites to Terrestrial Analogs](https://doi.org/10.5281/zenodo.24465634)]