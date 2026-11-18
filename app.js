// PASTE YOUR CESIUM ION ACCESS TOKEN HERE
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IkxzcGZEeFJVZ2tOaHpjNDAiLCJqdGkiOiI0YzZmZDQxMi02YzE1LTQ1YTAtOTU3YS1hYjc4ODBjODI5YjAiLCJpZCI6NTQ5MDU2LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3OTQ2MzQyNjd9.LKcOcauPPM8fBzzh4wufXX-9wzQG5JseBHKFiFdrvjw';

let viewer = null;
let currentBody = 'earth';
let lastMatch = null;

let customLocations = {
    mars: [],
    moon: []
};

let globeClickHandler = null;

// Explicit custom ellipsoids compatible with CesiumJS v1.115
const marsEllipsoid = new Cesium.Ellipsoid(3389500.0, 3389500.0, 3389500.0);
const moonEllipsoid = new Cesium.Ellipsoid(1737400.0, 1737400.0, 1737400.0);

async function recenterOnLastMatch() {
    if (!lastMatch) return;
    if (currentBody !== 'earth') {
        await switchBody('earth', document.querySelector('.planet-btn'));
    }
    flyToLocation(lastMatch.lon, lastMatch.lat, lastMatch.cameraHeight);
}


// --- NAVIGATION & UI LOGIC ---
function showSection(sectionName, navBtn) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    if (navBtn) navBtn.classList.add('active');

    document.getElementById('howtoSection').classList.add('hidden');
    document.getElementById('aboutSection').classList.add('hidden');

    if (sectionName === 'howto') document.getElementById('howtoSection').classList.remove('hidden');
    if (sectionName === 'about') document.getElementById('aboutSection').classList.remove('hidden');
}

function toggleParamsDrawer() {
    const form = document.getElementById('planetaryForm');
    const btn = document.getElementById('toggleParamsBtn');
    form.classList.toggle('collapsed');
    btn.innerText = form.classList.contains('collapsed') ? "Expand Form" : "Collapse Form";
}

// Handle Form Submission to create custom location blocks independently per body
function handleParamSubmit(event) {
    event.preventDefault();
    if (currentBody === 'earth') return;

    const name = document.getElementById('locNameInput').value;
    const lat = parseFloat(document.getElementById('locLatInput').value);
    const lon = parseFloat(document.getElementById('locLonInput').value);

    if (!name || isNaN(lat) || isNaN(lon)) return;

    // Save to active body array
    const newLoc = { name, lat, lon };
    customLocations[currentBody].push(newLoc);

    renderSavedLocations(currentBody);
    
    // Reset input form (Fixed closing parenthesis)
    document.getElementById('planetaryForm').reset();
}

function renderSavedLocations(bodyType) {
    const listContainer = document.getElementById('savedLocationsList');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const sites = customLocations[bodyType] || [];
    sites.forEach((site, index) => {
        // Drop gold pin on globe
        const pinEntity = addGlobePin(site.name, site.lat, site.lon, true);

        const block = document.createElement('div');
        block.className = 'location-block';

        const headerDiv = document.createElement('div');
        headerDiv.className = 'location-header';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'location-info';
        infoDiv.onclick = () => flyToLocation(site.lon, site.lat, 50000);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'location-name';
        nameSpan.innerText = site.name;

        const coordsSpan = document.createElement('span');
        coordsSpan.className = 'location-coords';
        coordsSpan.innerText = `lat: ${site.lat}, lon: ${site.lon}`;

        infoDiv.appendChild(nameSpan);
        infoDiv.appendChild(coordsSpan);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-block-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.onclick = () => {
            customLocations[bodyType].splice(index, 1);
            renderSavedLocations(bodyType);
            if (viewer && pinEntity) viewer.entities.remove(pinEntity);
            // Re-render presets & custom locations cleanly
            switchBody(currentBody, document.querySelector('.planet-btn.active'));
        };

        headerDiv.appendChild(infoDiv);
        headerDiv.appendChild(removeBtn);
        block.appendChild(headerDiv);

        const findEarthBtn = document.createElement('button');
        findEarthBtn.className = 'find-earth-btn';
        findEarthBtn.innerText = 'Find suitable earth locations';
        findEarthBtn.onclick = () => processEarthLocation(site.name, site.lat, site.lon);

        block.appendChild(findEarthBtn);
        listContainer.appendChild(block);
    });
}

// Fetch human-readable Earth place name from coordinates
async function fetchEarthPlaceName(lat, lon) {
    try {
        const res = await fetch(`/api/placename?lat=${lat}&lon=${lon}`);
        if (!res.ok) return "Remote Terrestrial Region";
        const data = await res.json();
        return data.place || "Remote Terrestrial Region";
    } catch (e) {
        return "Remote Terrestrial Region";
    }
}


// Two-Step Pinpoint & Error Module Integration with Dynamic Progress Loading Screen
async function processEarthLocation(name, lat, lon) {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    overlay.classList.remove('hidden');

    const sourceBodyName = currentBody.charAt(0).toUpperCase() + currentBody.slice(1);

    // Dynamic progress messages sequence
    const progressMessages = [
        `Analyzing coordinates for ${name}...`,
        "Finding the best locations...",
        "Querying CSV feature groups & covariance matrices...",
        "Executing two-stage pinpoint pipeline...",
        "Filtering subaerial land and calculating error radius...",
        "Finalizing Earth analog match..."
    ];

    let msgIndex = 0;
    loadingText.innerText = progressMessages[msgIndex];

    const textInterval = setInterval(() => {
        msgIndex = (msgIndex + 1) % progressMessages.length;
        loadingText.innerText = progressMessages[msgIndex];
    }, 750);

    try {
        // 1. Send coordinates via POST to FastAPI server
        const response = await fetch('/api/pinpoint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                body: currentBody, // Passes 'mars' or 'moon' dynamically
                lat: lat,
                lon: lon
            })
        });

        if (!response.ok) throw new Error("Failed to compute planetary analog location.");

        // 2. Retrieve computed results from Python
        const data = await response.json();
        const derivedLat = data.earth_lat;
        const derivedLon = data.earth_lon;
        const errorRadiusKm = data.error_km;

        clearInterval(textInterval);
        loadingText.innerText = "Switching viewport to Earth match...";

        // 3. Switch viewer globe to Earth automatically
        await switchBody('earth', document.querySelector('.planet-btn'));

        // 4. Calculate proper zoom altitude based on error radius (framing the error circle cleanly)
        const radiusMeters = errorRadiusKm * 1000;
        const cameraHeight = Math.max(radiusMeters * 10, 15000);
        
        // Store comprehensive match report object for export & re-centering
        lastMatch = {
            targetName: name,
            targetBody: sourceBodyName,
            targetBodyKey: sourceBodyName.toLowerCase(),
            targetLat: lat,
            targetLon: lon,
            lat: derivedLat,
            lon: derivedLon,
            earthPlaceName: "Identifying location...",
            radiusMeters: radiusMeters,
            cameraHeight: cameraHeight,
            errorKm: errorRadiusKm,
            S_score: data.S_score,
            cat_scores: data.cat_scores || {},
            sub_scores: data.sub_scores || {},
            target_raw: data.target_raw || {},
            earth_raw: data.earth_raw || {},
            timestamp: new Date().toISOString()
        };

        document.getElementById('recenterMatchBtn').onclick = recenterOnLastMatch;
        
        // 5. Fly the Cesium camera to the calculated Earth coordinates and zoom in appropriately
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(derivedLon, derivedLat, cameraHeight),
            duration: 2.5
        });

        // 6. Clear previous error boundary circles
        viewer.entities.values.forEach(entity => {
            if (entity.ellipse) viewer.entities.remove(entity);
        });

        // 7. Draw the precise pinpoint error radius circle on Earth
        viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(derivedLon, derivedLat),
            ellipse: {
                semiMajorAxis: radiusMeters,
                semiMinorAxis: radiusMeters,
                material: Cesium.Color.CYAN.withAlpha(0.35),
                outline: true,
                outlineColor: Cesium.Color.CYAN
            }
        });

        // 8. Populate and display the Earth Analog Match Side Panel
        document.getElementById('resultSourceTarget').innerText = `Analog for ${name} (${sourceBodyName}: ${lat}°, ${lon}°)`;
        document.getElementById('resultLat').innerText = `${derivedLat.toFixed(4)}°`;
        document.getElementById('resultLon').innerText = `${derivedLon.toFixed(4)}°`;
        document.getElementById('resultScore').innerText = data.S_score ? `${(data.S_score * 100).toFixed(1)}%` : "N/A";
        document.getElementById('resultError').innerText = `±${errorRadiusKm} km`;

        // Update C1 - C5 parameter breakdown bars
        if (data.cat_scores) {
            ['C1', 'C2', 'C3', 'C4', 'C5'].forEach(cat => {
                const pct = ((data.cat_scores[cat] || 0) * 100).toFixed(1);
                document.getElementById(`score${cat}`).innerText = `${pct}%`;
                document.getElementById(`bar${cat}`).style.width = `${pct}%`;
            });
        }

        // Populate all 22 sub-parameter match percentages
        if (data.sub_scores) {
            document.querySelectorAll('[data-feat]').forEach(el => {
                const key = el.getAttribute('data-feat');
                const val = data.sub_scores[key];
                el.innerText = val !== undefined ? `${(val * 100).toFixed(0)}%` : '--';
            });
        }
      
        document.getElementById('resultPlaceName').innerText = "Identifying location...";
        document.getElementById('analogResultPanel').classList.remove('hidden');
        
        const placeName = await fetchEarthPlaceName(derivedLat, derivedLon);
        document.getElementById('resultPlaceName').innerText = placeName;
        if (lastMatch) lastMatch.earthPlaceName = placeName;

    } catch (error) {
        console.error("Error communicating with Python API:", error);
        alert("Could not reach the Python calculation engine. Make sure server.py is running!");
    } finally {
        clearInterval(textInterval);
        overlay.classList.add('hidden');
    }
}

// --- PLANETARY DATA ---
const bodyData = {
    earth: {
        title: "Earth",
        desc: "Our home planet and the only known world with stable liquid water on its surface.",
        radius: "6,371 km",
        gravity: "9.8 m/s²",
        day: "24 hrs"
    },
    mars: {
        title: "Mars",
        desc: "The Red Planet, home to the largest volcanoes and deepest canyons in the solar system.",
        radius: "3,389 km",
        gravity: "3.7 m/s²",
        day: "24h 37m",
        assetId: 3644333
    },
    moon: {
        title: "The Moon",
        desc: "Earth's sole natural satellite, scarred by billions of years of asteroid impacts.",
        radius: "1,737 km",
        gravity: "1.6 m/s²",
        day: "29.5 days",
        assetId: 2684829
    }
};

// --- DEFAULT PRESET BASES & LANDMARKS ---
const defaultLocations = {
    moon: [
        { name: "Tranquility Base (Apollo 11)", lat: 0.67, lon: 23.47 },
        { name: "Shackleton Crater (Lunar South Pole)", lat: -89.90, lon: 0.00 },
        { name: "Copernicus Crater", lat: 9.62, lon: -20.08 },
        { name: "Clavius Crater", lat: -58.40, lon: -14.40 },
        { name: "Plato Crater", lat: 51.60, lon: -9.30 },
        { name: "Mare Imbrium", lat: 32.80, lon: -15.60 },
        { name: "Mare Serenitatis", lat: 28.00, lon: 17.50 },
        { name: "Von Kármán Crater (Chang'e 4)", lat: -44.45, lon: 176.25 },
        { name: "Tycho Crater", lat: -43.31, lon: -11.36 },
        { name: "Aristarchus / Vallis Schröteri", lat: 23.73, lon: -47.49 }
    ],
    mars: [
        { name: "Gale Crater (Curiosity)", lat: -5.37, lon: 137.81 },
        { name: "Jezero Crater (Perseverance)", lat: 18.38, lon: 77.58 },
        { name: "Hellas Planitia", lat: -42.43, lon: 70.50 },
        { name: "Elysium Mons", lat: 25.02, lon: 147.21 },
        { name: "Arsia Mons (Tharsis)", lat: -8.26, lon: -120.09 },
        { name: "Utopia Planitia (Zhurong)", lat: 46.74, lon: 117.52 },
        { name: "Argyre Planitia", lat: -49.84, lon: -43.31 },
        { name: "Coprates Chasma / Valles Marineris", lat: -21.40, lon: -64.40 },
        { name: "Olympus Mons", lat: 18.65, lon: -133.80 },
        { name: "Bagnold Dunes", lat: -4.77, lon: 137.37 }
    ]
};

// Setup Cesium ScreenSpaceEventHandler for Click-Anywhere coordinate selection
// Setup Cesium ScreenSpaceEventHandler for Click-Anywhere coordinate selection (Double-click & Right-click)
function setupGlobeClickHandler() {
    if (!viewer) return;
    if (globeClickHandler) {
        globeClickHandler.destroy();
        globeClickHandler = null;
    }

    globeClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    const handleGlobePick = (position) => {
        if (currentBody === 'earth') return; // Only active on Mars or Moon

        let ellipsoid = currentBody === 'mars' ? marsEllipsoid : moonEllipsoid;
        
        // Directly pick against the custom ellipsoid (safe when globe: false)
        let cartesian = viewer.scene.camera.pickEllipsoid(position, ellipsoid);

        // Fallback: try picking position from 3D tileset if ellipoid pick misses
        if (!cartesian && viewer.scene.pickPositionSupported) {
            cartesian = viewer.scene.pickPosition(position);
        }

        if (cartesian) {
            let cartographic = ellipsoid.cartesianToCartographic(cartesian);
            let lat = Cesium.Math.toDegrees(cartographic.latitude);
            let lon = Cesium.Math.toDegrees(cartographic.longitude);

            // Auto-fill form inputs
            document.getElementById('locLatInput').value = lat.toFixed(4);
            document.getElementById('locLonInput').value = lon.toFixed(4);

            // Expand parameters drawer if collapsed
            const form = document.getElementById('planetaryForm');
            if (form.classList.contains('collapsed')) {
                toggleParamsDrawer();
            }

            // Prompt user by focusing on the location name input
            const nameInput = document.getElementById('locNameInput');
            nameInput.value = "";
            nameInput.placeholder = `Site at ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
            nameInput.focus();
        }
    };

    // Listen for Left Double-Click
    globeClickHandler.setInputAction((click) => {
        handleGlobePick(click.position);
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // Listen for Right-Click (and prevent default browser context menu on the canvas)
    globeClickHandler.setInputAction((click) => {
        handleGlobePick(click.position);
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    viewer.scene.canvas.addEventListener('contextmenu', (e) => {
        if (currentBody !== 'earth') e.preventDefault();
    });
}

function addGlobePin(name, lat, lon, isCustom = false) {
    if (!viewer) return null;

    // Use our custom compatibility ellipsoids for Mars and Moon
    let ellipsoid = Cesium.Ellipsoid.WGS84;
    if (currentBody === 'mars') ellipsoid = marsEllipsoid;
    if (currentBody === 'moon') ellipsoid = moonEllipsoid;

    const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0, ellipsoid);

    return viewer.entities.add({
        position: position,
        point: {
            pixelSize: isCustom ? 11 : 9,
            color: isCustom ? Cesium.Color.GOLD : Cesium.Color.CYAN,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2
        },
        label: {
            text: name,
            font: '600 12px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -12),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 8000000.0)
        }
    });
}

function renderPresetLocations(bodyType) {
    const presetContainer = document.getElementById('presetLocationsList');
    if (!presetContainer) return;
    presetContainer.innerHTML = '';

    const sites = defaultLocations[bodyType] || [];
    sites.forEach(site => {
        addGlobePin(site.name, site.lat, site.lon, false);

        const block = document.createElement('div');
        block.className = 'location-block';

        const headerDiv = document.createElement('div');
        headerDiv.className = 'location-header';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'location-info';
        infoDiv.onclick = () => flyToLocation(site.lon, site.lat, 120000);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'location-name';
        nameSpan.innerText = site.name;

        const coordsSpan = document.createElement('span');
        coordsSpan.className = 'location-coords';
        coordsSpan.innerText = `lat: ${site.lat}, lon: ${site.lon}`;

        infoDiv.appendChild(nameSpan);
        infoDiv.appendChild(coordsSpan);
        headerDiv.appendChild(infoDiv);
        block.appendChild(headerDiv);

        const findEarthBtn = document.createElement('button');
        findEarthBtn.className = 'find-earth-btn';
        findEarthBtn.innerText = 'Find suitable earth locations';
        findEarthBtn.onclick = () => processEarthLocation(site.name, site.lat, site.lon);

        block.appendChild(findEarthBtn);
        presetContainer.appendChild(block);
    });
}

function updateUI(bodyType) {
    const data = bodyData[bodyType];
    document.getElementById('bodyTitle').innerText = data.title;
    document.getElementById('bodyDesc').innerText = data.desc;
    document.getElementById('bodyRadius').innerText = data.radius;
    document.getElementById('bodyGravity').innerText = data.gravity;
    document.getElementById('bodyDay').innerText = data.day;
}

function flyToLocation(lon, lat, height) {
    if (!viewer) return;
    viewer.trackedEntity = undefined;
    viewer.camera.cancelFlight();
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        orientation: {
            heading: Cesium.Math.toRadians(0.0),
            pitch: Cesium.Math.toRadians(-90.0),
            roll: 0.0
        },
        duration: 1.8
    });
}

async function switchBody(bodyType, buttonElement) {
    currentBody = bodyType;

    const paramsPanel = document.getElementById('parametersPanel');
    const resultPanel = document.getElementById('analogResultPanel');
    if (bodyType === 'mars' || bodyType === 'moon') {
        paramsPanel.classList.remove('hidden');
        resultPanel.classList.add('hidden');
    } else {
        paramsPanel.classList.add('hidden');
        if (lastMatch) {
            resultPanel.classList.remove('hidden');
        }
    }

    document.querySelectorAll('.planet-btn').forEach(btn => btn.classList.remove('active'));
    if (buttonElement) buttonElement.classList.add('active');

    const overlay = document.getElementById('loadingOverlay');
    document.getElementById('loadingText').innerText = `Loading ${bodyData[bodyType].title}...`;
    overlay.classList.remove('hidden');

    updateUI(bodyType);

    if (viewer) {
        viewer.destroy();
        viewer = null;
    }

    try {
        if (bodyType === 'earth') {
            Cesium.Ellipsoid.default = Cesium.Ellipsoid.WGS84;
            viewer = new Cesium.Viewer('cesiumContainer', {
                animation: false,
                timeline: false,
                baseLayerPicker: false,
                geocoder: true,
                homeButton: true,
                sceneModePicker: false,
                navigationHelpButton: false,
                globe: false
            });

            const tileset = await Cesium.createGooglePhotorealistic3DTileset();
            viewer.scene.primitives.add(tileset);
            
        } else {
            // Use custom ellipsoid mapping for the globe viewer itself
            Cesium.Ellipsoid.default = bodyType === 'mars' ? marsEllipsoid : moonEllipsoid;
            
            viewer = new Cesium.Viewer('cesiumContainer', {
                animation: false,
                timeline: false,
                baseLayerPicker: false,
                geocoder: false,
                homeButton: false,
                sceneModePicker: false,
                navigationHelpButton: false,
                globe: false
            });

            const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(bodyData[bodyType].assetId);
            viewer.scene.primitives.add(tileset);
            await viewer.flyTo(tileset);

            renderPresetLocations(bodyType);
            renderSavedLocations(bodyType); // Body-specific saved locations
            setupGlobeClickHandler();      // Click-anywhere coordinate picker handler
        }
    } catch (error) {
        console.error(`Error loading ${bodyType}:`, error);
        alert(`Could not load ${bodyData[bodyType].title}. Verify your Cesium Ion token.`);
    } finally {
        overlay.classList.add('hidden');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    switchBody('earth', document.querySelector('.planet-btn'));
});

// Keep background server alive while tab is open
setInterval(() => {
    fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
}, 2000);

// Shut down background server immediately when browser tab closes
window.addEventListener('beforeunload', () => {
    navigator.sendBeacon('/api/shutdown');
});

// --- PARAMETER CATALOG & EXPORT MISSION BRIEF FUNCTIONS ---
const PARAMETER_CATALOG = [
    { cat: "C1: Mineralogy (20%)", label: "Silicate Fraction", scoreKey: "g1_silicate", rawKey: "g1_silicate", unit: "ratio" },
    { cat: "C1: Mineralogy (20%)", label: "Basalt Fraction", scoreKey: "g2_basalt", rawKey: "g2_basalt", unit: "ratio" },
    { cat: "C1: Mineralogy (20%)", label: "Iron Oxide Content", scoreKey: "g3_iron_oxide", rawKey: "g3_iron_oxide", unit: "ratio" },
    { cat: "C1: Mineralogy (20%)", label: "Plagioclase Feldspar", scoreKey: "g4_plagioclase", rawKey: "g4_plagioclase", unit: "ratio" },
    { cat: "C1: Mineralogy (20%)", label: "Igneous Lithology", scoreKey: "g5_igneous", rawKey: "g5_igneous", unit: "ratio" },
    { cat: "C1: Mineralogy (20%)", label: "Sedimentary Lithology", scoreKey: "g6_sedimentary", rawKey: "g6_sedimentary", unit: "ratio" },
    { cat: "C1: Mineralogy (20%)", label: "Metamorphic Lithology", scoreKey: "g7_metamorphic", rawKey: "g7_metamorphic", unit: "ratio" },
    { cat: "C1: Mineralogy (20%)", label: "Regolith Cover", scoreKey: "g8_regolith", rawKey: "g8_regolith", unit: "ratio" },

    { cat: "C2: Topography (25%)", label: "Elevation", scoreKey: "u_elevation_body_z", rawKey: "u_elevation", unit: "m" },
    { cat: "C2: Topography (25%)", label: "Surface Slope", scoreKey: "u_slope_body_z", rawKey: "u_slope", unit: "deg" },
    { cat: "C2: Topography (25%)", label: "Terrain Roughness", scoreKey: "u_roughness_body_z", rawKey: "u_roughness", unit: "index" },
    { cat: "C2: Topography (25%)", label: "Crater Density", scoreKey: "u_crater", rawKey: "u_crater", unit: "index" },

    { cat: "C3: Thermal Properties (20%)", label: "Mean Surface Temp", scoreKey: "z_Tmean_body_z", rawKey: "z_Tmean", unit: "K" },
    { cat: "C3: Thermal Properties (20%)", label: "Diurnal Temp Range", scoreKey: "z_Trange_body_z", rawKey: "z_Trange", unit: "K" },
    { cat: "C3: Thermal Properties (20%)", label: "Solar Illumination", scoreKey: "z_illum_body_z", rawKey: "z_illum", unit: "index" },

    { cat: "C4: Subsurface Resources (20%)", label: "Water Ice Concentration", scoreKey: "u_ice", rawKey: "u_ice", unit: "ratio" },
    { cat: "C4: Subsurface Resources (20%)", label: "Ice Table Depth", scoreKey: "u_depth", rawKey: "u_depth", unit: "m" },
    { cat: "C4: Subsurface Resources (20%)", label: "Permafrost Index", scoreKey: "u_permafrost", rawKey: "u_permafrost", unit: "index" },
    { cat: "C4: Subsurface Resources (20%)", label: "Surface Hydration", scoreKey: "u_hydration", rawKey: "u_hydration", unit: "index" },

    { cat: "C5: Eolian Dynamics (15%)", label: "Atmospheric Dust Load", scoreKey: "u_dust", rawKey: "u_dust", unit: "index" },
    { cat: "C5: Eolian Dynamics (15%)", label: "Surface Wind Speed", scoreKey: "u_wind", rawKey: "u_wind", unit: "m/s" },
    { cat: "C5: Eolian Dynamics (15%)", label: "Eolian Erosion Rate", scoreKey: "u_erosion", rawKey: "u_erosion", unit: "index" }
];

function sanitizeFilename(str) {
    if (!str) return "site";
    return str.replace(/[^a-z0-9_\-]+/gi, '_').replace(/^_+|_+$/g, '');
}

// 1. Export GIS-ready CSV with all target & Earth analog data
function exportMissionCSV() {
    if (!lastMatch) {
        alert("No match data available yet. Please run an analog search first.");
        return;
    }
    const m = lastMatch;
    const targetBodyInfo = bodyData[m.targetBodyKey] || {};
    const earthBodyInfo = bodyData.earth || {};

    const rows = [
        ["SECTION", "PARAMETER", "CATEGORY", "TARGET_VALUE", "EARTH_ANALOG_VALUE", "SIMILARITY_SCORE_PCT", "UNIT_OR_NOTES"],
        ["METADATA", "Generated Timestamp (UTC)", "Mission Info", m.timestamp, m.timestamp, "", "ISO-8601"],
        ["SITE_OVERVIEW", "Site / Region Name", "Location", m.targetName, m.earthPlaceName, "", ""],
        ["SITE_OVERVIEW", "Planetary Body", "Location", m.targetBody, "Earth", "", ""],
        ["SITE_OVERVIEW", "Latitude", "Coordinates", m.targetLat, m.lat, "", "degrees"],
        ["SITE_OVERVIEW", "Longitude", "Coordinates", m.targetLon, m.lon, "", "degrees"],
        ["SITE_OVERVIEW", "Pinpoint Error Radius", "Uncertainty", "", m.errorKm, "", "km"],
        ["SITE_OVERVIEW", "Overall Composite Suitability (S)", "Suitability", "", m.S_score, (m.S_score * 100).toFixed(2) + "%", "0-1 scale"],
        ["PLANETARY_CONSTANTS", "Mean Planetary Radius", "Body Physics", targetBodyInfo.radius || "", earthBodyInfo.radius || "", "", "km"],
        ["PLANETARY_CONSTANTS", "Surface Gravity", "Body Physics", targetBodyInfo.gravity || "", earthBodyInfo.gravity || "", "", "m/s^2"],
        ["PLANETARY_CONSTANTS", "Sidereal/Solar Day Length", "Body Physics", targetBodyInfo.day || "", earthBodyInfo.day || "", "", ""],
        ["CATEGORY_SCORE", "C1: Mineralogy (Weight 20%)", "Category", "", m.cat_scores.C1 ?? "", m.cat_scores.C1 !== undefined ? (m.cat_scores.C1 * 100).toFixed(2) + "%" : "", "0-1 scale"],
        ["CATEGORY_SCORE", "C2: Topography (Weight 25%)", "Category", "", m.cat_scores.C2 ?? "", m.cat_scores.C2 !== undefined ? (m.cat_scores.C2 * 100).toFixed(2) + "%" : "", "0-1 scale"],
        ["CATEGORY_SCORE", "C3: Thermal Properties (Weight 20%)", "Category", "", m.cat_scores.C3 ?? "", m.cat_scores.C3 !== undefined ? (m.cat_scores.C3 * 100).toFixed(2) + "%" : "", "0-1 scale"],
        ["CATEGORY_SCORE", "C4: Subsurface Resources (Weight 20%)", "Category", "", m.cat_scores.C4 ?? "", m.cat_scores.C4 !== undefined ? (m.cat_scores.C4 * 100).toFixed(2) + "%" : "", "0-1 scale"],
        ["CATEGORY_SCORE", "C5: Eolian Dynamics (Weight 15%)", "Category", "", m.cat_scores.C5 ?? "", m.cat_scores.C5 !== undefined ? (m.cat_scores.C5 * 100).toFixed(2) + "%" : "", "0-1 scale"]
    ];

    PARAMETER_CATALOG.forEach(p => {
        const tVal = m.target_raw[p.rawKey] !== undefined ? m.target_raw[p.rawKey] : "";
        const eVal = m.earth_raw[p.rawKey] !== undefined ? m.earth_raw[p.rawKey] : "";
        const sim = m.sub_scores[p.scoreKey] !== undefined ? (m.sub_scores[p.scoreKey] * 100).toFixed(2) + "%" : "";
        rows.push(["SUB_PARAMETER", p.label, p.cat, tVal, eVal, sim, p.unit]);
    });

    const csvContent = rows.map(r =>
        r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    ).join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Analog_Brief_${m.targetBody}_${sanitizeFilename(m.targetName)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 2. Export Formatted Printable Mission Brief (Opens Print-to-PDF view)
function exportMissionBrief() {
    if (!lastMatch) {
        alert("No match data available yet. Please run an analog search first.");
        return;
    }
    const m = lastMatch;
    const targetBodyInfo = bodyData[m.targetBodyKey] || {};
    const earthBodyInfo = bodyData.earth || {};

    const catDefs = [
        { key: "C1", name: "Mineralogy", weight: "20%" },
        { key: "C2", name: "Topography", weight: "25%" },
        { key: "C3", name: "Thermal Properties", weight: "20%" },
        { key: "C4", name: "Subsurface Resources", weight: "20%" },
        { key: "C5", name: "Eolian Dynamics", weight: "15%" }
    ];

    const catRowsHtml = catDefs.map(c => {
        const val = m.cat_scores[c.key] || 0;
        const pct = (val * 100).toFixed(1);
        return `
            <tr>
                <td><strong>${c.key}: ${c.name}</strong></td>
                <td>${c.weight}</td>
                <td>${val.toFixed(4)}</td>
                <td><strong>${pct}%</strong></td>
            </tr>
        `;
    }).join("");

    const paramRowsHtml = PARAMETER_CATALOG.map(p => {
        const tVal = m.target_raw[p.rawKey] !== undefined ? m.target_raw[p.rawKey] : "N/A";
        const eVal = m.earth_raw[p.rawKey] !== undefined ? m.earth_raw[p.rawKey] : "N/A";
        const sim = m.sub_scores[p.scoreKey] !== undefined ? `${(m.sub_scores[p.scoreKey] * 100).toFixed(1)}%` : "N/A";
        return `
            <tr>
                <td>${p.cat.split(":")[0]}</td>
                <td>${p.label}</td>
                <td>${tVal} <span class="unit">${p.unit}</span></td>
                <td>${eVal} <span class="unit">${p.unit}</span></td>
                <td><strong>${sim}</strong></td>
            </tr>
        `;
    }).join("");

    const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mission Brief — ${m.targetName} (${m.targetBody})</title>
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1e293b; margin: 32px; line-height: 1.45; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 14px; margin-bottom: 20px; }
    .header h1 { margin: 0; font-size: 22px; color: #0f172a; }
    .header .subtitle { font-size: 12px; color: #475569; margin-top: 4px; }
    .badge { background: #0284c7; color: #fff; padding: 6px 12px; border-radius: 6px; font-weight: 700; font-size: 14px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 22px; }
    .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; background: #f8fafc; }
    .card h3 { margin: 0 0 10px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.6px; color: #0284c7; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    .kv { display: flex; justify-content: space-between; font-size: 12.5px; padding: 3px 0; }
    .kv span:first-child { color: #64748b; }
    .kv span:last-child { font-weight: 600; color: #0f172a; }
    h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px; color: #0f172a; margin: 22px 0 8px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left; }
    th { background: #f1f5f9; font-weight: 700; color: #334155; }
    tr:nth-child(even) { background: #f8fafc; }
    .unit { color: #64748b; font-size: 10.5px; }
    .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #cbd5e1; font-size: 11px; color: #64748b; display: flex; justify-content: space-between; }
    @media print { body { margin: 16px; } .no-print { display: none; } }
</style>
</head>
<body>
    <div class="header">
        <div>
            <h1>CELESTIAL PARALLELS — PLANETARY ANALOG MISSION BRIEF</h1>
            <div class="subtitle">Generated: ${new Date(m.timestamp).toUTCString()} &bull; Two-Stage Subaerial Analog Pipeline</div>
        </div>
        <div class="badge">Suitability (S): ${(m.S_score * 100).toFixed(1)}%</div>
    </div>

    <div class="grid-2">
        <div class="card">
            <h3>Extraterrestrial Target Site (${m.targetBody})</h3>
            <div class="kv"><span>Target Site Name:</span><span>${m.targetName}</span></div>
            <div class="kv"><span>Planetary Body:</span><span>${m.targetBody}</span></div>
            <div class="kv"><span>Coordinates:</span><span>${m.targetLat.toFixed(4)}°, ${m.targetLon.toFixed(4)}°</span></div>
            <div class="kv"><span>Mean Radius:</span><span>${targetBodyInfo.radius || "N/A"}</span></div>
            <div class="kv"><span>Surface Gravity:</span><span>${targetBodyInfo.gravity || "N/A"}</span></div>
            <div class="kv"><span>Day Length:</span><span>${targetBodyInfo.day || "N/A"}</span></div>
        </div>
        <div class="card">
            <h3>Matched Terrestrial Analog (Earth)</h3>
            <div class="kv"><span>Terrestrial Region:</span><span>${m.earthPlaceName}</span></div>
            <div class="kv"><span>Coordinates:</span><span>${m.lat.toFixed(4)}°, ${m.lon.toFixed(4)}°</span></div>
            <div class="kv"><span>Pinpoint Error Radius:</span><span>±${m.errorKm} km</span></div>
            <div class="kv"><span>Mean Radius:</span><span>${earthBodyInfo.radius || "6,371 km"}</span></div>
            <div class="kv"><span>Surface Gravity:</span><span>${earthBodyInfo.gravity || "9.8 m/s²"}</span></div>
            <div class="kv"><span>Day Length:</span><span>${earthBodyInfo.day || "24 hrs"}</span></div>
        </div>
    </div>

    <h2>1. Weighted Category Similarity Breakdown (C1–C5)</h2>
    <table>
        <thead>
            <tr>
                <th>Parameter Category</th>
                <th>Assigned Weight</th>
                <th>Raw Index (0–1)</th>
                <th>Category Match %</th>
            </tr>
        </thead>
        <tbody>${catRowsHtml}</tbody>
    </table>

    <h2>2. Full 22-Parameter Physical &amp; Similarity Comparison</h2>
    <table>
        <thead>
            <tr>
                <th>Group</th>
                <th>Environmental / Geological Parameter</th>
                <th>${m.targetBody} Target Value</th>
                <th>Earth Analog Value</th>
                <th>Sub-Parameter Match</th>
            </tr>
        </thead>
        <tbody>${paramRowsHtml}</tbody>
    </table>

    <div class="footer">
        <span>Celestial Parallels Analog Selection Engine (DOI: 10.5281/zenodo.24301430)</span>
        <span>Subaerial Land Mask &amp; Shrunk Mahalanobis Covariance Model</span>
    </div>
    <script>window.onload = () => { window.print(); };<\/script>
</body>
</html>`;

    const printWindow = window.open("", "_blank");
    if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(reportHtml);
        printWindow.document.close();
    } else {
        alert("Please allow pop-ups in your browser to view and print the Mission Brief PDF.");
    }
}