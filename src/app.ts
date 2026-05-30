import express from "express";
import { config } from "./config";
import { webhookHandler } from "./handlers/webhook";
import {
  runMorningBrief,
  runEveningRecap,
  runReminders,
} from "./services/scheduler";

// Extend Express Request to carry the raw body for LINE signature verification
declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

export const app = express();

// Capture raw body before JSON parsing (needed for LINE signature check)
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString("utf-8");
    },
  })
);

// ─── LINE webhook ────────────────────────────────────────────────
app.post("/line/webhook", webhookHandler);

// ─── HTTP cron triggers ───────────────────────────────────────────
// Accepts either ?key=CRON_SECRET (manual / external scheduler) or
// "Authorization: Bearer CRON_SECRET" (sent automatically by Vercel Cron
// when CRON_SECRET is configured as an env var).
function checkCronKey(req: express.Request, res: express.Response): boolean {
  if (!config.cronSecret) {
    res.status(503).send("CRON_SECRET not configured");
    return false;
  }
  const viaQuery = req.query.key === config.cronSecret;
  const viaHeader =
    req.headers.authorization === `Bearer ${config.cronSecret}`;
  if (!viaQuery && !viaHeader) {
    res.status(401).send("Unauthorized");
    return false;
  }
  return true;
}

app.get("/cron/morning", async (req, res) => {
  if (!checkCronKey(req, res)) return;
  try {
    await runMorningBrief();
    res.send("morning ok");
  } catch (e: any) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

app.get("/cron/evening", async (req, res) => {
  if (!checkCronKey(req, res)) return;
  try {
    await runEveningRecap();
    res.send("evening ok");
  } catch (e: any) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

app.get("/cron/reminder", async (req, res) => {
  if (!checkCronKey(req, res)) return;
  try {
    await runReminders();
    res.send("reminder ok");
  } catch (e: any) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

// ─── Health check / keep-alive ───────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "mo-life" });
});
