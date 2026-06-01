import cron from "node-cron";
import { config } from "../config";
import {
  queryPendingTodayTasks,
  queryTasks,
  queryProjects,
} from "./notion";
import {
  pushMessage,
  morningFlex,
  eveningFlex,
  reminderFlex,
} from "./line";
import { askAI } from "./ai";
import { todayISO, addDaysISO, minutesUntilDateTime } from "../utils/date";

// ─── Job functions (reusable: cron + HTTP trigger) ───────────────

/** Ask น้องวินัย for a one-line headline; null-safe (falls back to default). */
async function vinaiLine(prompt: string, items: { title: string; dueTime: string | null }[]): Promise<string | undefined> {
  const list = items.length
    ? items.map((t) => `- ${t.dueTime ?? "ทั้งวัน"} ${t.title}`).join("\n")
    : "(ไม่มีงาน)";
  const line = await askAI(prompt, `งาน:\n${list}`);
  return line ? line.replace(/\n+/g, " ").slice(0, 200) : undefined;
}

export async function runMorningBrief(): Promise<void> {
  const items = await queryPendingTodayTasks();
  // A punchy power line for the top of the morning card.
  const power = await vinaiLine(
    "ขอ 'ประโยคปลุกพลัง' ตอนเช้าแบบน้องวินัย สั้นกระชับ 1 ประโยค ให้ฮึกเหิมมีวินัย พร้อมลุยทั้งวัน (สอดแทรกพลังบวก/ธรรมะได้) ห้ามเกิน 1 บรรทัด",
    items
  );
  await pushMessage([morningFlex(items, power)]);
  console.log(`[job] morning brief sent (${items.length} items)`);
}

export async function runEveningRecap(): Promise<void> {
  const pending = await queryPendingTodayTasks();
  const line = await vinaiLine(
    pending.length > 0
      ? `ตอนเย็นแล้วยังเหลือ ${pending.length} งานที่ไม่เสร็จ ดุแบบน้องวินัย DARK MODE tough-love + ธรรมะสั้นๆ เร่งให้รีบทำ 1-2 ประโยค`
      : "ตอนเย็น งานเสร็จหมดแล้ว ชมแบบน้องวินัย + อวยพรราตรีสวัสดิ์ สั้นๆ",
    pending
  );
  await pushMessage([eveningFlex(pending, line)]);
  console.log(`[job] evening recap sent (${pending.length} pending)`);
}

// Milestones (minutes before the event) for สถานธรรม / project work.
// 1 week → 1 hour → 30 min → 10 min → at the time.
const PROJECT_MILESTONES = [
  { m: 7 * 24 * 60, label: "🗓️ อีก 1 สัปดาห์" },
  { m: 60, label: "⏰ อีก 1 ชั่วโมง" },
  { m: 30, label: "⏰ อีก 30 นาที" },
  { m: 10, label: "⏰ อีก 10 นาที" },
  { m: 0, label: "🔔 ถึงเวลาแล้ว!" },
];

export async function runReminders(): Promise<void> {
  const step = config.reminderStepMinutes; // 5 — width of each emission window
  const lead = config.reminderLeadMinutes; // 30

  // ── Personal tasks (Tasks DB): nag every run within `lead` until done ──
  const today = todayISO();
  const tasks = (await queryTasks(today)).filter((t) => !t.done && t.dueTime);
  for (const t of tasks) {
    const diff = minutesUntilDateTime(t.dueDate!, t.dueTime!);
    if (!Number.isNaN(diff) && diff <= lead) {
      await pushMessage([reminderFlex(t, Math.round(diff))]);
      console.log(`[job] task nag: ${t.title} (${Math.round(diff)} min)`);
    }
  }

  // ── Projects (สถานธรรม): fire ONCE at each milestone, not nagging ──
  // Look ahead far enough to catch the 1-week milestone.
  const projects = (
    await queryProjects(today, addDaysISO(8))
  ).filter((p) => !p.done && p.dueTime);
  for (const p of projects) {
    const diff = minutesUntilDateTime(p.dueDate!, p.dueTime!);
    if (Number.isNaN(diff)) continue;
    // A milestone fires when diff is inside (m - step, m] — a single cron step,
    // so each milestone triggers about once with no database needed.
    const hit = PROJECT_MILESTONES.find(
      (ms) => diff > ms.m - step && diff <= ms.m
    );
    if (hit) {
      await pushMessage([reminderFlex(p, Math.round(diff), hit.label)]);
      console.log(`[job] project milestone: ${p.title} (${hit.label})`);
    }
  }
}

// ─── In-process cron (for always-on hosts) ───────────────────────

export function startScheduler(): void {
  if (process.env.DISABLE_INPROCESS_CRON === "1") {
    console.log("[scheduler] in-process cron disabled (using external trigger)");
    return;
  }

  const opts = { timezone: config.timezone };

  cron.schedule(config.cron.morning, () => {
    runMorningBrief().catch((e) => console.error("[cron] morning:", e));
  }, opts);

  cron.schedule(config.cron.reminder, () => {
    runReminders().catch((e) => console.error("[cron] reminder:", e));
  }, opts);

  cron.schedule(config.cron.evening, () => {
    runEveningRecap().catch((e) => console.error("[cron] evening:", e));
  }, opts);

  console.log(
    `[scheduler] crons set — morning ${config.cron.morning}, reminder ${config.cron.reminder}, evening ${config.cron.evening} (${config.timezone})`
  );
}
