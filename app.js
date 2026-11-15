// PASTE YOUR CESIUM ION ACCESS TOKEN HERE
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IkxzcGZEeFJVZ2tOaHpjNDAiLCJqdGkiOiI0YzZmZDQxMi02YzE1LTQ1YTAtOTU3YS1hYjc4ODBjODI5YjAiLCJpZCI6NTQ5MDU2LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3OTQ2MzQyNjd9.LKcOcauPPM8fBzzh4wufXX-9wzQG5JseBHKFiFdrvjw';

let viewer = null;
let currentBody = 'earth';

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

    // Cross icon button to remove block
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-block-btn';
    removeBtn.innerHTML = '&times;';
    removeBtn.onclick = () => block.remove();

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

// Two-Step Pinpoint & Error Module Integration Logic
async function processEarthLocation(name, lat, lon) {
    console.log(`[Frontend] Sending ${name} on ${currentBody.toUpperCase()} (${lat}, ${lon}) to Python engine...`);

    try {
        // 1. Send the user-submitted coordinates via POST to FastAPI
        const response = await fetch('http://localhost:8000/api/pinpoint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                body: currentBody, // Passes 'mars' or 'moon' dynamically
                lat: lat,
                lon: lon
            })
        });

        if (!response.ok) throw new Error("Failed to compute planetary analog location.");

        // 2. Retrieve real computed results from Python
        const data = await response.json();
        const derivedLat = data.earth_lat;
        const derivedLon = data.earth_lon;
        const errorRadiusKm = data.error_km;

        console.log(`[Python Pipeline Success] Earth Pinpoint: (${derivedLat}, ${derivedLon}) | Error: ±${errorRadiusKm} km`);

        // 3. Switch viewer globe to Earth automatically
        await switchBody('earth', document.querySelector('.planet-btn'));

        // 4. Fly the Cesium camera to the calculated Earth coordinates
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(derivedLon, derivedLat, 600000),
            duration: 2.5
        });

        // 5. Clear previous error boundary circles
        viewer.entities.values.forEach(entity => {
            if (entity.ellipse) viewer.entities.remove(entity);
        });

        // 6. Draw the precise pinpoint error radius circle on Earth
        const radiusMeters = errorRadiusKm * 1000;
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

    } catch (error) {
        console.error("Error communicating with Python API:", error);
        alert("Could not reach the Python calculation engine. Make sure server.py is running!");
    }
}

// --- PLANETARY DATA ---
const bodyData = {
    earth: {
        title: "Earth",
        desc: "Our home planet and the only known world with stable liquid water on its surface.",
        radius: "6,371 km",
        gravity: "9.8 m/s²",
        day: "24 hrs",
        landmarks: [
            { name: "Mount Everest", lon: 86.9250, lat: 27.9881, height: 15000 },
            { name: "Grand Canyon", lon: -112.1129, lat: 36.1069, height: 25000 },
            { name: "Giza Pyramids", lon: 31.1342, lat: 29.9792, height: 3000 }
        ]
    },
    mars: {
        title: "Mars",
        desc: "The Red Planet, home to the largest volcanoes and deepest canyons in the solar system.",
        radius: "3,389 km",
        gravity: "3.7 m/s²",
        day: "24h 37m",
        assetId: 3644333,
        landmarks: [
            { name: "Olympus Mons", lon: -133.8, lat: 18.65, height: 250000 },
            { name: "Valles Marineris", lon: -59.2, lat: -13.9, height: 300000 },
            { name: "Jezero Crater", lon: 77.58, lat: 18.38, height: 50000 }
        ]
    },
    moon: {
        title: "The Moon",
        desc: "Earth's sole natural satellite, scarred by billions of years of asteroid impacts.",
        radius: "1,737 km",
        gravity: "1.6 m/s²",
        day: "29.5 days",
        assetId: 2684829,
        landmarks: [
            { name: "Tycho Crater", lon: -11.36, lat: -43.31, height: 120000 },
            { name: "Apollo 11 Site", lon: 23.47, lat: 0.67, height: 40000 },
            { name: "Copernicus Crater", lon: -20.08, lat: 9.62, height: 150000 }
        ]
    }
};

function updateUI(bodyType) {
    const data = bodyData[bodyType];
    document.getElementById('bodyTitle').innerText = data.title;
    document.getElementById('bodyDesc').innerText = data.desc;
    document.getElementById('bodyRadius').innerText = data.radius;
    document.getElementById('bodyGravity').innerText = data.gravity;
    document.getElementById('bodyDay').innerText = data.day;

    const container = document.getElementById('landmarkButtons');
    container.innerHTML = '';
    data.landmarks.forEach(site => {
        const btn = document.createElement('button');
        btn.className = 'landmark-btn';
        btn.innerText = site.name;
        btn.onclick = () => flyToLocation(site.lon, site.lat, site.height);
        container.appendChild(btn);
    });
}

function flyToLocation(lon, lat, height) {
    if (!viewer) return;
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        duration: 2.5
    });
}

async function switchBody(bodyType, buttonElement) {
    currentBody = bodyType;

    const paramsPanel = document.getElementById('parametersPanel');
    if (bodyType === 'mars' || bodyType === 'moon') {
        paramsPanel.classList.remove('hidden');
    } else {
        paramsPanel.classList.add('hidden');
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
                baseLayerPicker: true,
                geocoder: true,
                homeButton: true,
                sceneModePicker: false,
                navigationHelpButton: false
            });
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