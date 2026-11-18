# Celestial Parallels (v1.1.5)

**Planetary Analog Site Selection Model & Interactive 3D Digital Twin Explorer**  
**Publication & Methodology:** [[Celestial Parallels: Mapping Lunar and Martian Sites to Terrestrial Analogs](https://doi.org/10.5281/zenodo.24301430)]

---

### **1. Project Functionality & Architecture**

The project pairs a high-precision Planetary Analog Site Selection Model with an interactive 3D web visualization engine to map locations on the Moon and Mars to geologically and environmentally similar dry-land counterparts on Earth. 

The architecture features a Two-Stage Funnel powered by an asynchronous API backend and a 3D digital twin:
- **Phase 1: Data Ingestion & Harmonization:** Processes 0.5-degree spatial resolution planetary grids across mineralogy/geology (C1 — default 20%), terrain/topography (C2 — default 25%), thermal/illumination properties (C3 — default 20%), water/ice resources (C4 — default 20%), and atmospheric/dust dynamics (C5 — default 15%).
- **Phase 2: Land Masking & Standardization:** Restricts Earth data to dry land (`u_elevation >= 0.5119`) and applies Z-score standardizations to neutralize atmospheric and thermal skews across bodies.
- **Phase 3: Stage 1 Regional Filter (Macro Search):** Interpolates target coordinates using 2D Spherical Bilinear Interpolation and evaluates macro similarity via Ledoit-Wolf Shrinkage Mahalanobis Distance combined with Gaussian Radial Basis Function (RBF) kernels and dynamic user-tuned category weights.
- **Phase 4: Stage 2 Pinpoint Snapper (Micro Refinement):** Performs 0.01-degree local mesh refinement (~1 km spacing) using a Universal Surface Filter (`water_mask == 0` and `ndvi < 0.25`) to target exposed rock, desert varnish, or glacial ice.
- **Phase 5: Uncertainty Modeling & Multi-Parameter Scoring:** Computes error radii (`<= 10 km`) while evaluating individual similarity percentages across all 22 underlying sub-parameters.
- **Phase 6: 3D Visualization, Tuning & Reporting:** Integrates a FastAPI backend with a CesiumJS 3D Web Explorer to render multi-ellipsoid bodies, error overlays, reverse-geocoded English terrestrial region names, interactive C1–C5 weight sliders, side-by-side physical comparisons, and GIS CSV/PDF Mission Brief exports.

---

### **2. Key Benefits**

- **Elimination of False Matches:** Prevents mismatched pairings like Martian impact craters to Earth's oceanic trenches.
- **Sub-10 Kilometer Precision:** Combines bilinear sub-grid interpolation with high-resolution local mesh snapping.
- **Granular 22-Parameter Transparency:** Offers detailed breakdowns across Mineralogy (C1), Topography (C2), Thermal Properties (C3), Subsurface Resources (C4), and Eolian Dynamics (C5).
- **Mission-Specific Weight Tuning:** Empowers researchers to dynamically adjust category importance or select preset profiles (*Rover Mobility*, *ISRU / Ice Drilling*) to match precise operational constraints.
- **Side-by-Side Physical Verification:** Allows instant inspection of actual target vs. Earth measurements (e.g., basalt percentages, iron oxide, elevation, mean temperatures) to build scientific trust.
- **High Computational Efficiency:** Leverages vectorized NumPy operations and precomputed shrunk inverse covariance matrices to maintain sub-3-second query times.

---

### **3. Intended Impact**

- **Mission Planning & Rover Traverses:** Identifies terrestrial analogs mirroring mechanical, thermal, and mineralogical conditions of targets like Gale/Jezero Crater or Shackleton Crater.
- **Astronaut & Analog Training:** Provides precise geographic analogs for testing spacesuits, habitats, and In-Situ Resource Utilization (ISRU) tech.
- **Educational Engagement:** Enables students and enthusiasts to explore planetary topography and execute geospatial queries via an open-access 3D interface.

---

### **4. Technology Stack**

- **Languages:** Python (Backend calculation engine), JavaScript ES6+ (Front-end logic), HTML5 / CSS3.
- **Data Science & Math:** Pandas, NumPy, SciPy (KDTree spatial indexing and linear algebra).
- **Backend:** FastAPI (REST API routing), Uvicorn (ASGI server).
- **Geospatial & 3D:** CesiumJS v1.115 (3D globe engine), Cesium Ion 3D Tilesets, OpenStreetMap Nominatim (English-localized reverse geocoding).
- **Packaging & Environment:** PyInstaller, GitHub Actions CI/CD, Code OSS on Arch Linux, and VS Code on Windows 11.

---

### **5. Creative Design Elements**

- **Macro-to-Micro Integration:** Models multi-variable suitability as a continuous statistical manifold stabilized via Ledoit-Wolf shrinkage.
- **Dynamic Ecological Proxy Filtering:** Translates abstract data indices into physical surface constraints to isolate barren extraterrestrial environments.
- **Seamless Multi-Ellipsoid Rendering:** Connects a Python math backend with a real-time CesiumJS digital twin for fluid camera transitions across bodies.

---

### **6. Key Considerations & Challenges Addressed**

- **Latitudinal Grid Convergence:** Applies latitudinal cosine weights (`cos(lat)`) to account for meridian convergence near the poles.
- **Climatic & Atmospheric Skews:** Bridges extreme pressure and temperature gaps using strict intra-body Z-score normalization.
- **Geodesic Stability:** Implements a dual-component uncertainty model penalizing candidates in high-gradient transition zones.
- **Asynchronous Latency Management:** Utilizes lightweight JSON payloads and asynchronous fetch requests to preserve UI responsiveness during heavy sub-grid calculations.

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
   git clone [https://github.com/DigitalGenius1312/Celestial_Parallels](https://github.com/DigitalGenius1312/Celestial_Parallels)
   cd Celestial_Parallels
   pip install -r requirements.txt
   ```
2. Verify dataset CSVs (`Master_Suitability_S.csv`, `C1.csv`–`C5.csv`) sit alongside `script.py` and run:
   ```bash
   python desktop_app.py
   ```

#### Explorer Controls
* **Navigation:** Switch worlds via the top menu; left-click to rotate/pan; use middle mouse drag for Z-axis tilt (Earth); scroll wheel to zoom.
* **Target Selection:** Pick built-in landmarks, double/right-click anywhere on Mars/Moon to auto-fill coordinates, or input manual lat/lon (`+N`/`+E`, `-S`/`-W`).
* **Analysis:** Adjust C1–C5 weights via the **⚙️ Weights** gear, find terrestrial analogs, inspect raw parameter comparisons, and export CSV/PDF Mission Briefs.

---

### **8. Citation**
If you use **Celestial Parallels** in your research, please cite:
[[Celestial Parallels: Mapping Lunar and Martian Sites to Terrestrial Analogs](https://doi.org/10.5281/zenodo.24301430)]