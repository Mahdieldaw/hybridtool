import { UMAP } from 'umap-js';

export interface Layout2DResult {
    method: 'umap';
    coordinates: Record<string, [number, number]>;
    buildTimeMs: number;
}

export function computeUmapLayout(
    paragraphIds: string[],
    embeddings: Map<string, Float32Array>,
    seed: number = 42
): Layout2DResult {
    const startTime = performance.now();

    const vectors: number[][] = [];
    const validIds: string[] = [];

    for (const id of paragraphIds) {
        const emb = embeddings.get(id);
        if (emb) {
            vectors.push(Array.from(emb));
            validIds.push(id);
        }
    }

    if (vectors.length < 2) {
        const coordinates: Record<string, [number, number]> = {};
        for (const id of paragraphIds) {
            coordinates[id] = [0, 0];
        }
        return { method: 'umap', coordinates, buildTimeMs: 0 };
    }

    let s = seed;
    const seededRandom = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };

    const umap = new UMAP({
        nNeighbors: Math.min(15, vectors.length - 1),
        minDist: 0.1,
        nComponents: 2,
        random: seededRandom,
    });

    const projected = umap.fit(vectors);

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const [x, y] of projected) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    const coordinates: Record<string, [number, number]> = {};
    for (let i = 0; i < validIds.length; i++) {
        const [x, y] = projected[i];
        coordinates[validIds[i]] = [
            ((x - minX) / rangeX) * 2 - 1,
            ((y - minY) / rangeY) * 2 - 1,
        ];
    }

    for (const id of paragraphIds) {
        if (!coordinates[id]) coordinates[id] = [0, 0];
    }

    return {
        method: 'umap',
        coordinates,
        buildTimeMs: performance.now() - startTime,
    };
}
