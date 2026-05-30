// Maps userId -> ordered list of Notion page IDs from the last query.
// This lets users refer to tasks by index number (e.g. "เสร็จ 2").
const sessions = new Map<string, string[]>();

export function setSession(userId: string, pageIds: string[]): void {
  sessions.set(userId, pageIds);
}

export function getPageId(userId: string, index: number): string | null {
  const list = sessions.get(userId);
  if (!list || index < 1 || index > list.length) return null;
  return list[index - 1];
}
