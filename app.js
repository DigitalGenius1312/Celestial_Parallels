// PASTE YOUR CESIUM ION ACCESS TOKEN HERE
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IkxzcGZEeFJVZ2tOaHpjNDAiLCJqdGkiOiI0YzZmZDQxMi02YzE1LTQ1YTAtOTU3YS1hYjc4ODBjODI5YjAiLCJpZCI6NTQ5MDU2LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3OTQ2MzQyNjd9.LKcOcauPPM8fBzzh4wufXX-9wzQG5JseBHKFiFdrvjw';

let viewer = null;
let currentBody = 'earth';
let lastMatch = null;

let customLocations = {
    earth: [],
    mars: [],
    moon: []
};

let allCandidates = [];
let currentCandidateIndex = 0;
let globeClickHandler = null;

const marsEllipsoid = new Cesium.Ellipsoid(3389500.0, 3389500.0, 3389500.0);
const moonEllipsoid = new Cesium.Ellipsoid(1737400.0, 1737400.0, 1737400.0);

// --- DRAGGABLE PANELS WITH VIEWPORT CLAMPING ---
function makeDraggable(panelId, handleSelector) {
    const panel = document.getElementById(panelId);
    const handle = panel ? panel.querySelector(handleSelector) : null;
    if (!panel || !handle) return;

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    handle.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = panel.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        panel.style.right = 'auto';
        panel.style.left = `${initialLeft}px`;
        panel.style.top = `${initialTop}px`;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
    });

    function onMouseMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const maxLeft = window.innerWidth - panel.offsetWidth - 10;
        const maxTop = window.innerHeight - 60;

        const clampedLeft = Math.max(10, Math.min(maxLeft, initialLeft + dx));
        const clampedTop = Math.max(66, Math.min(maxTop, initialTop + dy));

        panel.style.left = `${clampedLeft}px`;
        panel.style.top = `${clampedTop}px`;
    }

    function onMouseUp() {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
}

async function recenterOnLastMatch() {
    if (!lastMatch) return;
    const destKey = lastMatch.destBodyKey || 'earth';
    if (currentBody !== destKey) {
        await switchBody(destKey, document.querySelector(`.planet-btn[data-body="${destKey}"]`));
    }
    flyToLocation(lastMatch.lon, lastMatch.lat, lastMatch.cameraHeight);
}

function toggleResultPanel() {
    const resultPanel = document.getElementById('analogResultPanel');
    const reopenWrapper = document.getElementById('reopenResultsWrapper');

    if (!lastMatch) return;

    if (resultPanel.classList.contains('hidden')) {
        resultPanel.classList.remove('hidden');
        if (reopenWrapper) reopenWrapper.classList.add('hidden');
    } else {
        resultPanel.classList.add('hidden');
        if (reopenWrapper) reopenWrapper.classList.remove('hidden');
    }
}

function closeResultPanel() {
    document.getElementById('analogResultPanel').classList.add('hidden');
    const reopenWrapper = document.getElementById('reopenResultsWrapper');
    if (reopenWrapper && lastMatch) {
        reopenWrapper.classList.remove('hidden');
    }
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
    const chevron = document.getElementById('drawerChevron');
    form.classList.toggle('collapsed');
    chevron.innerText = form.classList.contains('collapsed') ? "+" : "\u2212";
}

function filterLocationLists() {
    const query = (document.getElementById('siteSearchInput').value || '').toLowerCase().trim();
    document.querySelectorAll('.location-block').forEach(block => {
        const name = (block.querySelector('.location-name')?.innerText || '').toLowerCase();
        block.style.display = name.includes(query) ? 'flex' : 'none';
    });
}

function handleParamSubmit(event) {
    event.preventDefault();

    const name = document.getElementById('locNameInput').value.trim();
    const lat = parseFloat(document.getElementById('locLatInput').value);
    const lon = parseFloat(document.getElementById('locLonInput').value);

    if (!name || isNaN(lat) || isNaN(lon)) return;

    customLocations[currentBody].push({ name, lat, lon });
    renderSavedLocations(currentBody);
    document.getElementById('planetaryForm').reset();
    toggleParamsDrawer();
}

function buildLocationCard(site, bodyType, isCustom = false, index = -1, pinEntity = null) {
    const block = document.createElement('div');
    block.className = 'location-block';

    const headerDiv = document.createElement('div');
    headerDiv.className = 'location-header';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'location-info';
    infoDiv.title = "Click to zoom to location";
    infoDiv.onclick = () => flyToLocation(site.lon, site.lat, bodyType === 'earth' ? 450000 : 120000);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'location-name';
    nameSpan.innerText = site.name;

    const coordsSpan = document.createElement('span');
    coordsSpan.className = 'location-coords';
    coordsSpan.innerText = `${site.lat.toFixed(2)}\u00b0, ${site.lon.toFixed(2)}\u00b0`;

    infoDiv.appendChild(nameSpan);
    infoDiv.appendChild(coordsSpan);
    headerDiv.appendChild(infoDiv);

    if (isCustom) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-block-btn';
        removeBtn.title = "Remove site";
        removeBtn.innerHTML = '&times;';
        removeBtn.onclick = () => {
            customLocations[bodyType].splice(index, 1);
            renderSavedLocations(bodyType);
            if (viewer && pinEntity) viewer.entities.remove(pinEntity);
        };
        headerDiv.appendChild(removeBtn);
    }

    block.appendChild(headerDiv);

    if (bodyType === 'earth') {
        const dualRow = document.createElement('div');
        dualRow.className = 'dual-action-row';

        const findMarsBtn = document.createElement('button');
        findMarsBtn.className = 'find-earth-btn mars-pill-btn';
        findMarsBtn.innerText = 'Mars match';
        findMarsBtn.onclick = () => runAnalogSearch('earth', site.name, site.lat, site.lon, 'mars');

        const findMoonBtn = document.createElement('button');
        findMoonBtn.className = 'find-earth-btn moon-pill-btn';
        findMoonBtn.innerText = 'Moon match';
        findMoonBtn.onclick = () => runAnalogSearch('earth', site.name, site.lat, site.lon, 'moon');

        dualRow.appendChild(findMarsBtn);
        dualRow.appendChild(findMoonBtn);
        block.appendChild(dualRow);
    } else {
        const findEarthBtn = document.createElement('button');
        findEarthBtn.className = 'find-earth-btn earth-pill-btn';
        findEarthBtn.innerText = 'Find Earth analog';
        findEarthBtn.onclick = () => runAnalogSearch(bodyType, site.name, site.lat, site.lon, 'earth');
        block.appendChild(findEarthBtn);
    }

    return block;
}

function renderSavedLocations(bodyType) {
    const wrapper = document.getElementById('savedLocationsWrapper');
    const listContainer = document.getElementById('savedLocationsList');
    if (!listContainer || !wrapper) return;
    listContainer.innerHTML = '';

    const sites = customLocations[bodyType] || [];
    if (sites.length === 0) {
        wrapper.classList.add('hidden');
        return;
    }

    wrapper.classList.remove('hidden');
    sites.forEach((site, index) => {
        const pinEntity = addGlobePin(site.name, site.lat, site.lon, true);
        const card = buildLocationCard(site, bodyType, true, index, pinEntity);
        listContainer.appendChild(card);
    });
    filterLocationLists();
}

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

// Unified Bidirectional Analog Search
async function runAnalogSearch(sourceBody, name, lat, lon, destBody) {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    overlay.classList.remove('hidden');

    const activeWeights = getActiveWeights();
    const sourceName = sourceBody.charAt(0).toUpperCase() + sourceBody.slice(1);
    const destName = destBody.charAt(0).toUpperCase() + destBody.slice(1);

    const progressMessages = [
        `Sampling ${name} (${sourceName})...`,
        `Comparing 22 environmental & geological features...`,
        `Scanning ${destName} surface grid...`,
        `Refining top 5 analog candidates...`
    ];

    let msgIndex = 0;
    loadingText.innerText = progressMessages[msgIndex];

    const textInterval = setInterval(() => {
        msgIndex = (msgIndex + 1) % progressMessages.length;
        loadingText.innerText = progressMessages[msgIndex];
    }, 750);

    try {
        const response = await fetch('/api/pinpoint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                body: sourceBody,
                lat: lat,
                lon: lon,
                weights: activeWeights,
                destinationBody: destBody
            })
        });

        if (!response.ok) throw new Error("Failed to compute analog locations.");

        const data = await response.json();
        allCandidates = data.candidates || [];
        if (allCandidates.length === 0) {
            showToast(`No ${destName} analogs met the minimum similarity threshold for ${name}.`);
            return;
        }

        clearInterval(textInterval);
        loadingText.innerText = `Flying to ${destName} match...`;

        await switchBody(destBody, document.querySelector(`.planet-btn[data-body="${destBody}"]`));

        currentCandidateIndex = 0;
        renderCandidateTabs();
        await selectCandidate(0, name, sourceName, destName, lat, lon, activeWeights);

    } catch (error) {
        console.error("Error communicating with Python API:", error);
        showToast("Could not reach the matching service. Check that the backend is running and try again.");
    } finally {
        clearInterval(textInterval);
        overlay.classList.add('hidden');
    }
}

function renderCandidateTabs() {
    const container = document.getElementById('candidateTabsContainer');
    if (!container) return;
    container.innerHTML = '';

    allCandidates.forEach((cand, idx) => {
        const btn = document.createElement('button');
        btn.className = `cand-tab ${idx === currentCandidateIndex ? 'active' : ''}`;
        btn.innerText = `#${idx + 1} (${(cand.S_refined * 100).toFixed(0)}%)`;
        btn.onclick = () => switchCandidate(idx);
        container.appendChild(btn);
    });
}

function switchCandidate(idx) {
    if (idx < 0 || idx >= allCandidates.length) return;
    currentCandidateIndex = idx;
    renderCandidateTabs();
    
    const m = lastMatch;
    if (m) {
        selectCandidate(idx, m.targetName, m.targetBody, m.destBody, m.targetLat, m.targetLon, m.weightsUsed);
    }
}

function getScoreTierColor(pct) {
    if (pct >= 75) return '#6cc08f';
    if (pct >= 50) return '#8fb8d6';
    return '#d68a6c';
}

async function selectCandidate(idx, targetName, sourceBodyName, destBodyName, targetLat, targetLon, activeWeights) {
    const cand = allCandidates[idx];
    const derivedLat = cand.lat;
    const derivedLon = cand.lon;
    const errorRadiusKm = cand.pinpoint_error_km;
    const radiusMeters = Math.max(errorRadiusKm * 1000, 15000);
    const cameraHeight = Math.max(radiusMeters * 12, 200000);

    lastMatch = {
        timestamp: new Date().toISOString(),
        targetName: targetName,
        targetBody: sourceBodyName,
        targetBodyKey: sourceBodyName.toLowerCase(),
        destBody: destBodyName,
        destBodyKey: destBodyName.toLowerCase(),
        targetLat: targetLat,
        targetLon: targetLon,
        lat: derivedLat,
        lon: derivedLon,
        earthPlaceName: "Identifying region...",
        radiusMeters: radiusMeters,
        cameraHeight: cameraHeight,
        errorKm: errorRadiusKm,
        S_score: cand.S_refined,
        cat_scores: cand,
        sub_scores: cand.sub_scores,
        target_raw: cand.target_raw,
        earth_raw: cand.earth_raw,
        weightsUsed: activeWeights
    };

    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(derivedLon, derivedLat, cameraHeight),
        duration: 2.0
    });

    // Clear previous match shapes (No green point marker)
    viewer.entities.values.slice().forEach(entity => {
        if (entity.ellipse || entity.isMatchPin) viewer.entities.remove(entity);
    });

    viewer.entities.add({
        isMatchPin: true,
        position: Cesium.Cartesian3.fromDegrees(derivedLon, derivedLat),
        ellipse: {
            semiMajorAxis: radiusMeters,
            semiMinorAxis: radiusMeters,
            material: Cesium.Color.fromCssColorString("#e3b23c").withAlpha(0.28),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#e3b23c"),
            outlineWidth: 2
        }
    });

    const overallPct = cand.S_refined * 100;
    const scoreColor = getScoreTierColor(overallPct);

    document.getElementById('resultDirectionBadge').innerText = `${sourceBodyName} to ${destBodyName}`;
    document.getElementById('resultSourceTarget').innerText = `Rank #${idx + 1} match for ${targetName}`;
    document.getElementById('resultLat').innerText = `${derivedLat.toFixed(4)}\u00b0`;
    document.getElementById('resultLon').innerText = `${derivedLon.toFixed(4)}\u00b0`;
    
    const scoreEl = document.getElementById('resultScore');
    scoreEl.innerText = `${overallPct.toFixed(1)}%`;
    scoreEl.style.color = scoreColor;
    document.getElementById('resultError').innerText = `\u00b1 ${errorRadiusKm} km`;

    document.getElementById('weightTagC1').innerText = `${Math.round(activeWeights.C1 * 100)}%`;
    document.getElementById('weightTagC2').innerText = `${Math.round(activeWeights.C2 * 100)}%`;
    document.getElementById('weightTagC3').innerText = `${Math.round(activeWeights.C3 * 100)}%`;
    document.getElementById('weightTagC4').innerText = `${Math.round(activeWeights.C4 * 100)}%`;
    document.getElementById('weightTagC5').innerText = `${Math.round(activeWeights.C5 * 100)}%`;

    ['C1', 'C2', 'C3', 'C4', 'C5'].forEach(cat => {
        const valPct = (cand[cat] || 0) * 100;
        const barFill = document.getElementById(`bar${cat}`);
        const scoreSpan = document.getElementById(`score${cat}`);
        scoreSpan.innerText = `${valPct.toFixed(1)}%`;
        scoreSpan.style.color = getScoreTierColor(valPct);
        barFill.style.width = `${valPct.toFixed(1)}%`;
        barFill.style.background = getScoreTierColor(valPct);
    });

    if (cand.sub_scores) {
        document.querySelectorAll('[data-feat]').forEach(el => {
            const key = el.getAttribute('data-feat');
            const val = cand.sub_scores[key];
            el.innerText = val !== undefined ? `${(val * 100).toFixed(0)}%` : '--';
        });
    }

    // Keep both panels accessible side-by-side without overlapping
    const paramsPanel = document.getElementById('parametersPanel');
    const resultPanel = document.getElementById('analogResultPanel');
    paramsPanel.classList.remove('hidden');
    resultPanel.classList.remove('hidden');
    document.getElementById('reopenResultsWrapper').classList.add('hidden');

    if (cand.body === 'Earth') {
        document.getElementById('resultPlaceName').innerText = "Identifying region...";
        const placeName = await fetchEarthPlaceName(derivedLat, derivedLon);
        document.getElementById('resultPlaceName').innerText = placeName;
        if (lastMatch) lastMatch.earthPlaceName = placeName;
    } else {
        const regionLabel = cand.place_name || `${destBodyName} Sector (${derivedLat.toFixed(2)}\u00b0, ${derivedLon.toFixed(2)}\u00b0)`;
        document.getElementById('resultPlaceName').innerText = regionLabel;
        if (lastMatch) lastMatch.earthPlaceName = regionLabel;
    }
}

function getActiveWeights() {
    const rawC1 = parseFloat(document.getElementById('weightC1').value) || 0;
    const rawC2 = parseFloat(document.getElementById('weightC2').value) || 0;
    const rawC3 = parseFloat(document.getElementById('weightC3').value) || 0;
    const rawC4 = parseFloat(document.getElementById('weightC4').value) || 0;
    const rawC5 = parseFloat(document.getElementById('weightC5').value) || 0;

    const total = rawC1 + rawC2 + rawC3 + rawC4 + rawC5;
    if (total === 0) return { C1: 0.2, C2: 0.25, C3: 0.2, C4: 0.2, C5: 0.15 };

    return {
        C1: rawC1 / total,
        C2: rawC2 / total,
        C3: rawC3 / total,
        C4: rawC4 / total,
        C5: rawC5 / total
    };
}

function updateWeightsFromSliders() {
    const rawC1 = parseFloat(document.getElementById('weightC1').value) || 0;
    const rawC2 = parseFloat(document.getElementById('weightC2').value) || 0;
    const rawC3 = parseFloat(document.getElementById('weightC3').value) || 0;
    const rawC4 = parseFloat(document.getElementById('weightC4').value) || 0;
    const rawC5 = parseFloat(document.getElementById('weightC5').value) || 0;
    const total = rawC1 + rawC2 + rawC3 + rawC4 + rawC5 || 1;

    document.getElementById('valC1').innerText = `${Math.round((rawC1 / total) * 100)}%`;
    document.getElementById('valC2').innerText = `${Math.round((rawC2 / total) * 100)}%`;
    document.getElementById('valC3').innerText = `${Math.round((rawC3 / total) * 100)}%`;
    document.getElementById('valC4').innerText = `${Math.round((rawC4 / total) * 100)}%`;
    document.getElementById('valC5').innerText = `${Math.round((rawC5 / total) * 100)}%`;
}

function applyWeightPreset(presetName) {
    const weights = {
        default: { C1: 20, C2: 25, C3: 20, C4: 20, C5: 15 },
        rover:   { C1: 10, C2: 40, C3: 15, C4: 10, C5: 25 },
        isru:    { C1: 15, C2: 15, C3: 20, C4: 40, C5: 10 },
        geology: { C1: 45, C2: 20, C3: 10, C4: 10, C5: 15 },
        astro:   { C1: 30, C2: 10, C3: 20, C4: 30, C5: 10 },
        landing: { C1: 5,  C2: 45, C3: 15, C4: 5,  C5: 30 },
        thermal: { C1: 10, C2: 15, C3: 45, C4: 10, C5: 20 },
        aeolian: { C1: 15, C2: 25, C3: 10, C4: 5,  C5: 45 },
        hardware:{ C1: 10, C2: 15, C3: 30, C4: 10, C5: 35 }
    };
    const p = weights[presetName] || weights.default;
    document.getElementById('weightC1').value = p.C1;
    document.getElementById('weightC2').value = p.C2;
    document.getElementById('weightC3').value = p.C3;
    document.getElementById('weightC4').value = p.C4;
    document.getElementById('weightC5').value = p.C5;
    updateWeightsFromSliders();
}

// --- PLANETARY DATA ---
const bodyData = {
    earth: {
        title: "Earth",
        desc: "Our home planet and the primary baseline for terrestrial analog field testing.",
        radius: "6,371 km",
        gravity: "9.8 m/s\u00b2",
        day: "24 hrs",
        sidebarTitle: "Earth sites",
        sidebarSub: "Find a matching site on Mars or the Moon",
        presetsLabel: "Earth analog testbeds"
    },
    mars: {
        title: "Mars",
        desc: "The Red Planet, home to the largest volcanoes and deepest canyons in the solar system.",
        radius: "3,389 km",
        gravity: "3.7 m/s\u00b2",
        day: "24h 37m",
        assetId: 3644333,
        sidebarTitle: "Mars sites",
        sidebarSub: "Find a matching site on Earth",
        presetsLabel: "Notable regions on Mars"
    },
    moon: {
        title: "The Moon",
        desc: "Earth's sole natural satellite, scarred by billions of years of asteroid impacts.",
        radius: "1,737 km",
        gravity: "1.6 m/s\u00b2",
        day: "29.5 days",
        assetId: 2684829,
        sidebarTitle: "Moon sites",
        sidebarSub: "Find a matching site on Earth",
        presetsLabel: "Notable lunar landmarks"
    }
};

// --- DEFAULT PRESET BASES & LANDMARKS ---
const defaultLocations = {
    earth: [
        { name: "Atacama Desert (Chile)", lat: -23.8631, lon: -69.1328 },
        { name: "Devon Island (Haughton Crater)", lat: 75.3833, lon: -89.8500 },
        { name: "Mauna Kea (Hawaii)", lat: 19.8207, lon: -155.4681 },
        { name: "Ladakh / Hanle (India)", lat: 32.7785, lon: 78.9645 }
    ],
    moon: [
        { name: "Tranquility Base (Apollo 11)", lat: 0.67, lon: 23.47 },
        { name: "Shackleton Crater (Lunar South Pole)", lat: -89.90, lon: 0.00 },
        { name: "Copernicus Crater", lat: 9.62, lon: -20.08 },
        { name: "Clavius Crater", lat: -58.40, lon: -14.40 },
        { name: "Plato Crater", lat: 51.60, lon: -9.30 },
        { name: "Mare Imbrium", lat: 32.80, lon: -15.60 },
        { name: "Mare Serenitatis", lat: 28.00, lon: 17.50 },
        { name: "Von Karman Crater (Chang'e 4)", lat: -44.45, lon: 176.25 },
        { name: "Tycho Crater", lat: -43.31, lon: -11.36 },
        { name: "Aristarchus / Vallis Schroteri", lat: 23.73, lon: -47.49 }
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

function setupGlobeHandlers() {
    if (!viewer) return;
    if (globeClickHandler) {
        globeClickHandler.destroy();
        globeClickHandler = null;
    }

    globeClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    const hudCoords = document.getElementById('hudCoords');

    // Live Coordinate Telemetry on Mouse Move
    globeClickHandler.setInputAction((movement) => {
        let ellipsoid = Cesium.Ellipsoid.WGS84;
        if (currentBody === 'mars') ellipsoid = marsEllipsoid;
        if (currentBody === 'moon') ellipsoid = moonEllipsoid;

        const cartesian = viewer.scene.camera.pickEllipsoid(movement.endPosition, ellipsoid);
        if (cartesian && hudCoords) {
            const cartographic = ellipsoid.cartesianToCartographic(cartesian);
            const lat = Cesium.Math.toDegrees(cartographic.latitude).toFixed(4);
            const lon = Cesium.Math.toDegrees(cartographic.longitude).toFixed(4);
            hudCoords.innerText = `${lat}\u00b0, ${lon}\u00b0  \u2022  Double-click to add a site`;
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    const handleGlobePick = (position) => {
        let ellipsoid = Cesium.Ellipsoid.WGS84;
        if (currentBody === 'mars') ellipsoid = marsEllipsoid;
        if (currentBody === 'moon') ellipsoid = moonEllipsoid;
        
        let cartesian = viewer.scene.camera.pickEllipsoid(position, ellipsoid);
        if (!cartesian && viewer.scene.pickPositionSupported) {
            cartesian = viewer.scene.pickPosition(position);
        }

        if (cartesian) {
            let cartographic = ellipsoid.cartesianToCartographic(cartesian);
            let lat = Cesium.Math.toDegrees(cartographic.latitude);
            let lon = Cesium.Math.toDegrees(cartographic.longitude);

            document.getElementById('parametersPanel').classList.remove('hidden');
            document.getElementById('locLatInput').value = lat.toFixed(4);
            document.getElementById('locLonInput').value = lon.toFixed(4);

            const form = document.getElementById('planetaryForm');
            if (form.classList.contains('collapsed')) {
                toggleParamsDrawer();
            }

            const nameInput = document.getElementById('locNameInput');
            nameInput.value = "";
            nameInput.placeholder = `Site at ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
            nameInput.focus();
        }
    };

    globeClickHandler.setInputAction((click) => handleGlobePick(click.position), Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    globeClickHandler.setInputAction((click) => handleGlobePick(click.position), Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    viewer.scene.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function addGlobePin(name, lat, lon, isCustom = false) {
    if (!viewer) return null;

    let ellipsoid = Cesium.Ellipsoid.WGS84;
    if (currentBody === 'mars') ellipsoid = marsEllipsoid;
    if (currentBody === 'moon') ellipsoid = moonEllipsoid;

    const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0, ellipsoid);

    return viewer.entities.add({
        position: position,
        point: {
            pixelSize: isCustom ? 11 : 9,
            color: isCustom ? Cesium.Color.fromCssColorString("#e3b23c") : Cesium.Color.fromCssColorString("#8fb8d6"),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2
        },
        label: {
            text: name,
            font: '600 12px "Public Sans", sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -12),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 15000000.0)
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
        const card = buildLocationCard(site, bodyType, false);
        presetContainer.appendChild(card);
    });
    filterLocationLists();
}

function updateUI(bodyType) {
    const data = bodyData[bodyType];
    document.getElementById('bodyTitle').innerText = data.title;
    document.getElementById('bodyDesc').innerText = data.desc;
    document.getElementById('bodyRadius').innerText = data.radius;
    document.getElementById('bodyGravity').innerText = data.gravity;
    document.getElementById('bodyDay').innerText = data.day;

    document.getElementById('sidebarTitle').innerText = data.sidebarTitle;
    document.getElementById('sidebarSubtitle').innerText = data.sidebarSub;
    document.getElementById('presetsSectionLabel').innerText = data.presetsLabel;
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

    document.getElementById('parametersPanel').classList.remove('hidden');
    
    // Hide search bar on Mars and Moon, show on Earth
    const searchBox = document.getElementById('geocoderSearchWrapper');
    if (searchBox) {
        searchBox.style.display = (bodyType === 'earth') ? 'flex' : 'none';
    }

    if (lastMatch) {
        document.getElementById('reopenResultsWrapper').classList.remove('hidden');
    }

    document.querySelectorAll('.planet-btn').forEach(btn => btn.classList.remove('active'));
    if (buttonElement) buttonElement.classList.add('active');

    const overlay = document.getElementById('loadingOverlay');
    document.getElementById('loadingText').innerText = `Loading ${bodyData[bodyType].title}`;
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
                animation: false, timeline: false, baseLayerPicker: false,
                geocoder: true, homeButton: true, sceneModePicker: false,
                navigationHelpButton: false, globe: false
            });
            const tileset = await Cesium.createGooglePhotorealistic3DTileset();
            viewer.scene.primitives.add(tileset);
        } else {
            Cesium.Ellipsoid.default = bodyType === 'mars' ? marsEllipsoid : moonEllipsoid;
            viewer = new Cesium.Viewer('cesiumContainer', {
                animation: false, timeline: false, baseLayerPicker: false,
                geocoder: false, homeButton: false, sceneModePicker: false,
                navigationHelpButton: false, globe: false
            });

            const controller = viewer.scene.screenSpaceCameraController;
            controller.zoomEventTypes = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];
            controller.inertiaSpin = 0.05;
            controller.inertiaTranslate = 0.05;
            controller.inertiaZoom = 0.05;

            const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(bodyData[bodyType].assetId);
            viewer.scene.primitives.add(tileset);
            await viewer.flyTo(tileset);
        }

        renderPresetLocations(bodyType);
        renderSavedLocations(bodyType);
        setupGlobeHandlers();

    } catch (error) {
        console.error(`Error loading ${bodyType}:`, error);
    } finally {
        setTimeout(() => overlay.classList.add('hidden'), 300);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    switchBody('earth', document.querySelector('.planet-btn[data-body="earth"]'));
});

// Keyboard shortcuts: 1/2/3 to switch bodies, Esc to close modals
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === '1') switchBody('earth', document.querySelector('.planet-btn[data-body="earth"]'));
    if (e.key === '2') switchBody('mars', document.querySelector('.planet-btn[data-body="mars"]'));
    if (e.key === '3') switchBody('moon', document.querySelector('.planet-btn[data-body="moon"]'));
    if (e.key === 'Escape') {
        document.getElementById('weightsModal')?.classList.add('hidden');
        document.getElementById('comparisonModal')?.classList.add('hidden');
        document.getElementById('howtoSection')?.classList.add('hidden');
        document.getElementById('aboutSection')?.classList.add('hidden');
        document.querySelectorAll('.nav-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    }
});

setInterval(() => {
    fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
}, 2000);

window.addEventListener('beforeunload', () => {
    navigator.sendBeacon('/api/shutdown');
});

// --- PARAMETER CATALOG & EXPORT MISSION BRIEF FUNCTIONS ---
const PARAMETER_CATALOG = [
    { cat: "C1: Mineralogy", label: "Silicate Fraction", scoreKey: "g1_silicate", rawKey: "g1_silicate", unit: "ratio" },
    { cat: "C1: Mineralogy", label: "Basalt Fraction", scoreKey: "g2_basalt", rawKey: "g2_basalt", unit: "ratio" },
    { cat: "C1: Mineralogy", label: "Iron Oxide Content", scoreKey: "g3_iron_oxide", rawKey: "g3_iron_oxide", unit: "ratio" },
    { cat: "C1: Mineralogy", label: "Plagioclase Feldspar", scoreKey: "g4_plagioclase", rawKey: "g4_plagioclase", unit: "ratio" },
    { cat: "C1: Mineralogy", label: "Igneous Lithology", scoreKey: "g5_igneous", rawKey: "g5_igneous", unit: "ratio" },
    { cat: "C1: Mineralogy", label: "Sedimentary Lithology", scoreKey: "g6_sedimentary", rawKey: "g6_sedimentary", unit: "ratio" },
    { cat: "C1: Mineralogy", label: "Metamorphic Lithology", scoreKey: "g7_metamorphic", rawKey: "g7_metamorphic", unit: "ratio" },
    { cat: "C1: Mineralogy", label: "Regolith Cover", scoreKey: "g8_regolith", rawKey: "g8_regolith", unit: "ratio" },

    { cat: "C2: Topography", label: "Elevation", scoreKey: "u_elevation_body_z", rawKey: "u_elevation", unit: "m" },
    { cat: "C2: Topography", label: "Surface Slope", scoreKey: "u_slope_body_z", rawKey: "u_slope", unit: "deg" },
    { cat: "C2: Topography", label: "Terrain Roughness", scoreKey: "u_roughness_body_z", rawKey: "u_roughness", unit: "index" },
    { cat: "C2: Topography", label: "Crater Density", scoreKey: "u_crater", rawKey: "u_crater", unit: "index" },

    { cat: "C3: Thermal", label: "Mean Surface Temp", scoreKey: "z_Tmean_body_z", rawKey: "z_Tmean", unit: "K" },
    { cat: "C3: Thermal", label: "Diurnal Temp Range", scoreKey: "z_Trange_body_z", rawKey: "z_Trange", unit: "K" },
    { cat: "C3: Thermal", label: "Solar Illumination", scoreKey: "z_illum_body_z", rawKey: "z_illum", unit: "index" },

    { cat: "C4: Subsurface", label: "Water Ice Concentration", scoreKey: "u_ice", rawKey: "u_ice", unit: "ratio" },
    { cat: "C4: Subsurface", label: "Ice Table Depth", scoreKey: "u_depth", rawKey: "u_depth", unit: "m" },
    { cat: "C4: Subsurface", label: "Permafrost Index", scoreKey: "u_permafrost", rawKey: "u_permafrost", unit: "index" },
    { cat: "C4: Subsurface", label: "Surface Hydration", scoreKey: "u_hydration", rawKey: "u_hydration", unit: "index" },

    { cat: "C5: Eolian", label: "Atmospheric Dust Load", scoreKey: "u_dust", rawKey: "u_dust", unit: "index" },
    { cat: "C5: Eolian", label: "Surface Wind Speed", scoreKey: "u_wind", rawKey: "u_wind", unit: "m/s" },
    { cat: "C5: Eolian", label: "Eolian Erosion Rate", scoreKey: "u_erosion", rawKey: "u_erosion", unit: "index" }
];

function sanitizeFilename(str) {
    if (!str) return "site";
    return str.replace(/[^a-z0-9_\-]+/gi, '_').replace(/^_+|_+$/g, '');
}

function exportMissionCSV() {
    if (!lastMatch) return;
    const m = lastMatch;

    const rows = [
        ["SECTION", "PARAMETER", "CATEGORY", `${m.targetBody.toUpperCase()}_VALUE`, `${m.destBody.toUpperCase()}_VALUE`, "SIMILARITY_PCT", "UNIT"],
        ["SITE_OVERVIEW", "Site Name", "Location", m.targetName, m.earthPlaceName, "", ""],
        ["SITE_OVERVIEW", "Latitude", "Coordinates", m.targetLat, m.lat, "", "deg"],
        ["SITE_OVERVIEW", "Longitude", "Coordinates", m.targetLon, m.lon, "", "deg"],
        ["SITE_OVERVIEW", "Overall Suitability (S)", "Suitability", "", m.S_score, (m.S_score * 100).toFixed(2) + "%", "0-1"]
    ];

    PARAMETER_CATALOG.forEach(p => {
        const sVal = m.target_raw[p.rawKey] !== undefined ? m.target_raw[p.rawKey] : "";
        const dVal = m.earth_raw[p.rawKey] !== undefined ? m.earth_raw[p.rawKey] : "";
        const sim = m.sub_scores[p.scoreKey] !== undefined ? (m.sub_scores[p.scoreKey] * 100).toFixed(2) + "%" : "";
        rows.push(["SUB_PARAMETER", p.label, p.cat, sVal, dVal, sim, p.unit]);
    });

    const csvContent = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Analog_Brief_${m.targetBody}_to_${m.destBody}_${sanitizeFilename(m.targetName)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function exportMissionBrief() {
    if (!lastMatch) return;
    const m = lastMatch;

    const paramRowsHtml = PARAMETER_CATALOG.map(p => {
        const sVal = m.target_raw[p.rawKey] !== undefined ? Number(m.target_raw[p.rawKey]).toFixed(4) : "N/A";
        const dVal = m.earth_raw[p.rawKey] !== undefined ? Number(m.earth_raw[p.rawKey]).toFixed(4) : "N/A";
        const sim = m.sub_scores[p.scoreKey] !== undefined ? `${(m.sub_scores[p.scoreKey] * 100).toFixed(1)}%` : "N/A";
        return `<tr><td>${p.cat}</td><td>${p.label}</td><td>${sVal} ${p.unit}</td><td>${dVal} ${p.unit}</td><td><strong>${sim}</strong></td></tr>`;
    }).join("");

    const reportHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Mission Brief — ${esc(m.targetName)}</title>
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1e293b; margin: 30px; }
    h1 { font-size: 20px; border-bottom: 2px solid #0f172a; padding-bottom: 8px; }
    .meta { margin-bottom: 18px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    th { background: #f1f5f9; }
</style></head><body>
    <h1>CELESTIAL PARALLELS — ANALOG MISSION BRIEF (${m.targetBody.toUpperCase()} TO ${m.destBody.toUpperCase()})</h1>
    <div class="meta">
        <strong>Source Site:</strong> ${esc(m.targetName)} (${m.targetLat.toFixed(4)}\u00b0, ${m.targetLon.toFixed(4)}\u00b0)<br>
        <strong>Matched Region:</strong> ${esc(m.earthPlaceName)} (${m.lat.toFixed(4)}\u00b0, ${m.lon.toFixed(4)}\u00b0)<br>
        <strong>Overall Suitability Score:</strong> ${(m.S_score * 100).toFixed(1)}% (\u00b1 ${m.errorKm} km)
    </div>
    <table>
        <thead><tr><th>Category</th><th>Parameter</th><th>${m.targetBody} Value</th><th>${m.destBody} Value</th><th>Similarity</th></tr></thead>
        <tbody>${paramRowsHtml}</tbody>
    </table>
    <script>window.onload = () => window.print();<\/script>
</body></html>`;

    const printWindow = window.open("", "_blank");
    if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(reportHtml);
        printWindow.document.close();
    }
}

function toggleComparisonModal() {
    const modal = document.getElementById('comparisonModal');
    if (!modal) return;
    if (modal.classList.contains('hidden')) {
        populateComparisonTable();
        modal.classList.remove('hidden');
    } else {
        modal.classList.add('hidden');
    }
}

function populateComparisonTable() {
    if (!lastMatch) return;
    const m = lastMatch;

    document.getElementById('sourceColHeader').innerText = `${m.targetBody} Value`;
    document.getElementById('destColHeader').innerText = `${m.destBody} Value`;
    document.getElementById('comparisonSubtitle').innerText =
        `${m.targetName} (${m.targetBody}) vs. ${m.earthPlaceName} (${m.destBody})`;

    const tbody = document.getElementById('comparisonTableBody');
    tbody.innerHTML = '';

    PARAMETER_CATALOG.forEach(p => {
        const sVal = m.target_raw[p.rawKey] !== undefined ? Number(m.target_raw[p.rawKey]).toFixed(4) : "N/A";
        const dVal = m.earth_raw[p.rawKey] !== undefined ? Number(m.earth_raw[p.rawKey]).toFixed(4) : "N/A";
        const sim = m.sub_scores[p.scoreKey] !== undefined ? `${(m.sub_scores[p.scoreKey] * 100).toFixed(1)}%` : "N/A";

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${p.cat}</td>
            <td>${p.label}</td>
            <td>${sVal} <span class="unit">${p.unit}</span></td>
            <td>${dVal} <span class="unit">${p.unit}</span></td>
            <td><strong>${sim}</strong></td>
        `;
        tbody.appendChild(tr);
    });
}

function toggleWeightsModal() {
    const modal = document.getElementById('weightsModal');
    if (modal) modal.classList.toggle('hidden');
}

// --- GOOGLE MAPS-STYLE GEOCODER SEARCH ---
async function executePlaceSearch() {
    const input = document.getElementById('geocoderInput');
    const query = (input.value || '').trim();
    if (!query) return;

    if (currentBody !== 'earth') {
        await switchBody('earth', document.querySelector('.planet-btn[data-body="earth"]'));
    }

    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    loadingText.innerText = `Searching for "${query}"...`;
    overlay.classList.remove('hidden');

    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error("Geocoding service unavailable");
        const results = await res.json();

        if (!results || results.length === 0) {
            showToast(`No location found for "${query}". Try a more specific name.`);
            return;
        }

        const bestMatch = results[0];
        const lat = parseFloat(bestMatch.lat);
        const lon = parseFloat(bestMatch.lon);
        const displayName = bestMatch.display_name;

        // Fly camera to location
        flyToLocation(lon, lat, 350000);

        // Populate parameters panel form automatically
        document.getElementById('parametersPanel').classList.remove('hidden');
        document.getElementById('locLatInput').value = lat.toFixed(4);
        document.getElementById('locLonInput').value = lon.toFixed(4);

        const form = document.getElementById('planetaryForm');
        if (form.classList.contains('collapsed')) {
            toggleParamsDrawer();
        }

        const nameInput = document.getElementById('locNameInput');
        nameInput.value = displayName.split(',')[0]; // Short name
        nameInput.focus();

    } catch (error) {
        console.error("Geocoding error:", error);
        showToast("Search failed. Check your connection and try again.");
    } finally {
        overlay.classList.add('hidden');
    }
}

function handleGeocoderKey(event) {
    if (event.key === 'Enter') {
        executePlaceSearch();
    }
}

// --- SHARED UI HELPERS ---
function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showToast(message, duration = 5000) {
    const region = document.getElementById('toastRegion');
    if (!region) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    region.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

// Category rows act as buttons, so they respond to the keyboard too.
document.addEventListener('keydown', (e) => {
    const row = e.target.closest && e.target.closest('.param-row');
    if (row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        row.classList.toggle('expanded');
    }
});