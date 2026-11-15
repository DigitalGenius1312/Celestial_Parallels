# Celestial Parallels: Planetary Analog Site Selection Model & 3D Web Explorer

Celestial Parallels is a high-precision spatial matching system paired with an interactive 3D web visualization digital twin. Its core purpose is to map specific coordinates on the Moon and Mars to their most geologically, topographically, and environmentally similar dry-land counterparts on Earth using harmonized open-source grid datasets.

## 1. Project Objectives & Vision

* **Mission Planning & Rover Traverses:** Accelerates site selection for robotic exploration by identifying Earth environments that mirror the mechanical, thermal, and mineralogical profiles of extraterrestrial targets such as Gale Crater or Jezero Crater on Mars, or Shackleton Crater at the lunar poles.

* **Astronaut & Analog Training:** Equips field researchers with accurate terrestrial analog sites to test spacesuits, surface habitats, and In-Situ Resource Utilization (ISRU) technologies.

* **Educational Engagement:** Empowers students and space enthusiasts to interactively explore planetary topography and perform advanced geospatial queries through an accessible, high-performance 3D web interface.

## 2. Comprehensive File Directory & Architecture

The application is structured around a decoupled modular architecture separating the frontend client interface, the calculation backend, harmonized CSV datasets, and visual branding assets.

### Programming Files

* **`index.html`:** The primary markup document structuring the application layout. It establishes the top navigation bar (Home, How to Use, About), section overlays, the planetary switcher menu (Earth, Mars, Moon), the right-sidebar custom location input form (exclusive to Mars and the Moon), saved location interactive UI blocks, and the cinematic loading overlay.

* **`style.css`:** Manages the dark-themed aesthetic, responsive layouts, glassmorphism UI cards, and animation keyframes. It defines the styling for the large rounded logo and smooth fly-in loading transitions.

* **`app.js`:** Manages client-side state, user interactions, and the CesiumJS 3D rendering pipeline. It initializes Earth with Google Photorealistic 3D Tiles and Mars/Moon with custom ellipsoid datums and 3D terrain tilesets. It also manages asynchronous HTTP requests to the FastAPI backend, dynamic progress loading text sequences, camera flight paths, and error radius boundary circle overlays.

* **`script.py`:** A FastAPI asynchronous backend server that loads and processes all planetary grid datasets in memory. It exposes a `POST /api/pinpoint` endpoint which receives user-submitted coordinates from Mars or the Moon, executes the Two-Stage Funnel pipeline, and returns optimized Earth equivalent coordinates and a precise error radius in kilometers.

* **`best.py`:** An auxiliary Python module used for batch evaluation, regression testing, and validation of analog match accuracy across reference benchmark sites on Mars and the Moon.

### Data Architecture (CSV Datasets & Official Sources)

The backend calculation engine processes data ingested from six harmonized CSV datasets normalized to a $0.5^\circ$ spatial resolution, compiled from premier international space agencies and research repositories:

1. **`Master_Suitability_S.csv`:** The core master table containing body identifiers (`body`), geographic coordinates (`lat`, `lon`), and baseline suitability records.

2. **`C1.csv` (Mineralogy & Geology):** Surface composition metrics across eight mineral classes, including silicates, basalt, iron oxides, plagioclase, igneous, sedimentary, metamorphic, and regolith.

3. **`C2.csv` (Terrain & Topography):** Elevation ($u\_elevation$), surface slope ($u\_slope$), terrain roughness ($u\_roughness$), and impact crater density ($u\_crater$).

4. **`C3.csv` (Thermal & Illumination):** Thermal properties including mean surface temperature ($z\_Tmean$), temperature range ($z\_Trange$), and solar illumination duration ($z\_illum$).

5. **`C4.csv` (Water & Ice Resources):** Subsurface and surface water indicators such as surface ice ($u\_ice$), ice depth ($u\_depth$), permafrost distribution ($u\_hydration$), and soil moisture.

6. **`C5.csv` (Atmospheric & Dust Dynamics):** Aeolian and environmental factors including dust accumulation ($u\_dust$), wind shear ($u\_wind$), and erosion rates ($u\_erosion$).

#### Underlying Data Sources:

* **NASA Data:** MERRA-2 (NASA Global Modeling and Assimilation Office); MSL / Mars 2020 Analyst's Notebooks; PDS Geosciences Node (Lunar & Mars Data); PDS Atmospheres Node (Mars Climate, REMS, MEDA); NASA GRACE Groundwater Data.

* **Space Agency Partner & International Data:** Mars Climate Database (MCD); OpenTopography; Robbins Lunar Crater Database; Astromat (Astrolabe / Lunar Sample Data); NSIDC (National Snow & Ice Data Center); ERA5 (Copernicus Climate Data Store); NOAA NCEI (National Centers for Environmental Information); GEBCO; USGS MOLA DEM; USGS LOLA GSM; ETOPO.

### Visual Assets & Branding

* **`logo.png`:** The official project emblem. It is featured prominently in the top navigation bar and styled as a large, prominent visual anchor inside the cinematic loading screen.

* **Logo Styling:** Configured with smooth rounded edges (`border-radius: 28px`), a depth shadow (`box-shadow: 0 12px 35px rgba(0, 0, 0, 0.6)`), and a smooth fly-in animation (`logoFlyIn`) during application initialization and world switching.

## 3. Step-by-Step Technical Workflow

1. **Data Harmonization & Masking:** Earth data is restricted strictly to subaerial continental land by retaining the top $29.2\%$ continental fraction ($u\_elevation \ge 0.5119$), eliminating oceans and deep marine trenches. Intra-body Z-score standardization neutralizes climatic skews between Earth and thin-atmosphere bodies.

2. **Stage 1 Regional Macro Search:** Reconstructs feature vectors at target extraterrestrial coordinates using 2D Spherical Bilinear Interpolation. Evaluates similarity across Earth's landmasses using Ledoit-Wolf Shrinkage Mahalanobis Distance combined with Gaussian Radial Basis Function (RBF) kernels.

3. **Stage 2 Micro Pinpoint Snapper:** Isolates the winning regional cell and runs a high-resolution $0.01^\circ$ local mesh refinement (\~$1\text{ km}$ spacing). Applies a Universal Surface Filter ($water\_mask == 0$ and $ndvi < 0.25$) to reject aquatic basins and dense vegetation.

4. **Uncertainty Modeling:** Computes a reliable error radius ($\le 10\text{ km}$) by aggregating grid quantization limits, spatial shifts, and local plateau spreads.

5. **3D Visualization & Dynamic Zooming:** The frontend communicates with FastAPI via asynchronous POST requests, switches viewports, flies the camera to the destination, and scales camera altitude dynamically ($\max(radiusMeters \times 10, 15000)$) to properly frame the calculated error radius circle.