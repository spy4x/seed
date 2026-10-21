import { browserStorage } from "@spy4x/platform/browser/storage"
import { createSingleKeysSetting } from "@platform/shortcuts.ts"

/** The single-key shortcuts' switch of this device; on until turned off here. */
export const singleKeys = createSingleKeysSetting(browserStorage())

/** Whether the device has a fine pointer, so a keyboard is likely; read when asked. */
export function hasFinePointer(): boolean {
  return globalThis.matchMedia?.("(any-pointer: fine)").matches ?? true
}
