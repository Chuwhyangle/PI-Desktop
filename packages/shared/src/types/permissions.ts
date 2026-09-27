/** Shared public types grouped by the owning application domain. */
export type Risk = "low" | "medium" | "high";
export type PermissionDecision = "allow-once" | "allow-session" | "deny";
/** Permission mode (D115): how high-risk tool calls are approved.
 * `inherit` (sessions only) falls back to the global default. */
export const PERMISSION_MODES = ["inherit", "ask", "accept-edits", "auto"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
/** Global default: `inherit` is not meaningful at the settings level. */
export type GlobalPermissionMode = Exclude<PermissionMode, "inherit">;

/**
 * Permission mode used when neither the session override nor the global
 * setting names one — the last link of the D115 resolution chain
 * (`session.permissionMode` -> `defaultPermissionMode` -> this).
 *
 * Fork divergence: upstream falls back to `ask`, so every new session asks
 * for approval. This fork falls back to `auto`, so a new session runs
 * unattended; the user can still pin `ask` in Settings, and the Plan/Goal
 * contract modes keep their hard deny regardless of this value.
 */
export const FALLBACK_PERMISSION_MODE: GlobalPermissionMode = "auto";

export function isGlobalPermissionMode(
  value: unknown,
): value is GlobalPermissionMode {
  return value === "ask" || value === "accept-edits" || value === "auto";
}

export function normalizeGlobalPermissionMode(
  value: unknown,
  fallback: GlobalPermissionMode = FALLBACK_PERMISSION_MODE,
): GlobalPermissionMode {
  return isGlobalPermissionMode(value) ? value : fallback;
}
