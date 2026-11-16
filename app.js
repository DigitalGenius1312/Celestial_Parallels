// PASTE YOUR CESIUM ION ACCESS TOKEN HERE
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IkxzcGZEeFJVZ2tOaHpjNDAiLCJqdGkiOiI0YzZmZDQxMi02YzE1LTQ1YTAtOTU3YS1hYjc4ODBjODI5YjAiLCJpZCI6NTQ5MDU2LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3OTQ2MzQyNjd9.LKcOcauPPM8fBzzh4wufXX-9wzQG5JseBHKFiFdrvjw';

let viewer = null;
let currentBody = 'earth';
let lastMatch = null;

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

// Handle Form Submission to create custom location blocks
function handleParamSubmit(event) {
    event.preventDefault();
    const name = document.getElementById('locNameInput').value;
    const lat = parseFloat(document.getElementById('locLatInput').value);
    const lon = parseFloat(document.getElementById('locLonInput').value);

    if (!name || isNaN(lat) || isNaN(lon)) return;

    const listContainer = document.getElementById('savedLocationsList');
    
    // Create location block container
    const block = document.createElement('div');
    block.className = 'location-block';

    const headerDiv = document.createElement('div');
    headerDiv.className = 'location-header';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'location-info';
    infoDiv.onclick = () => flyToLocation(lon, lat, 50000);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'location-name';
    nameSpan.innerText = name;

    const coordsSpan = document.createElement('span');
    coordsSpan.className = 'location-coords';
    coordsSpan.innerText = `lat: ${lat}, lon: ${lon}`;

    infoDiv.appendChild(nameSpan);
    infoDiv.appendChild(coordsSpan);

    // Drop a gold pin on the 3D globe for this custom location
    const pinEntity = addGlobePin(name, lat, lon, true);

    // Cross icon button to remove both the block and the globe pin
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-block-btn';
    removeBtn.innerHTML = '&times;';
    removeBtn.onclick = () => {
        block.remove();
        if (viewer && pinEntity) viewer.entities.remove(pinEntity);
    };

    headerDiv.appendChild(infoDiv);
    headerDiv.appendChild(removeBtn);
    block.appendChild(headerDiv);

    // "Find suitable earth locations" button added below coordinates
    const findEarthBtn = document.createElement('button');
    findEarthBtn.className = 'find-earth-btn';
    findEarthBtn.innerText = 'Find suitable earth locations';
    findEarthBtn.onclick = () => processEarthLocation(name, lat, lon);

    block.appendChild(findEarthBtn);
    listContainer.appendChild(block);
    
    // Reset input form
    document.getElementById('planetaryForm').reset();
}

// Fetch human-readable Earth place name from coordinates
async function fetchEarthPlaceName(lat, lon) {
    try {
        const res = await fetch(
            `https://openstreetmap.org{lat}&lon=${lon}&zoom=8`,
            { headers: { 'Accept-Language': 'en' } }
        );
        if (!res.ok) return "Remote Terrestrial Region";
        const geo = await res.json();
        if (geo.address) {
            const region = geo.address.city || geo.address.town || geo.address.county || geo.address.state || geo.address.region || "";
            const country = geo.address.country || "";
            const formatted = [region, country].filter(Boolean).join(", ");
            return formatted || geo.display_name || "Uninhabited Landmass";
        }
        return geo.display_name || "Uninhabited Landmass";
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
        lastMatch = {
            lat: derivedLat,
            lon: derivedLon,
            radiusMeters: radiusMeters,
            cameraHeight: cameraHeight
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
        document.getElementById('resultPlaceName').innerText = "Identifying location...";
        document.getElementById('analogResultPanel').classList.remove('hidden');
        
        const placeName = await fetchEarthPlaceName(derivedLat, derivedLon);
        document.getElementById('resultPlaceName').innerText = placeName;


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

function addGlobePin(name, lat, lon, isCustom = false) {
    if (!viewer) return null;
    return viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 1500),
        point: {
            pixelSize: isCustom ? 11 : 9,
            color: isCustom ? Cesium.Color.GOLD : Cesium.Color.CYAN,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
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
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
    });
}

function renderPresetLocations(bodyType) {
    const presetContainer = document.getElementById('presetLocationsList');
    if (!presetContainer) return;
    presetContainer.innerHTML = '';

    const sites = defaultLocations[bodyType] || [];
    sites.forEach(site => {
        // 1. Drop pin on the 3D globe
        addGlobePin(site.name, site.lat, site.lon, false);

        // 2. Create sidebar card
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
            Cesium.Ellipsoid.default = bodyType === 'mars' ? Cesium.Ellipsoid.MARS : Cesium.Ellipsoid.MOON;
            
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
