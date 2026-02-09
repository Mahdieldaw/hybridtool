import { AI_THINK_FLAG } from "./constants.js";

// Compute boolean think flag from modeThinkButtonOn (boolean) and inputFlags (array/string)
export function computeThinkFlag({
  modeThinkButtonOn = false,
  input = "",
  inputFlags = [],
} = {}) {
  const flags =
    Array.isArray(inputFlags) && inputFlags.length
      ? inputFlags
      : typeof input === "string"
        ? input.match(/\b\w\b/g) || []
        : [];
  return Boolean(modeThinkButtonOn) || flags.includes(AI_THINK_FLAG);
}
