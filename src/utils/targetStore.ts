import Database from "better-sqlite3";
import path from "path";

// Reuse the same DB file as the reminder store.
const db = new Database(path.join(process.cwd(), "reminders.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  )
`);

const getStmt = db.prepare("SELECT v FROM kv WHERE k = ?");
const setStmt = db.prepare(
  "INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v"
);

const TARGET_KEY = "push_target";

export function getStoredTarget(): string | null {
  const row = getStmt.get(TARGET_KEY) as { v: string } | undefined;
  return row?.v ?? null;
}

export function setStoredTarget(id: string): void {
  setStmt.run(TARGET_KEY, id);
}
