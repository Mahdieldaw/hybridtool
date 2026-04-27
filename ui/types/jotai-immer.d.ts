declare module "jotai/immer" {
  import type { WritableAtom } from "jotai";
  import type { Draft } from "immer";
  /**
   * Minimal type declaration for atomWithImmer used in this project.
   * This returns an Atom whose value is of the provided type and which
   * supports Immer-style setters when used with Jotai.
   */
  export function atomWithImmer<Value = unknown>(
    initialValue: Value,
  ): WritableAtom<Value, [Value | ((draft: Draft<Value>) => void)], void>;
}
