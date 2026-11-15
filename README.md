### **1\. Project Functionality & Architecture**

The project is a high-precision Planetary Analog Site Selection Model paired with an interactive 3D web visualization engine. Its core purpose is to map specific locations on the Moon and Mars to their most geologically, topographically, and environmentally similar dry-land counterparts on Earth using open-source grid data.

The system uses a **Two-Stage Funnel Architecture**, powered by an asynchronous API backend and a 3D digital twin front end:

*   **Phase 1: Data Ingestion & Harmonization:** Gathers 0.5-degree spatial resolution planetary grids across five categories: mineralogy/geology (C1), terrain/topography (C2), thermal/illumination properties (C3), water/ice resources (C4), and atmospheric/dust dynamics (C5).
    
*   **Phase 2: Land Masking & Standardization:** Restricts Earth data strictly to dry land (retaining the top 29.2% continental fraction where elevation u\_elevation >= 0.5119) to remove oceans and deep marine trenches. It applies independent Z-score standardizations for each body to neutralize climatic skews between Earth’s warm atmosphere and vacuum/thin-atmosphere worlds.
    
*   **Phase 3: Stage 1 Regional Filter (Macro Search):** Reconstructs feature vectors at target coordinates on the Moon or Mars using 2D Spherical Bilinear Interpolation. It evaluates similarity across Earth’s landmasses using Ledoit-Wolf Shrinkage Mahalanobis Distance combined with Gaussian Radial Basis Function (RBF) kernels to handle inter-variable covariance (such as slope versus surface roughness).
    
*   **Phase 4: Stage 2 Pinpoint Snapper (Micro Refinement):** Isolates the winning regional cell and runs a high-resolution 0.01-degree local mesh refinement (~1 km spacing). It applies a Universal Surface Filter (water\_mask == 0 and ndvi < 0.25) to reject aquatic basins, dense vegetation, and cities, locking onto exposed rock, desert varnish, or glacial ice.
    
*   **Phase 5: Uncertainty Modeling:** Computes a reliable error radius (<= 10 km) by combining grid quantization limits, component imbalances, score residuals, spatial shifts, and local plateau spreads.
    
*   **Phase 6: 3D Visualization:** Interfaces the calculation engine with a FastAPI REST backend and a CesiumJS 3D Web Explorer, letting users navigate multi-ellipsoid planetary bodies (WGS84 Earth, custom Mars, and Moon) and view error boundary overlays.
    

### **2\. Key Benefits**

*   **Elimination of False Matches:** Prevents absurd geological pairings, such as matching Martian impact craters to Earth's oceanic trenches.
    
*   **Sub-10 Kilometer Precision:** Overcomes coarse grid limits via bilinear sub-grid interpolation and high-resolution local mesh snapping.
    
*   **High Computational Efficiency:** Uses vectorized NumPy matrix operations and precomputed shrunk inverse covariance matrices to cut query times from over 60 seconds down to under 3 seconds.
    
*   **Cross-Planetary Interoperability:** Seamlessly handles coordinate conversions (e.g., 0 to 360 degrees vs. -180 to 180 degrees) and multi-ellipsoid rendering in a single environment.
    

### **3\. Intended Impact**

*   **Mission Planning & Rover Traverses:** Speeds up site selection for robotic exploration by finding Earth locations that mirror the mechanical, thermal, and mineralogical conditions of Martian targets (like Gale or Jezero Crater) or lunar poles (like Shackleton Crater).
    
*   **Astronaut & Analog Training:** Equips field researchers with precise Earth-based geographic analogs to test spacesuits, habitats, and resource utilization (ISRU) technologies.
    
*   **Educational Engagement:** Empowers students and space enthusiasts to interactively explore planetary topography and perform advanced geospatial queries through an open-access 3D interface.
    

### **4\. Technology Stack**

*   **Languages:** Python (Backend calculation engine), JavaScript ES6+ (Front-end logic), HTML5 / CSS3.
    
*   **Data Science & Math:** Pandas and NumPy (vectorized processing), SciPy (KDTree spatial indexing and linear algebra).
    
*   **Backend:** FastAPI (REST API routing), Uvicorn (ASGI server).
    
*   **Geospatial & 3D:** CesiumJS v1.115 (3D globe engine), Cesium Ion 3D Tilesets (dynamic datums for Earth, Mars, and Moon).
    
*   **Environment:** Code OSS on Arch Linux and VS Code on Windows 11, GitHub version control, and Python virtual environments.
    

### **5\. Creative Design Elements**

*   **Macro-to-Micro Integration:** Treats multi-variable suitability as a continuous statistical manifold, using Ledoit-Wolf shrinkage to stabilize high-dimensional covariance rather than relying on simple nearest-neighbor lookups.
    
*   **Dynamic Ecological Proxy Filtering:** Automatically translates abstract data indices into physical surface constraints, filtering out liquid water and heavy vegetation to match barren extraterrestrial environments.
    
*   **Seamless Multi-Ellipsoid Rendering:** Bridges a heavy mathematical Python backend with a real-time 3D CesiumJS digital twin for smooth camera transitions across planetary bodies.
    

### **6\. Key Considerations & Challenges Addressed**

*   **Latitudinal Grid Convergence:** Factored in the convergence of meridians toward the poles by applying latitudinal cosine weights (cos(lat)) during Earth grid calculations.
    
*   **Climatic & Atmospheric Skews:** Bridged massive temperature and pressure gaps between Earth, Mars, and the Moon using strict intra-body Z-score normalization.
    
*   **Geodesic Stability:** Built a dual-component uncertainty model that penalizes candidates located in high-gradient terrain transition zones (such as steep coastal cliffs) where local variance exceeds stability thresholds.
    
*   **Asynchronous Latency Management:** Optimized front-end and backend communication using lightweight JSON payloads and asynchronous fetch requests to keep the user interface fully responsive during heavy sub-grid calculations.
    

### **7\. How to Download & Use**

User can run the Planetary Analog Explorer either as a pre-built standalone desktop application or run it from source.

### Option A: Download the Pre-Built Desktop App (Recommended)

No Python installation or terminal setup required:

1.  Download the packaged application archive for your operating system:
    

**Windows:** Celestial-Parallels-windows-latest.zip

**macOS:** Celestial-Parallels-macos-latest.zip

**Linux:** Celestial-Parallels-ubuntu-latest.zip

1.  Extract the downloaded zip file into a local folder.
    
2.  Double-click the launcher executable (Celestial-Parallels or Celestial-Parallels.exe) to start the local backend server and automatically launch the 3D interface in your default browser.
    

### Option B: Run from Source (For Developers)

If user prefers running the raw Python scripts locally:

**Clone the repository:**

git clone https://github.com/DigitalGenius1312/Celestial_Parallels

**Install dependencies:**

pip install -r requirements.txt

**Verify dataset files:** 

Ensure your CSV dataset files (Master\_Suitability\_S.csv, C1.csv, C2.csv, C3.csv, C4.csv, C5.csv) are located in the root project folder alongside script.py.

**Launch the application:**

python desktop\_app.py
