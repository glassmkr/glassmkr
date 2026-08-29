// Opt-in capabilities on an account API key.
//
// Distinct from `scope` (read < write < admin), which is a hierarchy, and
// deliberately NOT part of it. Permanently destroying a server and its metrics
// is not "more admin"; it is a different kind of authority. Folding it into the
// ladder would hand it to every admin key that already exists, which is the one
// outcome that must not happen when this ships.
//
// So: a key holds a capability only if it was asked for at creation. Migration
// 041 defaults the column to '[]', so every key that predates this holds none.
//
// See also the two operations this exists to separate:
//   DELETE /api/v1/servers/{id}           soft, restorable, write scope
//   DELETE /api/v1/trashed-servers/{id}   permanent, this capability + reauth

export const CAPABILITIES = ["servers:purge"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(v: unknown): v is Capability {
  return typeof v === "string" && (CAPABILITIES as readonly string[]).includes(v);
}

/** Parse the jsonb column into a validated list, ignoring anything unrecognised. */
export function parseCapabilities(raw: unknown): Capability[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isCapability);
}

/**
 * Whether a principal may exercise a capability.
 *
 * Sessions are NOT waved through here, which differs from how `requireScopeLevel`
 * treats them. That helper lets a browser session pass because the UI is the
 * authority for human-driven traffic and every scoped endpoint has a UI path.
 * Purge has no UI path: the dashboard's trash offers restore, not destroy. A
 * session reaching a purge endpoint therefore means something built a request
 * the interface cannot produce, and the right answer is no.
 */
export function principalHasCapability(
  principal: { authKind?: string; kind?: string; capabilities?: Capability[] | null },
  capability: Capability,
): boolean {
  return (principal.capabilities ?? []).includes(capability);
}
