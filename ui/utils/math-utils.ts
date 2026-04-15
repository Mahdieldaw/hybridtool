/**
 * Math detection utilities - DEPENDENCY-FREE
 * This file contains only lightweight functions for detecting math syntax.
 * The heavy math rendering machinery (KaTeX, unified, etc.) is kept in
 * math-renderer.ts and is only loaded when math is actually detected.
 */

/**
 * Checks if the content contains math syntax ($...$ or $$...$$)
 * This is a fast, lightweight check with ZERO dependencies.
 */
export function containsMath(content: string): boolean {
  // Simple heuristic: check for $ delimiters
  // This is a fast check to decide if we should load the heavy math machinery
  return /\$\$[\s\S]+?\$\$/.test(content) || /\$[\s\S]+?\$/.test(content);
}

/**
 * Local utility to handle array safety without orphan helpers in the parent.
 */
export function safeArr<T = any>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * Pure math helper for Pearson Correlation Coefficient.
 */
export function pearsonR(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const n = xs.length;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (!Number.isFinite(den) || den <= 0) return null;
  return num / den;
}
