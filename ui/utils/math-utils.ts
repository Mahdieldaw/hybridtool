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
