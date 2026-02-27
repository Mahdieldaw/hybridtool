// Pack/unpack utilities for Map<string, Float32Array> ↔ { buffer: ArrayBuffer, index: string[] }

/**
 * Pack a Map of ID → Float32Array into a single contiguous ArrayBuffer + ordered key list.
 * All vectors must have the same dimensionality.
 */
export function packEmbeddingMap(
  map: Map<string, Float32Array>,
  dimensions: number,
): { buffer: ArrayBuffer; index: string[] } {
  const index: string[] = [];
  const totalFloats = map.size * dimensions;
  const buffer = new ArrayBuffer(totalFloats * 4); // Float32 = 4 bytes
  const view = new Float32Array(buffer);

  let offset = 0;
  for (const [id, vec] of map) {
    if (vec.length !== dimensions) {
      throw new RangeError(`Embedding for ${id} has ${vec.length} dims, expected ${dimensions}`);
    }
    index.push(id);
    view.set(vec, offset);
    offset += dimensions;
  }

  return { buffer, index };
}

/**
 * Unpack a contiguous ArrayBuffer back into a Map of ID → Float32Array
 * using the ordered key list from packing.
 */
export function unpackEmbeddingMap(
  buffer: ArrayBuffer,
  index: string[],
  dimensions: number,
): Map<string, Float32Array> {
  const expectedBytes = index.length * dimensions * 4;
  if (buffer.byteLength < expectedBytes) {
    throw new Error(`unpackEmbeddingMap: buffer too small (${buffer.byteLength} bytes) for ${index.length}×${dimensions}`);
  }
  const view = new Float32Array(buffer);
  const map = new Map<string, Float32Array>();

  for (let i = 0; i < index.length; i++) {
    const start = i * dimensions;
    map.set(index[i], view.slice(start, start + dimensions));
  }

  return map;
}
