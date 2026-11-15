// terrainAnalyzer.js - Topographic Region Growth & Similarity Matching

class PlanetaryTopographicMatcher {
    constructor(targetDem, resolutionM = 1.0) {
        this.targetDem = targetDem; // 2D array of elevation values
        this.res = resolutionM;
        this.targetFeatures = this.extractFeatures(targetDem);
    }

    // Extract slope, curvature, and roughness (Equivalent to Python NumPy/SciPy code)
    extractFeatures(dem) {
        const h = dem.length;
        const w = dem[0].length;
        const slope = new Float32Array(h * w);
        const curvature = new Float32Array(h * w);
        const roughness = new Float32Array(h * w);

        let sumSquares = 0;

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                
                // Gradients
                const dx = (dem[y][x + 1] - dem[y][x - 1]) / (2 * this.res);
                const dy = (dem[y + 1][x] - dem[y - 1][x]) / (2 * this.res);
                slope[idx] = Math.atan(Math.sqrt(dx * dx + dy * dy));

                // Curvature approximation
                const dxx = (dem[y][x + 1] - 2 * dem[y][x] + dem[y][x - 1]) / (this.res * this.res);
                const dyy = (dem[y + 1][x] - 2 * dem[y][x] + dem[y - 1][x]) / (this.res * this.res);
                curvature[idx] = dxx + dyy;

                // Roughness (Local variance / abs difference from simple 3x3 local mean)
                let localMean = 0;
                let count = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        localMean += dem[y + ky][x + kx];
                        count++;
                    }
                }
                localMean /= count;
                roughness[idx] = Math.abs(dem[y][x] - localMean);
            }
        }

        // Combine into a single feature vector & normalize vector length
        const featureVector = new Float32Array(slope.length * 3);
        featureVector.set(slope, 0);
        featureVector.set(curvature, slope.length);
        featureVector.set(roughness, slope.length * 2);

        let norm = 0;
        for (let i = 0; i < featureVector.length; i++) {
            norm += featureVector[i] * featureVector[i];
        }
        norm = Math.sqrt(norm);

        if (norm > 0) {
            for (let i = 0; i < featureVector.length; i++) {
                featureVector[i] /= norm;
            }
        }
        return featureVector;
    }

    computeSimilarity(candidateFeatures) {
        const minLen = Math.min(this.targetFeatures.length, candidateFeatures.length);
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < minLen; i++) {
            dotProduct += this.targetFeatures[i] * candidateFeatures[i];
            normA += this.targetFeatures[i] * this.targetFeatures[i];
            normB += candidateFeatures[i] * candidateFeatures[i];
        }

        const cosineSimilarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        return 1.0 - (1.0 - cosineSimilarity); // Returns similarity score (1.0 = identical)
    }

    // Adaptive Region Growth Simulation
    adaptiveRegionGrowth(earthDem, seedY, seedX, initialRadiusM = 200) {
        const pixelRadius = Math.max(2, Math.round(initialRadiusM / this.res));
        const h = earthDem.length;
        const w = earthDem[0].length;

        // Create initial circular mask around seed point
        let currentMask = Array.from({ length: h }, () => new Uint8Array(w));
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const dist = Math.sqrt((x - seedX) ** 2 + (y - seedY) ** 2);
                if (dist <= pixelRadius) {
                    currentMask[y][x] = 1;
                }
            }
        }

        let currentDemPatch = earthDem.map((row, y) => row.map((val, x) => val * currentMask[y][x]));
        let currentFeatures = this.extractFeatures(currentDemPatch);
        let initialSimilarity = this.computeSimilarity(currentFeatures);

        let expansionStep = 0;
        const maxSteps = 100;
        let percentageShift = 0;

        while (expansionStep < max_steps) {
            // Dilate mask (simulate morphological expansion)
            let dilatedMask = currentMask.map(row => new Uint8Array(row));
            for (let y = 1; y < h - 1; y++) {
                for (let x = 1; x < w - 1; x++) {
                    if (currentMask[y][x] === 1) {
                        dilatedMask[y - 1][x] = 1;
                        dilatedMask[y + 1][x] = 1;
                        dilatedMask[y][x - 1] = 1;
                        dilatedMask[y][x + 1] = 1;
                    }
                }
            }

            let expandedDemPatch = earthDem.map((row, y) => row.map((val, x) => val * dilatedMask[y][x]));
            let expandedFeatures = this.extractFeatures(expandedDemPatch);
            let currentSimilarity = this.computeSimilarity(expandedFeatures);

            percentageShift = Math.abs(currentSimilarity - initialSimilarity) / initialSimilarity * 100.0;

            if (percentageShift > 5.0) {
                console.log(`Region growth stopped at step ${expansionStep}: Similarity shifted by ${percentageShift.toFixed(2)}%`);
                break;
            }

            currentMask = dilatedMask;
            expansionStep++;
        }

        return { mask: currentMask, radius: pixelRadius + expansionStep, shift: percentageShift };
    }
}