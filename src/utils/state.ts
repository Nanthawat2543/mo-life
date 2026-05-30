// Lightweight per-user conversation state for guided add/edit flows.
// In-memory is fine: flows are short-lived and a restart just resets them.

export type PendingState =
  | { mode: "add_title" } // waiting for the user to type a new task title
  | { mode: "add_date"; title: string } // have title, waiting for date/time
  | { mode: "edit_title"; pageId: string } // waiting for new title text
  | { mode: "edit_location"; pageId: string }; // waiting for new location text

const states = new Map<string, PendingState>();

export function setState(userId: string, state: PendingState): void {
  states.set(userId, state);
}

export function getState(userId: string): PendingState | undefined {
  return states.get(userId);
}

export function clearState(userId: string): void {
  states.delete(userId);
}
