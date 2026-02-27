/**
 * Deep-merge two artifacts: keeps existing (base) values where the patch has
 * nothing new, overwrites scalars, and recurses into nested objects.
 * Arrays are replaced wholesale only when the patch array is non-empty.
 */
export function mergeArtifacts<T>(
  base: T,
  patch: any,
  ctx?: { visited?: WeakSet<object>; depth?: number },
): any {
  const visited = ctx?.visited ?? new WeakSet<object>();
  const depth = ctx?.depth ?? 50;
  if (depth <= 0) return base;
  if (!patch || typeof patch !== "object") return base;
  if (!base || typeof base !== "object") return patch;
  if (visited.has(base as any) || visited.has(patch as any)) return base;
  visited.add(base as any);
  visited.add(patch as any);
  if (Array.isArray(base) || Array.isArray(patch)) {
    if (Array.isArray(patch) && patch.length > 0) return patch;
    return base;
  }
  const out: any = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) continue;
    const prev = out[k];
    if (prev && typeof prev === "object" && !Array.isArray(prev) && typeof v === "object" && !Array.isArray(v)) {
      out[k] = mergeArtifacts(prev, v, { visited, depth: depth - 1 });
    } else if (Array.isArray(v)) {
      out[k] = v.length > 0 ? v : prev;
    } else {
      out[k] = v;
    }
  }
  return out;
}
