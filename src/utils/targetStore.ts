// Push-target store. Serverless-friendly: no filesystem.
// Source of truth is the LINE_TARGET_ID env var (set once the group/user id is
// known). A module-level cache also captures the id at runtime from incoming
// webhook events, which works while an instance stays warm.

let runtimeTarget: string | null = null;

export function getStoredTarget(): string | null {
  return runtimeTarget;
}

export function setStoredTarget(id: string): void {
  runtimeTarget = id;
}
