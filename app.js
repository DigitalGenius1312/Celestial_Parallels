// PASTE YOUR CESIUM ION ACCESS TOKEN HERE
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IkFGdWpPdG5KTXlaTUd5d1YiLCJqdGkiOiIyNTFjOThkNS1hNzFhLTQxYTMtYThhNC03NWM5MWUzYTQwYzQiLCJpZCI6NTQ2MzQ1LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3OTQyOTk1NTR9.uA8wnMFn1XK8-Q9HqZSWeFVLyts5jXTTn48cMoyB59E';

let viewer = null;

// Navigation Tab Switcher
function showSection(sectionName, navBtn) {
    // Update active state on top navbar
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    if (navBtn) navBtn.classList.add('active');

    // Toggle overlays
    const howto = document.getElementById('howtoSection');
    const about = document.getElementById('aboutSection');

    howto.classList.add('hidden');
    about.classList.add('hidden');

    if (sectionName === 'howto') {
        howto.classList.remove('hidden');
    } else if (sectionName === 'about') {
        about.classList.remove('hidden');
    }
}

// Planetary Data & Coordinates
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

    // Populate Landmark Buttons
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
        alert(`Could not load ${bodyData[bodyType].title}. Make sure your Cesium Ion access token is valid.`);
    } finally {
        overlay.classList.add('hidden');
    }
}

// Start with Earth on Home view
window.addEventListener('DOMContentLoaded', () => {
    switchBody('earth', document.querySelector('.planet-btn'));
});