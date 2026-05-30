import { Client } from "@notionhq/client";
import { config } from "../config";
import { TaskItem } from "../types";
import { todayISO, splitNotionDate, toNotionDateTime } from "../utils/date";

const notion = new Client({ auth: config.notion.token });

// ─── Helpers to read Notion properties ───────────────────────────

function prop(page: any, name: string) {
  return page.properties?.[name];
}

function titleText(p: any): string {
  return p?.title?.map((t: any) => t.plain_text).join("") ?? "";
}

function richText(p: any): string {
  return p?.rich_text?.map((t: any) => t.plain_text).join("") ?? "";
}

function selectName(p: any): string | null {
  return p?.select?.name ?? null;
}

function statusName(p: any): string {
  return p?.status?.name ?? "";
}

function checkbox(p: any): boolean {
  return p?.checkbox ?? false;
}

function dateStart(p: any): string | null {
  return p?.date?.start ?? null;
}

// ─── Query helpers ───────────────────────────────────────────────

export async function queryTasks(
  dateFrom: string,
  dateTo?: string
): Promise<TaskItem[]> {
  const dateFilter: any = dateTo
    ? {
        and: [
          { property: "Due Date", date: { on_or_after: dateFrom } },
          { property: "Due Date", date: { on_or_before: dateTo } },
        ],
      }
    : { property: "Due Date", date: { equals: dateFrom } };

  const res = await notion.databases.query({
    database_id: config.notion.tasksDbId,
    filter: dateFilter,
    sorts: [{ property: "Due Date", direction: "ascending" }],
  });

  return res.results.map((page: any) => {
    const { date: dueDate, time: dueTime } = splitNotionDate(
      dateStart(prop(page, "Due Date"))
    );
    return {
      id: page.id,
      title: titleText(prop(page, "Task")),
      dueDate,
      dueTime,
      status: statusName(prop(page, "Status")),
      done: checkbox(prop(page, "เสร็จเรียบร้อย")),
      responsible: selectName(prop(page, "ผู้รับผิดชอบ")),
      project: selectName(prop(page, "โปรเจค")),
      location: richText(prop(page, "Location")) || null,
      source: "task" as const,
    };
  });
}

export async function queryProjects(
  dateFrom: string,
  dateTo?: string
): Promise<TaskItem[]> {
  const dateFilter: any = dateTo
    ? {
        and: [
          { property: "วันที่", date: { on_or_after: dateFrom } },
          { property: "วันที่", date: { on_or_before: dateTo } },
        ],
      }
    : { property: "วันที่", date: { equals: dateFrom } };

  const res = await notion.databases.query({
    database_id: config.notion.projectsDbId,
    filter: dateFilter,
    sorts: [{ property: "วันที่", direction: "ascending" }],
  });

  return res.results.map((page: any) => {
    const { date: dueDate, time: dueTime } = splitNotionDate(
      dateStart(prop(page, "วันที่"))
    );
    return {
      id: page.id,
      title: titleText(prop(page, "ชื่อโปรเจค")),
      dueDate,
      dueTime,
      status: statusName(prop(page, "สถานะ")),
      done: statusName(prop(page, "สถานะ")) === "เสร็จแล้ว",
      responsible: (prop(page, "คนรับผิดชอบ")?.multi_select ?? [])
        .map((s: any) => s.name)
        .join(", ") || null,
      project: null,
      location: richText(prop(page, "สถานที่")) || null,
      source: "project" as const,
    };
  });
}

export async function queryAllForDate(
  dateFrom: string,
  dateTo?: string
): Promise<TaskItem[]> {
  const [tasks, projects] = await Promise.all([
    queryTasks(dateFrom, dateTo),
    queryProjects(dateFrom, dateTo),
  ]);
  return [...tasks, ...projects].sort((a, b) => {
    const ta = a.dueTime ?? "99:99";
    const tb = b.dueTime ?? "99:99";
    return ta.localeCompare(tb);
  });
}

export async function queryPendingTodayTasks(): Promise<TaskItem[]> {
  const today = todayISO();
  const all = await queryAllForDate(today);
  return all.filter((t) => !t.done);
}

export async function queryTimedTasksToday(): Promise<TaskItem[]> {
  const today = todayISO();
  const tasks = await queryTasks(today);
  return tasks.filter((t) => !t.done && t.dueTime);
}

// ─── CRUD ────────────────────────────────────────────────────────

export async function createTask(params: {
  title: string;
  date: string;
  time?: string | null;
  location?: string | null;
}): Promise<string> {
  const dateValue: any = { start: params.date };
  if (params.time) {
    dateValue.start = toNotionDateTime(params.date, params.time);
  }

  const properties: any = {
    Task: { title: [{ text: { content: params.title } }] },
    "Due Date": { date: dateValue },
    Status: { status: { name: "ยังไม่เริ่ม" } },
    "เสร็จเรียบร้อย": { checkbox: false },
  };
  if (params.location) {
    properties.Location = {
      rich_text: [{ text: { content: params.location } }],
    };
  }

  const page = await notion.pages.create({
    parent: { database_id: config.notion.tasksDbId },
    properties,
  });
  return page.id;
}

export async function completeTask(pageId: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "เสร็จเรียบร้อย": { checkbox: true },
      Status: { status: { name: "เสร็จแล้ว" } },
    },
  });
}

export async function archiveTask(pageId: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    archived: true,
  });
}

export async function updateTaskProperty(
  pageId: string,
  field: string,
  value: string
): Promise<void> {
  const properties: any = {};

  switch (field) {
    case "title":
    case "ชื่อ":
      properties.Task = { title: [{ text: { content: value } }] };
      break;
    case "date":
    case "วันที่": {
      const hasTime = value.includes("T");
      properties["Due Date"] = {
        date: { start: hasTime ? value : value },
      };
      break;
    }
    case "time":
    case "เวลา": {
      const page = await notion.pages.retrieve({ page_id: pageId });
      const existingDate =
        (page as any).properties["Due Date"]?.date?.start?.slice(0, 10) ??
        todayISO();
      properties["Due Date"] = {
        date: { start: toNotionDateTime(existingDate, value) },
      };
      break;
    }
    case "location":
    case "สถานที่":
      properties.Location = {
        rich_text: [{ text: { content: value } }],
      };
      break;
    case "status":
    case "สถานะ":
      properties.Status = { status: { name: value } };
      break;
    default:
      throw new Error(`ไม่รู้จักฟิลด์: ${field}`);
  }

  await notion.pages.update({ page_id: pageId, properties });
}

/** Set Due Date to an exact date + time (used by the LINE datetime picker). */
export async function setTaskDateTime(
  pageId: string,
  date: string,
  time: string | null
): Promise<void> {
  const start = time ? toNotionDateTime(date, time) : date;
  await notion.pages.update({
    page_id: pageId,
    properties: { "Due Date": { date: { start } } },
  });
}

/** Fetch a single task's title (used to confirm before delete/edit). */
export async function getTaskTitle(pageId: string): Promise<string> {
  const page: any = await notion.pages.retrieve({ page_id: pageId });
  return titleText(page.properties?.["Task"]) || "(ไม่มีชื่อ)";
}
