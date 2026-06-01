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
  // Cover BOTH databases so reminders fire for personal tasks AND สถานธรรม work.
  const [tasks, projects] = await Promise.all([
    queryTasks(today),
    queryProjects(today),
  ]);
  return [...tasks, ...projects].filter((t) => !t.done && t.dueTime);
}

// ─── CRUD ────────────────────────────────────────────────────────

export async function createTask(params: {
  title: string;
  date: string;
  time?: string | null;
  location?: string | null;
  responsible?: string | null;
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
  if (params.responsible) {
    properties["ผู้รับผิดชอบ"] = { select: { name: params.responsible } };
  }

  const page = await notion.pages.create({
    parent: { database_id: config.notion.tasksDbId },
    properties,
  });
  return page.id;
}

/** Create an entry in the Projects DB (งานธรรม / สถานธรรม). */
export async function createProject(params: {
  title: string;
  date: string;
  time?: string | null;
  location?: string | null;
  responsible?: string | null;
}): Promise<string> {
  const dateValue: any = { start: params.date };
  if (params.time) {
    dateValue.start = toNotionDateTime(params.date, params.time);
  }

  const properties: any = {
    "ชื่อโปรเจค": { title: [{ text: { content: params.title } }] },
    "วันที่": { date: dateValue },
    "สถานะ": { status: { name: "ยังไม่เริ่ม" } },
  };
  if (params.location) {
    properties["สถานที่"] = {
      rich_text: [{ text: { content: params.location } }],
    };
  }
  if (params.responsible) {
    properties["คนรับผิดชอบ"] = { multi_select: [{ name: params.responsible }] };
  }

  const page = await notion.pages.create({
    parent: { database_id: config.notion.projectsDbId },
    properties,
  });
  return page.id;
}

// ─── Schema-aware editing (works for BOTH databases) ─────────────
// The personal Tasks DB and the Projects (สถานธรรม) DB use different property
// names. We detect which DB a page belongs to and map field names accordingly.

interface DbSchema {
  kind: "task" | "project";
  title: string;
  date: string;
  status: string;
  location: string;
  doneCheckbox: string | null;
  inProgress: string; // status option name for "in progress"
  responsible: string; // property name for the assignee
  responsibleType: "select" | "multi_select";
}

const TASK_SCHEMA: DbSchema = {
  kind: "task",
  title: "Task",
  date: "Due Date",
  status: "Status",
  location: "Location",
  doneCheckbox: "เสร็จเรียบร้อย",
  inProgress: "กำลังดำเนินงาน",
  responsible: "ผู้รับผิดชอบ",
  responsibleType: "select",
};

const PROJECT_SCHEMA: DbSchema = {
  kind: "project",
  title: "ชื่อโปรเจค",
  date: "วันที่",
  status: "สถานะ",
  location: "สถานที่",
  doneCheckbox: null,
  inProgress: "กำลังทำ",
  responsible: "คนรับผิดชอบ",
  responsibleType: "multi_select",
};

function bare(id: string): string {
  return id.replace(/-/g, "");
}

/** Retrieve a page and return both its raw data and the matching schema. */
async function pageWithSchema(
  pageId: string
): Promise<{ page: any; schema: DbSchema }> {
  const page: any = await notion.pages.retrieve({ page_id: pageId });
  const parentDb = bare(page.parent?.database_id ?? "");
  const schema =
    parentDb === bare(config.notion.projectsDbId) ? PROJECT_SCHEMA : TASK_SCHEMA;
  return { page, schema };
}

/** Normalise a free-text status value to the option name valid for this DB. */
function normaliseStatus(value: string, schema: DbSchema): string {
  if (/เสร็จ/.test(value)) return "เสร็จแล้ว";
  if (/กำลัง/.test(value)) return schema.inProgress;
  if (/ยังไม่/.test(value)) return "ยังไม่เริ่ม";
  return value;
}

export async function completeTask(pageId: string): Promise<void> {
  const { schema } = await pageWithSchema(pageId);
  const properties: any = {
    [schema.status]: { status: { name: "เสร็จแล้ว" } },
  };
  if (schema.doneCheckbox) {
    properties[schema.doneCheckbox] = { checkbox: true };
  }
  await notion.pages.update({ page_id: pageId, properties });
}

export async function archiveTask(pageId: string): Promise<void> {
  // archived works the same for any database
  await notion.pages.update({ page_id: pageId, archived: true });
}

export async function updateTaskProperty(
  pageId: string,
  field: string,
  value: string
): Promise<void> {
  const { page, schema } = await pageWithSchema(pageId);
  const properties: any = {};

  switch (field) {
    case "title":
    case "ชื่อ":
      properties[schema.title] = { title: [{ text: { content: value } }] };
      break;
    case "date":
    case "วันที่":
      properties[schema.date] = { date: { start: value } };
      break;
    case "time":
    case "เวลา": {
      const existingDate =
        page.properties[schema.date]?.date?.start?.slice(0, 10) ?? todayISO();
      properties[schema.date] = {
        date: { start: toNotionDateTime(existingDate, value) },
      };
      break;
    }
    case "location":
    case "สถานที่":
      properties[schema.location] = {
        rich_text: [{ text: { content: value } }],
      };
      break;
    case "status":
    case "สถานะ":
      properties[schema.status] = {
        status: { name: normaliseStatus(value, schema) },
      };
      break;
    case "responsible":
    case "ผู้รับผิดชอบ":
    case "คนรับผิดชอบ":
      properties[schema.responsible] =
        schema.responsibleType === "multi_select"
          ? { multi_select: [{ name: value }] }
          : { select: { name: value } };
      break;
    default:
      throw new Error(`ไม่รู้จักฟิลด์: ${field}`);
  }

  await notion.pages.update({ page_id: pageId, properties });
}

/** Set the date/time to an exact value (used by the LINE datetime picker). */
export async function setTaskDateTime(
  pageId: string,
  date: string,
  time: string | null
): Promise<void> {
  const { schema } = await pageWithSchema(pageId);
  const start = time ? toNotionDateTime(date, time) : date;
  await notion.pages.update({
    page_id: pageId,
    properties: { [schema.date]: { date: { start } } },
  });
}

/** Fetch a single task's title (used to confirm before delete/edit). */
export async function getTaskTitle(pageId: string): Promise<string> {
  const { page, schema } = await pageWithSchema(pageId);
  return titleText(page.properties?.[schema.title]) || "(ไม่มีชื่อ)";
}

/**
 * Move a task to the other database. Notion can't re-parent a page across
 * databases (different property names), so we re-create it in the target DB
 * with the same title/date/time/location and archive the original.
 */
export async function moveTask(
  pageId: string,
  target: "task" | "project"
): Promise<{ moved: boolean; title: string; newId?: string }> {
  const { page, schema } = await pageWithSchema(pageId);
  const title = titleText(page.properties?.[schema.title]) || "(ไม่มีชื่อ)";

  // Already in the target DB → nothing to do.
  if (schema.kind === target) return { moved: false, title };

  const rawDate = page.properties?.[schema.date]?.date?.start ?? null;
  const { date, time } = splitNotionDate(rawDate);
  const location = richText(page.properties?.[schema.location]) || null;
  const useDate = date ?? todayISO();

  const newId =
    target === "project"
      ? await createProject({ title, date: useDate, time, location })
      : await createTask({ title, date: useDate, time, location });

  await notion.pages.update({ page_id: pageId, archived: true });
  return { moved: true, title, newId };
}
