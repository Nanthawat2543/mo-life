export interface TaskItem {
  id: string;
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  status: string;
  done: boolean;
  responsible: string | null;
  project: string | null;
  location: string | null;
  source: "task" | "project";
}
