import { messagingApi } from "@line/bot-sdk";
import { config } from "../config";
import { TaskItem } from "../types";
import { thaiDateLabel } from "../utils/date";
import { getStoredTarget } from "../utils/targetStore";

type FlexBubble = messagingApi.FlexBubble;
type FlexMessage = messagingApi.FlexMessage;
type FlexComponent = messagingApi.FlexComponent;
type Message = messagingApi.Message;
type QuickReplyItem = messagingApi.QuickReplyItem;

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.line.channelAccessToken,
});

// ─── Low-level send ──────────────────────────────────────────────

export async function pushMessage(messages: Message[]): Promise<void> {
  const to = config.line.targetId || getStoredTarget();
  if (!to) {
    console.warn(
      "[push] No target set. Send a message to the bot (or add it to a group) once so it can capture the push target."
    );
    return;
  }
  await client.pushMessage({ to, messages });
}

export async function replyMessage(
  replyToken: string,
  messages: Message[]
): Promise<void> {
  await client.replyMessage({ replyToken, messages });
}

/** Best-effort: get the sender's LINE display name (group or 1:1). */
export async function getSenderName(event: any): Promise<string | null> {
  try {
    const src = event.source ?? {};
    const userId = src.userId;
    if (!userId) return null;
    let profile: any;
    if (src.type === "group" && src.groupId) {
      profile = await client.getGroupMemberProfile(src.groupId, userId);
    } else if (src.type === "room" && src.roomId) {
      profile = await client.getRoomMemberProfile(src.roomId, userId);
    } else {
      profile = await client.getProfile(userId);
    }
    return profile?.displayName ?? null;
  } catch (err) {
    console.warn("[line] getSenderName failed:", err);
    return null;
  }
}

export function textMessage(text: string, quickReply?: QuickReplyItem[]): Message {
  const msg: any = { type: "text", text };
  if (quickReply && quickReply.length) {
    msg.quickReply = { items: quickReply };
  }
  return msg;
}

// ─── Brand colors ────────────────────────────────────────────────
const GREEN = "#06C755";
const DARK = "#333333";
const GREY = "#888888";

// ─── Quick reply: the "home" actions, attached to most replies ───
export function homeQuickReply(): QuickReplyItem[] {
  return [
    qrText("📋 วันนี้", "วันนี้"),
    qrText("📅 พรุ่งนี้", "พรุ่งนี้"),
    qrText("🗓️ สัปดาห์นี้", "สัปดาห์นี้"),
    qrText("➕ เพิ่มงาน", "เพิ่มงาน"),
    qrText("❓ ช่วยเหลือ", "ช่วยเหลือ"),
  ];
}

function qrText(label: string, text: string): QuickReplyItem {
  return {
    type: "action",
    action: { type: "message", label, text },
  };
}

function qrPostback(label: string, data: string, displayText?: string): QuickReplyItem {
  return {
    type: "action",
    action: { type: "postback", label, data, displayText: displayText ?? label },
  };
}

// ─── A single task card (carousel bubble) with action buttons ────

function taskBubble(item: TaskItem, index: number): FlexBubble {
  const timeLabel = item.dueTime ? `🕐 ${item.dueTime} น.` : "🕐 ทั้งวัน";
  const statusEmoji = item.done ? "✅ เสร็จแล้ว" : `⏳ ${item.status || "ยังไม่เริ่ม"}`;
  const sourceTag = item.source === "project" ? "🏛️ งานธรรม" : "📌 งานส่วนตัว";

  const info: FlexComponent[] = [
    {
      type: "text",
      text: `${index}. ${item.title}`,
      weight: "bold",
      size: "md",
      wrap: true,
      color: DARK,
    },
    {
      type: "box",
      layout: "baseline",
      margin: "md",
      contents: [
        { type: "text", text: timeLabel, size: "sm", color: GREY, flex: 0 },
      ],
    },
    {
      type: "text",
      text: statusEmoji,
      size: "sm",
      color: item.done ? GREEN : "#E67E22",
      margin: "sm",
    },
  ];

  if (item.location) {
    info.push({
      type: "text",
      text: `📍 ${item.location}`,
      size: "xs",
      color: GREY,
      margin: "sm",
      wrap: true,
    });
  }
  info.push({
    type: "text",
    text: sourceTag,
    size: "xs",
    color: GREY,
    margin: "sm",
  });

  return {
    type: "bubble",
    size: "kilo",
    body: { type: "box", layout: "vertical", spacing: "sm", contents: info },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "xs",
      contents: [
        {
          type: "button",
          style: "primary",
          color: GREEN,
          height: "sm",
          action: {
            type: "postback",
            label: "✅ เสร็จแล้ว",
            data: `action=complete&id=${item.id}`,
            displayText: `เสร็จงาน: ${item.title}`,
          },
        },
        {
          type: "box",
          layout: "horizontal",
          spacing: "xs",
          contents: [
            {
              type: "button",
              style: "secondary",
              height: "sm",
              action: {
                type: "postback",
                label: "✏️ แก้ไข",
                data: `action=editmenu&id=${item.id}`,
                displayText: `แก้ไข: ${item.title}`,
              },
            },
            {
              type: "button",
              style: "secondary",
              height: "sm",
              action: {
                type: "postback",
                label: "🗑️ ลบ",
                data: `action=delconfirm&id=${item.id}`,
                displayText: `ลบ: ${item.title}`,
              },
            },
          ],
        },
      ],
    },
  };
}

export function taskListFlex(title: string, items: TaskItem[]): FlexMessage {
  const bubbles = items.slice(0, 12).map((item, i) => taskBubble(item, i + 1));
  return {
    type: "flex",
    altText: `${title} (${items.length} งาน)`,
    contents: { type: "carousel", contents: bubbles },
  };
}

// ─── Notification Flex (morning / evening / reminder) ────────────

function summaryRow(item: TaskItem, index: number): FlexComponent {
  const time = item.dueTime ?? "ทั้งวัน";
  const tag = item.source === "project" ? "🏛️" : "📌";
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    margin: "md",
    contents: [
      {
        type: "text",
        text: time,
        size: "sm",
        color: GREEN,
        weight: "bold",
        flex: 2,
      },
      {
        type: "text",
        text: `${tag} ${item.title}`,
        size: "sm",
        color: DARK,
        flex: 5,
        wrap: true,
      },
    ],
  };
}

function notificationBubble(
  headerEmoji: string,
  headerText: string,
  subText: string,
  items: TaskItem[],
  footerText: string
): FlexBubble {
  const body: FlexComponent[] = [
    {
      type: "text",
      text: `${headerEmoji} ${headerText}`,
      weight: "bold",
      size: "lg",
      color: "#FFFFFF",
    },
  ];

  const rows: FlexComponent[] =
    items.length > 0
      ? items.slice(0, 15).map((it, i) => summaryRow(it, i + 1))
      : [
          {
            type: "text",
            text: subText,
            size: "sm",
            color: DARK,
            margin: "lg",
            wrap: true,
          },
        ];

  return {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: GREEN,
      paddingAll: "16px",
      contents: body,
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: rows,
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: footerText, size: "sm", color: GREY, wrap: true },
      ],
    },
  };
}

export function morningFlex(items: TaskItem[]): FlexMessage {
  const bubble = notificationBubble(
    "🌅",
    "ตารางวันนี้",
    "วันนี้ไม่มีงานในตาราง พักผ่อนด้วยกันนะ 💕",
    items,
    items.length > 0
      ? "สู้ๆ นะ ทำไปด้วยกัน! 💪✨ กดดูรายละเอียดพิมพ์ 'วันนี้'"
      : "มีเวลาว่างก็ทำสิ่งดีๆ ร่วมกันนะ 🌷"
  );
  return {
    type: "flex",
    altText: `🌅 ตารางวันนี้ (${items.length} งาน)`,
    contents: bubble,
  };
}

export function eveningFlex(pending: TaskItem[]): FlexMessage {
  const bubble = notificationBubble(
    "🌙",
    "สรุปตอนเย็น",
    "เก่งมากค่ะ! วันนี้ทำงานเสร็จหมดเลย 🎉",
    pending,
    pending.length > 0
      ? "ไม่เป็นไรนะ พรุ่งนี้ค่อยทำต่อก็ได้ ดูแลสุขภาพด้วย 🌟"
      : "พักผ่อนให้สบายนะ ราตรีสวัสดิ์ 💕"
  );
  return {
    type: "flex",
    altText: `🌙 สรุปตอนเย็น (เหลือ ${pending.length} งาน)`,
    contents: bubble,
  };
}

export function reminderFlex(
  task: TaskItem,
  leadMin: number,
  labelOverride?: string
): FlexMessage {
  // leadMin > 0: upcoming; <= 0: due now / overdue (nag mode)
  const headline =
    labelOverride ?? (leadMin > 0 ? `⏰ อีก ${leadMin} นาที` : "⏰ ถึงเวลาแล้ว!");
  const contents: FlexComponent[] = [
    {
      type: "text",
      text: headline,
      weight: "bold",
      size: "lg",
      color: "#FFFFFF",
    },
  ];

  const bodyRows: FlexComponent[] = [
    {
      type: "text",
      text: task.title,
      weight: "bold",
      size: "xl",
      color: DARK,
      wrap: true,
    },
    {
      type: "box",
      layout: "baseline",
      margin: "md",
      contents: [
        { type: "text", text: `🕐 ${task.dueTime} น.`, size: "md", color: GREEN, weight: "bold" },
      ],
    },
  ];
  if (task.location) {
    bodyRows.push({
      type: "text",
      text: `📍 ${task.location}`,
      size: "sm",
      color: GREY,
      margin: "sm",
      wrap: true,
    });
  }
  bodyRows.push({
    type: "text",
    text:
      leadMin > 0
        ? "ไปด้วยกันนะ 💕"
        : "กดปุ่ม ✅ ด้านล่างเพื่อหยุดเตือนนะ 💕",
    size: "sm",
    color: "#E67E22",
    margin: "lg",
    wrap: true,
  });

  const bubble: FlexBubble = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#E67E22",
      paddingAll: "16px",
      contents,
    },
    body: { type: "box", layout: "vertical", contents: bodyRows },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          color: GREEN,
          height: "sm",
          action: {
            type: "postback",
            label: "✅ ทำเสร็จแล้ว",
            data: `action=complete&id=${task.id}`,
            displayText: `เสร็จงาน: ${task.title}`,
          },
        },
      ],
    },
  };

  return {
    type: "flex",
    altText: `⏰ อีก ${leadMin} นาที: ${task.title} ${task.dueTime} น.`,
    contents: bubble,
  };
}

// ─── Edit menu (quick reply) ─────────────────────────────────────

export function editMenuQuickReply(pageId: string): QuickReplyItem[] {
  return [
    qrPostback("✏️ ชื่อ", `action=editfield&field=title&id=${pageId}`, "เปลี่ยนชื่อ"),
    {
      type: "action",
      action: {
        type: "datetimepicker",
        label: "📅 วันเวลา",
        data: `action=setdatetime&id=${pageId}`,
        mode: "datetime",
      },
    },
    qrPostback("📍 สถานที่", `action=editfield&field=location&id=${pageId}`, "เปลี่ยนสถานที่"),
    qrPostback("🔵 กำลังทำ", `action=setstatus&v=กำลังดำเนินงาน&id=${pageId}`, "กำลังดำเนินงาน"),
    qrPostback("✅ เสร็จแล้ว", `action=complete&id=${pageId}`, "ทำเสร็จ"),
  ];
}

// ─── Delete confirm (quick reply) ────────────────────────────────

export function deleteConfirmQuickReply(pageId: string): QuickReplyItem[] {
  return [
    qrPostback("🗑️ ยืนยันลบ", `action=delete&id=${pageId}`, "ยืนยันลบ"),
    qrText("❌ ยกเลิก", "วันนี้"),
  ];
}

// ─── Add flow: date picker quick reply ───────────────────────────

export function addDateQuickReply(): QuickReplyItem[] {
  return [
    {
      type: "action",
      action: {
        type: "datetimepicker",
        label: "📅 เลือกวันเวลา",
        data: "action=adddatetime",
        mode: "datetime",
      },
    },
    {
      type: "action",
      action: {
        type: "datetimepicker",
        label: "🗓️ เลือกเฉพาะวัน",
        data: "action=adddate",
        mode: "date",
      },
    },
    qrPostback("📌 วันนี้ทั้งวัน", "action=adddate&today=1", "วันนี้"),
  ];
}

// ─── Help ────────────────────────────────────────────────────────

export function helpText(): string {
  return [
    "📖 น้องวินัย — วิธีใช้งาน",
    "",
    "ทำได้ทั้งกดปุ่มและพิมพ์ค่ะ 😊",
    "",
    "📋 ดูงาน — กดเมนูล่าง หรือพิมพ์:",
    "  วันนี้ / พรุ่งนี้ / สัปดาห์นี้",
    "",
    "➕ เพิ่มงานส่วนตัว (Tasks):",
    "  เพิ่ม เอาผ้าไปอบ วันนี้ 18:00",
    "",
    "🏛️ เพิ่มงานธรรม/สถานธรรม (โปรเจค):",
    "  เพิ่มงานธรรม ประชุมธรรม พรุ่งนี้ 09:00",
    "  (ขึ้นต้นด้วย 'เพิ่มงานธรรม' = เข้าฐานโปรเจค)",
    "",
    "✅ ทำเสร็จ / ✏️ แก้ไข / 🗑️ ลบ",
    "  กดปุ่มบนการ์ดงานแต่ละใบได้เลย",
    "",
    "⏰ ถ้ามีเวลางาน บอทจะเตือนซ้ำทุก 5 นาที",
    "  จนกว่าจะกดปุ่ม ✅ เสร็จ",
    "",
    "ทุกอย่างทำผ่าน LINE ได้หมดเลยค่ะ 💕",
  ].join("\n");
}
