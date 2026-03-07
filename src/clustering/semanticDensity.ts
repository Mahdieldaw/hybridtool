// ═══════════════════════════════════════════════════════════════════════════
// SEMANTIC DENSITY — OLS residual magnitude (pure math, no pipeline imports)
// ═══════════════════════════════════════════════════════════════════════════

export interface DensityRegressionModel {
    alpha: number;
    beta: number;
    meanRes: number;
    stdRes: number;
}

/**
 * Compute z-scored residual magnitudes as a proxy for semantic density.
 *
 * Raw embedding magnitude correlates with text specificity, but is confounded
 * by text length. We regress magnitude on ln(charLength) via OLS, then z-score
 * the residuals so the score is length-independent and zero-centered.
 *
 * @param rawMagnitudes  Map<statementId, L2 norm before normalization>
 * @param textLengths    Map<statementId, char length of stripped text>
 * @returns              scores map + regression model for downstream projection
 */
export function computeSemanticDensityScores(
    rawMagnitudes: Map<string, number>,
    textLengths: Map<string, number>
): { scores: Map<string, number>; model: DensityRegressionModel } {
    const ids = Array.from(rawMagnitudes.keys());
    const n = ids.length;

    if (n < 3) {
        const zeros = new Map<string, number>();
        for (const id of ids) zeros.set(id, 0);
        return { scores: zeros, model: { alpha: 0, beta: 0, meanRes: 0, stdRes: 0 } };
    }

    // Build (x, y) points: x = ln(charLength), y = rawMagnitude
    const xs: number[] = [];
    const ys: number[] = [];
    for (const id of ids) {
        const len = textLengths.get(id) ?? 1;
        xs.push(Math.log(Math.max(len, 1)));
        ys.push(rawMagnitudes.get(id)!);
    }

    // OLS: beta = cov(x,y) / var(x), alpha = meanY - beta * meanX
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;

    let covXY = 0;
    let varX = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - meanX;
        covXY += dx * (ys[i] - meanY);
        varX += dx * dx;
    }

    const beta = varX === 0 ? 0 : covXY / varX;
    const alpha = meanY - beta * meanX;

    // Residuals
    const residuals: number[] = [];
    for (let i = 0; i < n; i++) {
        residuals.push(ys[i] - (alpha + beta * xs[i]));
    }

    // Z-score residuals
    const meanR = residuals.reduce((a, b) => a + b, 0) / n;
    const variance = residuals.reduce((a, r) => a + (r - meanR) ** 2, 0) / n;
    const stdR = Math.sqrt(variance);

    const result = new Map<string, number>();
    if (stdR === 0) {
        for (const id of ids) result.set(id, 0);
        return { scores: result, model: { alpha, beta, meanRes: meanR, stdRes: 0 } };
    }

    for (let i = 0; i < n; i++) {
        result.set(ids[i], (residuals[i] - meanR) / stdR);
    }
    return { scores: result, model: { alpha, beta, meanRes: meanR, stdRes: stdR } };
}

/**
 * Project a single embedding's raw magnitude into the statement regression model.
 * Used for queries and claims that weren't part of the original regression sample.
 */
export function projectSemanticDensity(
    rawMagnitude: number,
    textLength: number,
    model: DensityRegressionModel
): number {
    if (model.stdRes === 0) return 0;
    const expected = model.alpha + model.beta * Math.log(Math.max(1, textLength));
    const residual = rawMagnitude - expected;
    return (residual - model.meanRes) / model.stdRes;
}
