/**
 * Normalizes a citation source order object or array into an ordered array of provider IDs.
 * 
 * Handles two shapes:
 * 1. { providerId: index } (Numeric values, e.g. { "gemini": 1, "claude": 2 })
 * 2. { index: providerId } (Numeric keys, e.g. { "1": "gemini", "2": "claude" })
 * 
 * @param {object|null} rawCitationOrder - The raw citation order object from mapping meta.
 * @returns {string[]} Array of provider IDs in ascending order of their index.
 */
export function normalizeCitationSourceOrder(rawCitationOrder) {
    const normalizedCitationOrder = {}; // providerId -> numericIndex

    if (rawCitationOrder && typeof rawCitationOrder === 'object') {
        const entries = Object.entries(rawCitationOrder);
        if (entries.length > 0) {
            const [firstKey, firstVal] = entries[0];
            // If values are numbers AND key is not numeric, treat as provider -> index
            const isProviderToIndex = typeof firstVal === 'number' && Number.isFinite(firstVal) && isNaN(Number(firstKey));

            if (isProviderToIndex) {
                // Start with what we have, but filter for valid numbers
                Object.entries(rawCitationOrder).forEach(([k, v]) => {
                    if (typeof v === 'number' && Number.isFinite(v)) {
                        normalizedCitationOrder[k] = v;
                    }
                });
            } else {
                // Treat as index -> provider and invert
                entries.forEach(([k, v]) => {
                    if (v && typeof v === 'string') {
                        const index = Number(k);
                        if (Number.isFinite(index)) {
                            normalizedCitationOrder[v] = index;
                        } else {
                            // console.warn(`[CitationUtils] Invalid citation index '${k}' for provider '${v}'. Skipping.`);
                        }
                    }
                });
            }
        }
    }

    // Return sorted array of provider IDs
    return Object.entries(normalizedCitationOrder)
        .sort(([, a], [, b]) => (a || 0) - (b || 0))
        .map(([providerId]) => providerId);
}
