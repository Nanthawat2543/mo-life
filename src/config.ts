import dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export const config = {
  notion: {
    token: required("NOTION_TOKEN"),
    tasksDbId: required("NOTION_TASKS_DB_ID"),
    projectsDbId: required("NOTION_PROJECTS_DB_ID"),
  },
  line: {
    channelAccessToken: required("LINE_CHANNEL_ACCESS_TOKEN"),
    channelSecret: required("LINE_CHANNEL_SECRET"),
    // Optional: if unset, the bot auto-captures the target (group or user)
    // the first time someone messages it or adds it to a group.
    targetId: process.env.LINE_TARGET_ID ?? "",
  },
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  liffId: process.env.LIFF_ID ?? "",
  timezone: process.env.TIMEZONE ?? "Asia/Bangkok",
  port: parseInt(process.env.PORT ?? "3000", 10),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "",
  cron: {
    morning: process.env.CRON_MORNING ?? "30 7 * * *",
    evening: process.env.CRON_EVENING ?? "0 21 * * *",
    reminder: process.env.CRON_REMINDER ?? "*/5 * * * *",
  },
  reminderLeadMinutes: parseInt(process.env.REMINDER_LEAD_MINUTES ?? "30", 10),
  // The reminder cron interval (minutes). Defines the stateless emission window.
  reminderStepMinutes: parseInt(process.env.REMINDER_STEP_MINUTES ?? "5", 10),
  // Shared secret protecting the HTTP cron-trigger endpoints (free hosting).
  cronSecret: process.env.CRON_SECRET ?? "",
};
