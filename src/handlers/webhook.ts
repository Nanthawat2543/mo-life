import { Request, Response } from "express";
import crypto from "crypto";
import { config } from "../config";
import {
  queryAllForDate,
  createTask,
  createProject,
  completeTask,
  archiveTask,
  updateTaskProperty,
  setTaskDateTime,
  getTaskTitle,
  moveTask,
} from "../services/notion";
import {
  replyMessage,
  textMessage,
  taskListFlex,
  helpText,
  homeQuickReply,
  editMenuQuickReply,
  deleteConfirmQuickReply,
  addDateQuickReply,
} from "../services/line";
import { askAI, parseIntent } from "../services/ai";
import { getSenderName } from "../services/line";
import {
  todayISO,
  tomorrowISO,
  endOfWeekISO,
  parseThaiDate,
  thaiDateLabel,
} from "../utils/date";
import { setSession, getPageId } from "../utils/session";
import { setState, getState, clearState } from "../utils/state";
import { getStoredTarget, setStoredTarget } from "../utils/targetStore";

/** Capture the push target (group preferred, else user) if none configured. */
function captureTarget(event: any): void {
  if (config.line.targetId) return; // explicit env target wins
  const src = event.source ?? {};
  const id = src.groupId || src.roomId || src.userId;
  if (id && getStoredTarget() !== id) {
    setStoredTarget(id);
    console.log(`[target] captured push target: ${id} (${src.type})`);
  }
}

// ─── Signature verification ──────────────────────────────────────

function verifySignature(body: string, signature: string): boolean {
  const hash = crypto
    .createHmac("SHA256", config.line.channelSecret)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// ─── Main handler ────────────────────────────────────────────────

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.headers["x-line-signature"] as string;
  if (!signature || !verifySignature(req.rawBody!, signature)) {
    res.status(401).send("Invalid signature");
    return;
  }

  // IMPORTANT: on serverless (Vercel) the function is frozen as soon as the
  // response is sent, so we must finish all async work (Notion + LINE replies)
  // BEFORE responding. Process events first, then return 200.
  const events = req.body?.events ?? [];
  for (const event of events) {
    try {
      captureTarget(event);
      if (event.type === "message" && event.message.type === "text") {
        await handleText(event);
      } else if (event.type === "postback") {
        await handlePostback(event);
      } else if (event.type === "follow") {
        await replyMessage(event.replyToken, [
          textMessage(
            "สวัสดีครับ น้องวินัยมาแล้ว 😎 ผู้ช่วยวินัยของบอสมอสกับบอสอร\nลองกดเมนูด้านล่าง หรือพิมพ์ 'ช่วยเหลือ' ดูวิธีใช้ได้เลยค่ะ",
            homeQuickReply()
          ),
        ]);
      }
    } catch (err) {
      console.error("[webhook] Event handling error:", err);
    }
  }

  res.status(200).send("OK");
}

// ─── Text router ─────────────────────────────────────────────────

async function handleText(event: any): Promise<void> {
  const text = event.message.text.trim();
  const userId = event.source.userId ?? "default";
  const reply = event.replyToken;

  // 1) Continue an in-progress guided flow if any
  const state = getState(userId);
  if (state) {
    await handleStatefulText(reply, userId, state, text);
    return;
  }

  // 2) Help
  if (/^(ช่วยเหลือ|help|วิธีใช้|เมนู)/i.test(text)) {
    await replyMessage(reply, [textMessage(helpText(), homeQuickReply())]);
    return;
  }

  // Diagnostic: show the captured push target id
  if (/^(ไอดี|myid|id)$/i.test(text)) {
    const target = config.line.targetId || getStoredTarget() || "(ยังไม่มี)";
    await replyMessage(reply, [
      textMessage(`🎯 ปลายทางแจ้งเตือนตอนนี้:\n${target}\n\nการแจ้งเตือนจะส่งมาที่นี่ค่ะ`),
    ]);
    return;
  }

  // 3) Lists
  if (/^วันนี้$/i.test(text)) {
    await sendTaskList(reply, userId, "📋 งานวันนี้", todayISO());
    return;
  }
  if (/^พรุ่งนี้$/i.test(text)) {
    await sendTaskList(reply, userId, "📋 งานพรุ่งนี้", tomorrowISO());
    return;
  }
  if (/^สัปดาห์นี้$/i.test(text)) {
    await sendTaskList(reply, userId, "📋 งานสัปดาห์นี้", todayISO(), endOfWeekISO());
    return;
  }

  // 4) Start guided add ("เพิ่มงาน" with no extra text → ask for title)
  if (/^(➕\s*)?เพิ่มงาน$/i.test(text)) {
    setState(userId, { mode: "add_title" });
    await replyMessage(reply, [
      textMessage("อยากเพิ่มงานอะไรคะ? พิมพ์ชื่องานมาได้เลย ✍️"),
    ]);
    return;
  }

  // 5a) Add to the Projects DB (งานธรรม / สถานธรรม). Accept many phrasings:
  // เพิ่มสถานธรรม, เพิ่มงานสถานธรรม, เพิ่มงานธรรม, เพิ่มงานวัด, เพิ่มโปรเจค, เพิ่มธรรมะ
  const addProjectMatch = text.match(
    /^เพิ่ม(?:งาน)?(?:สถานธรรม|ธรรมะ|งานธรรม|ธรรม|วัด|โปรเจค|โปรเจกต์|โปรเจ็ค)\s+(.+)/
  );
  if (addProjectMatch) {
    await handleQuickAdd(reply, addProjectMatch[1], "project");
    return;
  }

  // 5b) Quick add to personal Tasks ("เพิ่ม <title> <date/time>")
  const addMatch = text.match(/^เพิ่ม\s+(.+)/);
  if (addMatch) {
    await handleQuickAdd(reply, addMatch[1], "task");
    return;
  }

  // 5c) Move a task between databases ("ย้าย <index> สถานธรรม" / "ย้าย <index> ส่วนตัว")
  const moveMatch = text.match(/^ย้าย\s+(\d+)\s+(.+)/);
  if (moveMatch) {
    const idx = parseInt(moveMatch[1], 10);
    const dest = moveMatch[2];
    let target: "task" | "project" | null = null;
    if (/สถานธรรม|โปรเจค|โปรเจกต์|วัด|ธรรม/.test(dest)) target = "project";
    else if (/ส่วนตัว|ส่วนตว|task|tasks/i.test(dest)) target = "task";
    await moveByIndex(reply, userId, idx, target);
    return;
  }

  // 6) Text commands by index (still supported as a shortcut)
  const doneMatch = text.match(/^เสร็จ\s+(\d+)/);
  if (doneMatch) {
    await completeByIndex(reply, userId, parseInt(doneMatch[1], 10));
    return;
  }
  const delMatch = text.match(/^ลบ\s+(\d+)/);
  if (delMatch) {
    await deleteByIndex(reply, userId, parseInt(delMatch[1], 10));
    return;
  }
  const editMatch = text.match(/^แก้\s+(\d+)\s+(\S+)\s+(.+)/);
  if (editMatch) {
    await editByIndex(
      reply,
      userId,
      parseInt(editMatch[1], 10),
      editMatch[2],
      editMatch[3]
    );
    return;
  }

  // 7) AI-first: parse natural language into an intent and EXECUTE it for real.
  try {
    const senderName = await getSenderName(event);
    if (await handleWithAI(reply, userId, text, senderName)) return;
  } catch (err) {
    console.error("[webhook] AI handling error:", err);
  }

  await replyMessage(reply, [
    textMessage(
      'ไม่เข้าใจค่ะ 😅 ลองกดเมนูด้านล่าง หรือพิมพ์ "ช่วยเหลือ" นะคะ',
      homeQuickReply()
    ),
  ]);
}

// ─── AI-driven natural language → real Notion actions ────────────
async function handleWithAI(
  reply: string,
  userId: string,
  text: string,
  senderName: string | null
): Promise<boolean> {
  // Build context: sender, current time, today's tasks — so the AI resolves
  // relative dates, addresses the right person, and knows when to go dark mode.
  const today = todayISO();
  const todayItems = await queryAllForDate(today);
  const undone = todayItems.filter((t) => !t.done);
  const taskCtx =
    todayItems.length > 0
      ? todayItems
          .map(
            (t) =>
              `- ${t.dueTime ?? "ทั้งวัน"} ${t.title}${
                t.source === "project" ? " (สถานธรรม)" : ""
              }${t.done ? " [เสร็จแล้ว]" : " [ยังไม่เสร็จ]"}`
          )
          .join("\n")
      : "(วันนี้ยังไม่มีงาน)";
  const context =
    `ผู้ส่งตอนนี้: ${senderName ?? "ไม่ทราบชื่อ"}\n` +
    `เวลาตอนนี้: ${today} (${thaiDateLabel(today)})\n` +
    `จำนวนงานวันนี้ที่ยังไม่เสร็จ: ${undone.length}\n` +
    `งานวันนี้:\n${taskCtx}`;

  const intent = await parseIntent(text, context);
  if (!intent) {
    // AI unavailable → plain chat reply if possible, else give up (false).
    const chat = await askAI(text, context);
    if (chat) {
      await replyMessage(reply, [textMessage(chat, homeQuickReply())]);
      return true;
    }
    return false;
  }

  switch (intent.action) {
    case "add": {
      if (!intent.title) break;
      const date = intent.date || today;
      const time = intent.time || null;
      if (intent.database === "project") {
        await createProject({ title: intent.title, date, time });
      } else {
        await createTask({ title: intent.title, date, time });
      }
      const where =
        intent.database === "project"
          ? "🏛️ งานสถานธรรม"
          : "📌 งานส่วนตัว";
      const when = `${thaiDateLabel(date)}${time ? ` เวลา ${time} น.` : ""}`;
      await replyMessage(reply, [
        textMessage(
          `เพิ่มแล้วค่ะ ✅\n${where}\n• ${intent.title}\n📅 ${when}`,
          homeQuickReply()
        ),
      ]);
      return true;
    }

    case "list": {
      const r = intent.range ?? "today";
      if (r === "tomorrow")
        await sendTaskList(reply, userId, "📋 งานพรุ่งนี้", tomorrowISO());
      else if (r === "week")
        await sendTaskList(reply, userId, "📋 งานสัปดาห์นี้", today, endOfWeekISO());
      else await sendTaskList(reply, userId, "📋 งานวันนี้", today);
      return true;
    }

    case "complete":
    case "delete": {
      if (!intent.title) break;
      const found = await findByTitle(today, endOfWeekISO(), intent.title);
      if (found.length === 0) {
        await replyMessage(reply, [
          textMessage(
            `หาไม่เจองาน "${intent.title}" ค่ะ ลองพิมพ์ "วันนี้" ดูรายการนะคะ`,
            homeQuickReply()
          ),
        ]);
        return true;
      }
      if (found.length > 1) {
        setSession(userId, found.map((f) => f.id));
        await replyMessage(reply, [
          taskListFlex(`เจอหลายงานที่ตรงกับ "${intent.title}" — เลือกจากรายการนี้นะคะ`, found),
        ]);
        return true;
      }
      if (intent.action === "complete") {
        await completeTask(found[0].id);
        await replyMessage(reply, [
          textMessage(`เสร็จแล้ว! "${found[0].title}" เก่งมากค่ะ 🎉`, homeQuickReply()),
        ]);
      } else {
        await archiveTask(found[0].id);
        await replyMessage(reply, [
          textMessage(`ลบงาน "${found[0].title}" แล้วค่ะ 🗑️`, homeQuickReply()),
        ]);
      }
      return true;
    }

    case "move": {
      if (!intent.title) break;
      // Infer destination from the message if the AI didn't fill it.
      let dest = intent.database;
      if (!dest) {
        if (/สถานธรรม|โปรเจค|วัด|ธรรม/.test(text)) dest = "project";
        else if (/ส่วนตัว|task/i.test(text)) dest = "task";
      }
      if (!dest) {
        await replyMessage(reply, [
          textMessage(
            'ย้ายไปฐานไหนคะ? บอก "สถานธรรม" หรือ "ส่วนตัว" ด้วยนะคะ',
            homeQuickReply()
          ),
        ]);
        return true;
      }
      intent.database = dest;
      const found = await findByTitle(today, endOfWeekISO(), intent.title);
      if (found.length === 0) {
        await replyMessage(reply, [
          textMessage(
            `หาไม่เจองาน "${intent.title}" ค่ะ ลองพิมพ์ "สัปดาห์นี้" ดูรายการนะคะ`,
            homeQuickReply()
          ),
        ]);
        return true;
      }
      if (found.length > 1) {
        setSession(userId, found.map((f) => f.id));
        await replyMessage(reply, [
          taskListFlex(`เจอหลายงานที่ตรงกับ "${intent.title}" — บอกเลขที่จะย้ายนะคะ (เช่น "ย้าย 1 ${intent.database === "project" ? "สถานธรรม" : "ส่วนตัว"}")`, found),
        ]);
        return true;
      }
      const res = await moveTask(found[0].id, intent.database);
      const where = intent.database === "project" ? "🏛️ สถานธรรม (โปรเจค)" : "📌 งานส่วนตัว (Tasks)";
      await replyMessage(reply, [
        textMessage(
          res.moved
            ? `ย้าย "${res.title}" ไป ${where} แล้วค่ะ ✅`
            : `งาน "${res.title}" อยู่ในฐานนั้นอยู่แล้วค่ะ 😊`,
          homeQuickReply()
        ),
      ]);
      return true;
    }

    case "chat":
    default: {
      // Use the full-persona model for a richer น้องวินัย reply.
      const chat = await askAI(text, context);
      await replyMessage(reply, [
        textMessage(chat || intent.reply || "ว่าไงบอส 😎", homeQuickReply()),
      ]);
      return true;
    }
  }
  return false;
}

/** Find tasks in a date range whose title contains the query (both DBs). */
async function findByTitle(from: string, to: string, query: string) {
  const items = await queryAllForDate(from, to);
  const q = query.trim().toLowerCase();
  const exact = items.filter((i) => i.title.trim().toLowerCase() === q);
  if (exact.length) return exact;
  return items.filter(
    (i) => !i.done && i.title.toLowerCase().includes(q)
  );
}

// ─── Guided flow text steps ──────────────────────────────────────

async function handleStatefulText(
  reply: string,
  userId: string,
  state: ReturnType<typeof getState>,
  text: string
): Promise<void> {
  if (!state) return;

  // allow user to bail out
  if (/^(ยกเลิก|เลิก|cancel)$/i.test(text)) {
    clearState(userId);
    await replyMessage(reply, [textMessage("ยกเลิกแล้วค่ะ", homeQuickReply())]);
    return;
  }

  switch (state.mode) {
    case "add_title": {
      setState(userId, { mode: "add_date", title: text });
      await replyMessage(reply, [
        textMessage(
          `รับทราบ! งาน "${text}" ✅\nเลือกวันเวลาได้เลยค่ะ 👇`,
          addDateQuickReply()
        ),
      ]);
      return;
    }
    case "edit_title": {
      await updateTaskProperty(state.pageId, "title", text);
      clearState(userId);
      await replyMessage(reply, [
        textMessage(`เปลี่ยนชื่อเป็น "${text}" แล้วค่ะ ✏️✅`, homeQuickReply()),
      ]);
      return;
    }
    case "edit_location": {
      await updateTaskProperty(state.pageId, "location", text);
      clearState(userId);
      await replyMessage(reply, [
        textMessage(`เปลี่ยนสถานที่เป็น "${text}" แล้วค่ะ 📍✅`, homeQuickReply()),
      ]);
      return;
    }
    case "add_date": {
      // user typed a date/time in text instead of using the picker
      const { date, time } = parseThaiDate(text);
      await createTask({ title: state.title, date, time });
      clearState(userId);
      await confirmAdded(reply, state.title, date, time);
      return;
    }
  }
}

// ─── List ────────────────────────────────────────────────────────

async function sendTaskList(
  reply: string,
  userId: string,
  title: string,
  from: string,
  to?: string
): Promise<void> {
  const items = await queryAllForDate(from, to);
  if (items.length === 0) {
    await replyMessage(reply, [
      textMessage(`${title}\nไม่มีงานค่ะ 🎉`, homeQuickReply()),
    ]);
    return;
  }
  setSession(userId, items.map((i) => i.id));
  await replyMessage(reply, [taskListFlex(title, items)]);
}

// ─── Add ─────────────────────────────────────────────────────────

async function handleQuickAdd(
  reply: string,
  raw: string,
  target: "task" | "project" = "task"
): Promise<void> {
  const { date, time } = parseThaiDate(raw);
  const title = raw
    .replace(/วันนี้|พรุ่งนี้|มะรืน/g, "")
    .replace(/\d{4}-\d{2}-\d{2}/, "")
    .replace(/\d{1,2}\/\d{1,2}/, "")
    .replace(/\d{1,2}[:.]\d{2}/, "")
    .trim();

  if (!title) {
    await replyMessage(reply, [
      textMessage('กรุณาใส่ชื่องาน เช่น "เพิ่ม ออกกำลังกาย พรุ่งนี้ 18:00"'),
    ]);
    return;
  }
  if (target === "project") {
    await createProject({ title, date, time });
  } else {
    await createTask({ title, date, time });
  }
  await confirmAdded(reply, title, date, time, target);
}

async function confirmAdded(
  reply: string,
  title: string,
  date: string,
  time: string | null,
  target: "task" | "project" = "task"
): Promise<void> {
  const when = `${thaiDateLabel(date)}${time ? ` เวลา ${time} น.` : ""}`;
  const where = target === "project" ? "🏛️ งานธรรม (โปรเจค)" : "📌 งานส่วนตัว (Tasks)";
  await replyMessage(reply, [
    textMessage(`เพิ่มแล้ว ✅\n${where}\n• ${title}\n📅 ${when}`, homeQuickReply()),
  ]);
}

// ─── Index-based shortcuts ───────────────────────────────────────

async function completeByIndex(reply: string, userId: string, index: number) {
  const pageId = getPageId(userId, index);
  if (!pageId) return notFound(reply);
  await completeTask(pageId);
  await replyMessage(reply, [textMessage("เสร็จแล้ว! เก่งมากค่ะ 🎉", homeQuickReply())]);
}

async function deleteByIndex(reply: string, userId: string, index: number) {
  const pageId = getPageId(userId, index);
  if (!pageId) return notFound(reply);
  await archiveTask(pageId);
  await replyMessage(reply, [textMessage("ลบงานแล้วค่ะ 🗑️", homeQuickReply())]);
}

async function editByIndex(
  reply: string,
  userId: string,
  index: number,
  field: string,
  value: string
) {
  const pageId = getPageId(userId, index);
  if (!pageId) return notFound(reply);
  try {
    await updateTaskProperty(pageId, field, value);
    await replyMessage(reply, [textMessage("แก้ไขแล้วค่ะ ✏️✅", homeQuickReply())]);
  } catch (err: any) {
    await replyMessage(reply, [textMessage(`แก้ไขไม่สำเร็จค่ะ: ${err.message}`)]);
  }
}

async function moveByIndex(
  reply: string,
  userId: string,
  index: number,
  target: "task" | "project" | null
) {
  const pageId = getPageId(userId, index);
  if (!pageId) return notFound(reply);
  if (!target) {
    await replyMessage(reply, [
      textMessage(
        'ระบุปลายทางด้วยค่ะ เช่น "ย้าย 1 สถานธรรม" หรือ "ย้าย 1 ส่วนตัว"'
      ),
    ]);
    return;
  }
  try {
    const res = await moveTask(pageId, target);
    if (!res.moved) {
      await replyMessage(reply, [
        textMessage("งานนี้อยู่ในฐานนั้นอยู่แล้วค่ะ 😊", homeQuickReply()),
      ]);
      return;
    }
    const where = target === "project" ? "🏛️ สถานธรรม (โปรเจค)" : "📌 งานส่วนตัว (Tasks)";
    await replyMessage(reply, [
      textMessage(`ย้าย "${res.title}" ไป ${where} แล้วค่ะ ✅`, homeQuickReply()),
    ]);
  } catch (err: any) {
    await replyMessage(reply, [textMessage(`ย้ายไม่สำเร็จค่ะ: ${err.message}`)]);
  }
}

async function notFound(reply: string) {
  await replyMessage(reply, [
    textMessage('ไม่พบงานลำดับนี้ค่ะ ลองพิมพ์ "วันนี้" เพื่อดูรายการก่อนนะ', homeQuickReply()),
  ]);
}

// ─── Postback router ─────────────────────────────────────────────

async function handlePostback(event: any): Promise<void> {
  const data = new URLSearchParams(event.postback.data);
  const action = data.get("action");
  const pageId = data.get("id");
  const reply = event.replyToken;
  const userId = event.source.userId ?? "default";
  const picked = event.postback.params?.datetime as string | undefined; // "YYYY-MM-DDTHH:mm"
  const pickedDate = event.postback.params?.date as string | undefined; // "YYYY-MM-DD"

  switch (action) {
    case "complete":
      if (!pageId) return;
      await completeTask(pageId);
      await replyMessage(reply, [textMessage("เสร็จแล้ว! เก่งมากค่ะ 🎉", homeQuickReply())]);
      return;

    case "delconfirm": {
      if (!pageId) return;
      const title = await getTaskTitle(pageId);
      await replyMessage(reply, [
        textMessage(`แน่ใจนะคะว่าจะลบ "${title}"?`, deleteConfirmQuickReply(pageId)),
      ]);
      return;
    }

    case "delete":
      if (!pageId) return;
      await archiveTask(pageId);
      await replyMessage(reply, [textMessage("ลบงานแล้วค่ะ 🗑️", homeQuickReply())]);
      return;

    case "editmenu": {
      if (!pageId) return;
      const title = await getTaskTitle(pageId);
      await replyMessage(reply, [
        textMessage(`✏️ แก้ไข "${title}"\nอยากเปลี่ยนอะไรคะ?`, editMenuQuickReply(pageId)),
      ]);
      return;
    }

    case "editfield": {
      if (!pageId) return;
      const field = data.get("field");
      if (field === "title") {
        setState(userId, { mode: "edit_title", pageId });
        await replyMessage(reply, [textMessage("พิมพ์ชื่อใหม่มาได้เลยค่ะ ✍️")]);
      } else if (field === "location") {
        setState(userId, { mode: "edit_location", pageId });
        await replyMessage(reply, [textMessage("พิมพ์สถานที่ใหม่มาได้เลยค่ะ 📍")]);
      }
      return;
    }

    case "setstatus": {
      if (!pageId) return;
      const v = data.get("v") ?? "กำลังดำเนินงาน";
      await updateTaskProperty(pageId, "status", v);
      await replyMessage(reply, [textMessage(`อัปเดตสถานะเป็น "${v}" แล้วค่ะ ✅`, homeQuickReply())]);
      return;
    }

    case "setdatetime": {
      if (!pageId || !picked) return;
      const [d, t] = picked.split("T");
      await setTaskDateTime(pageId, d, t ?? null);
      await replyMessage(reply, [
        textMessage(`เปลี่ยนเป็น ${thaiDateLabel(d)}${t ? ` เวลา ${t} น.` : ""} แล้วค่ะ 📅✅`, homeQuickReply()),
      ]);
      return;
    }

    case "adddatetime":
    case "adddate": {
      const state = getState(userId);
      if (!state || state.mode !== "add_date") {
        await replyMessage(reply, [
          textMessage('เริ่มเพิ่มงานใหม่ก่อนนะคะ กดปุ่ม "➕ เพิ่มงาน"', homeQuickReply()),
        ]);
        return;
      }
      let date: string;
      let time: string | null = null;
      if (data.get("today") === "1") {
        date = todayISO();
      } else if (picked) {
        [date, time] = picked.split("T") as [string, string];
      } else if (pickedDate) {
        date = pickedDate;
      } else {
        date = todayISO();
      }
      await createTask({ title: state.title, date, time });
      clearState(userId);
      await confirmAdded(reply, state.title, date, time);
      return;
    }

    default:
      return;
  }
}
