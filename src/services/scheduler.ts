import cron from "node-cron";
import { config } from "../config";
import {
  queryPendingTodayTasks,
  queryTimedTasksToday,
} from "./notion";
import {
  pushMessage,
  morningFlex,
  eveningFlex,
  reminderFlex,
} from "./line";
import { wasSent, markSent, cleanupOld } from "../utils/reminderStore";
import { now, todayISO, toLocalDateStr, toLocalTimeStr } from "../utils/date";

// ─── Job functions (reusable: cron + HTTP trigger) ───────────────

export async function runMorningBrief(): Promise<void> {
  const items = await queryPendingTodayTasks();
  await pushMessage([morningFlex(items)]);
  console.log(`[job] morning brief sent (${items.length} items)`);
}

export async function runEveningRecap(): Promise<void> {
  const pending = await queryPendingTodayTasks();
  await pushMessage([eveningFlex(pending)]);
  console.log(`[job] evening recap sent (${pending.length} pending)`);
}

/** Returns minutes from `nowLocal` (HH:mm) until `eventTime` (HH:mm), same day. */
function minutesUntil(nowHHmm: string, eventHHmm: string): number {
  const [nh, nm] = nowHHmm.split(":").map(Number);
  const [eh, em] = eventHHmm.split(":").map(Number);
  return eh * 60 + em - (nh * 60 + nm);
}

export async function runReminders(): Promise<void> {
  const today = todayISO();
  const nowLocalTime = toLocalTimeStr(now());
  const tasks = await queryTimedTasksToday();

  for (const task of tasks) {
    if (!task.dueTime || task.done) continue;
    const diffMin = minutesUntil(nowLocalTime, task.dueTime);
    if (diffMin > 0 && diffMin <= config.reminderLeadMinutes) {
      if (!wasSent(task.id, today)) {
        await pushMessage([reminderFlex(task, diffMin)]);
        markSent(task.id, today);
        console.log(`[job] reminder sent: ${task.title} (${diffMin} min)`);
      }
    }
  }

  // Daily cleanup of yesterday's dedup records
  const yest = new Date(now());
  yest.setUTCDate(yest.getUTCDate() - 1);
  cleanupOld(toLocalDateStr(yest));
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
