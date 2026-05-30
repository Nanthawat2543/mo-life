import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(process.cwd(), "reminders.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS sent_reminders (
    page_id TEXT NOT NULL,
    remind_date TEXT NOT NULL,
    PRIMARY KEY (page_id, remind_date)
  )
`);

const insertStmt = db.prepare(
  "INSERT OR IGNORE INTO sent_reminders (page_id, remind_date) VALUES (?, ?)"
);
const checkStmt = db.prepare(
  "SELECT 1 FROM sent_reminders WHERE page_id = ? AND remind_date = ?"
);
const cleanupStmt = db.prepare(
  "DELETE FROM sent_reminders WHERE remind_date < ?"
);

export function wasSent(pageId: string, date: string): boolean {
  return !!checkStmt.get(pageId, date);
}

export function markSent(pageId: string, date: string): void {
  insertStmt.run(pageId, date);
}

export function cleanupOld(beforeDate: string): void {
  cleanupStmt.run(beforeDate);
}
