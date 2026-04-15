// Think mode utilities - consolidated from src/think/

export interface ComputeThinkFlagArgs {
  modeThinkButtonOn?: boolean;
  input?: string;
  inputFlags?: string[] | string | null;
}

// Small constants for Think-mode
export const AI_THINK_FLAG = 't';

// Compute boolean think flag from modeThinkButtonOn (boolean) and inputFlags (array/string)
export function computeThinkFlag({ modeThinkButtonOn = false, input = '', inputFlags }: ComputeThinkFlagArgs = {}): boolean {
  const flags: string[] =
    Array.isArray(inputFlags) && inputFlags.length
      ? inputFlags
      : typeof input === 'string'
        ? input.match(/\b\w\b/g) || []
        : [];
  return Boolean(modeThinkButtonOn) || flags.includes(AI_THINK_FLAG);
}
