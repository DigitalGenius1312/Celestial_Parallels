Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IkFGdWpPdG5KTXlaTUd5d1YiLCJqdGkiOiIyNTFjOThkNS1hNzFhLTQxYTMtYThhNC03NWM5MWUzYTQwYzQiLCJpZCI6NTQ2MzQ1LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3OTQyOTk1NTR9.uA8wnMFn1XK8-Q9HqZSWeFVLyts5jXTTn48cMoyB59E';
let viewer = null;

function showLoading(text) {
    const overlay = document.getElementById('loadingOverlay');
    document.getElementById('loadingText').innerText = text;
    overlay.classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

async function switchBody(bodyType, buttonElement) {
    // Update active button UI
    document.querySelectorAll('.planet-btn').forEach(btn => btn.classList.remove('active'));
    buttonElement.classList.add('active');

    showLoading(`Loading ${bodyType.charAt(0).toUpperCase() + bodyType.slice(1)}...`);

    // Destroy existing viewer instance cleanly
    if (viewer) {
        viewer.destroy();
        viewer = null;
    }

    try {
        if (bodyType === 'earth') {
            Cesium.Ellipsoid.default = Cesium.Ellipsoid.WGS84;
            viewer = new Cesium.Viewer('cesiumContainer', {
                animation: true,
                timeline: true,
                baseLayerPicker: true
            });
        } else {
            let assetId = null;
            if (bodyType === 'mars') {
                Cesium.Ellipsoid.default = Cesium.Ellipsoid.MARS;
                assetId = 3644333;
            } else if (bodyType === 'moon') {
                Cesium.Ellipsoid.default = Cesium.Ellipsoid.MOON;
                assetId = 2684829;
            }

            viewer = new Cesium.Viewer('cesiumContainer', {
                baseLayerPicker: false,
                geocoder: false,
                globe: false
            });

            const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(assetId);
            viewer.scene.primitives.add(tileset);
            await viewer.flyTo(tileset);
        }
    } catch (error) {
        console.error(`Error loading ${bodyType}:`, error);
        alert(`Failed to load ${bodyType}. Please check your Cesium Ion token and asset IDs.`);
    } finally {
        hideLoading();
    }
}

// Initialize with Earth on startup
window.addEventListener('DOMContentLoaded', () => {
    const defaultBtn = document.querySelector('.planet-btn');
    switchBody('earth', defaultBtn);
});