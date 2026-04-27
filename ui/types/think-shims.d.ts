// ui/types/think-shims.d.ts
declare module "../src/think/lib/think/computeThinkFlag.js" {
  export interface ComputeThinkFlagArgs {
    modeThinkButtonOn?: boolean;
    input?: string;
    inputFlags?: string[] | string | null;
  }
  export function computeThinkFlag(args?: ComputeThinkFlagArgs): boolean;
}

declare module "../src/think/lib/think/constants.js" {
  export const AI_THINK_FLAG: string;
  export const O1_TOOL_NAME: string;
}
