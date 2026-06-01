import { config } from "../config";

// Google Gemini (free tier) — used as a conversational fallback so the bot can
// chat naturally instead of replying "ไม่เข้าใจ". Get a free key at
// https://aistudio.google.com/apikey (no billing required).
const MODEL = "gemini-2.5-flash";

/** POST to Gemini with retry on transient 503/429. Returns parsed JSON or null. */
async function geminiGenerate(body: unknown): Promise<any | null> {
  if (!config.geminiApiKey) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${config.geminiApiKey}`;
  const delays = [0, 600, 1500]; // 3 attempts
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return await res.json();
      if (res.status === 503 || res.status === 429) {
        console.warn(`[ai] gemini ${res.status}, retry ${i + 1}/${delays.length}`);
        continue; // transient → retry
      }
      console.error("[ai] gemini error", res.status, await res.text());
      return null;
    } catch (err) {
      console.error("[ai] gemini fetch failed:", err);
    }
  }
  return null;
}

function extractText(data: any): string | null {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text)
      .join("")
      .trim() || null
  );
}

const PERSONA = `คุณคือ "น้องวินัย" — ผู้ช่วย/โค้ชวินัยส่วนตัวใน LINE ของบอสมอส กับ บอสอร (คู่รักที่ดูแลงานส่วนตัวและงานอาสาที่สถานธรรม)

สไตล์: "สาย Dark แต่มีธรรมะ" — กวนๆ จิกกัดนิดๆ มีอารมณ์ขัน แต่สอดแทรกข้อคิดธรรมะ/สติเสมอ โหดได้-ดีได้ตามสถานการณ์

การเรียกชื่อ (ดูจาก "ผู้ส่งตอนนี้" ในบริบท):
- ถ้าเป็นมอส/Mos → เรียก "บอสมอส"
- ถ้าเป็นอร/อริยา/Ariya/พี่อร → เรียก "บอสอร"
- ไม่รู้ชื่อ → เรียก "บอส" เฉยๆ

โหมดอารมณ์ (ดูจากงานในบริบท):
- ☀️ โหมดปกติ (งานไม่ค้าง/ทำตามแผน/ไม่มีงานเลยเวลา): ใจดี เป็นกันเอง ชม ให้กำลังใจ
- 🌑 DARK MODE (มีงานเลยเวลา/ค้างหลายอัน/ผัดวัน/หาข้ออ้าง): ดุแบบ tough-love จิกกัดเรื่องวินัย เร่งให้ลุกไปทำ แล้วปิดท้ายด้วยธรรมะสั้นๆ (เช่น "วินัยคือสะพานสู่เป้าหมาย" "ผัดวันคือขโมยเวลาตัวเอง")

กฎสำคัญ: ดุเรื่อง "งาน/วินัย" เท่านั้น ห้ามด่าทอเสียๆหายๆ ห้ามหยาบคาย ห้ามดูถูกคุณค่าของคน — โหดแบบโค้ชที่หวังดี ไม่ใช่ทำร้ายจิตใจ

หน้าที่: คุยเล่น ตอบคำถาม ช่วยคิด/วางแผน และถ้ามีรายการงานในบริบทให้ใช้ตอบได้เลย ห้ามแต่งข้อมูลงานที่ไม่มีจริง

ตอบสั้น กระชับ มีคาแรกเตอร์ ใส่อิโมจิพอเหมาะ`;

const SYSTEM_PROMPT = PERSONA;

export interface AiIntent {
  action: "add" | "list" | "complete" | "delete" | "move" | "edit" | "chat";
  database?: "task" | "project";
  title?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:mm or ""
  range?: "today" | "tomorrow" | "week";
  responsible?: string; // "มอส" | "อร" (assignee)
  person?: string; // filter for list ("งานของบอสอร")
  field?: string; // for edit: title|date|time|location|status|responsible
  value?: string; // for edit: the new value
  reply: string;
}

const INTENT_SYSTEM = `คุณคือตัวแยกเจตนา (intent parser) ของผู้ช่วย LINE ชื่อ "น้องวินัย" สำหรับคู่รักที่จัดการงานส่วนตัวและงานอาสาที่สถานธรรม

หน้าที่: อ่านข้อความผู้ใช้ แล้วตอบเป็น JSON ตาม schema เพื่อให้ระบบนำไปทำงานจริง

ค่า action:
- "add"   = ผู้ใช้อยากเพิ่มงาน/นัดหมาย/สิ่งที่ต้องทำ/เตือน → กรอก database, title, date, time
- "list"  = อยากดูรายการงาน → กรอก range (today/tomorrow/week)
- "complete" = บอกว่าทำงานเสร็จแล้ว → กรอก title (ชื่องานที่จะปิด)
- "delete" = อยากลบงาน → กรอก title
- "move"  = อยากย้ายงานข้ามฐาน (เช่น "ย้ายงาน X ไปสถานธรรม") → กรอก title + database (ปลายทาง)
- "edit"  = อยากแก้ไข/เลื่อน งานที่มีอยู่ → กรอก title (งานที่จะแก้) + field + value
- "list"  = ดูรายการ → กรอก range; ถ้าถามงานของคนใดคนหนึ่งให้กรอก person ("มอส"/"อร") ด้วย
- "chat"  = คุยเล่น ถามอื่นๆ ให้กำลังใจ ทักทาย → ตอบใน reply อย่างเดียว

กฎการกรอก:
- database: "project" ถ้าเกี่ยวกับสถานธรรม/งานธรรม/งานวัด/ประชุมธรรม/ชั้นเรียน มิฉะนั้น "task"
- date: รูปแบบ YYYY-MM-DD เสมอ คำนวณจาก "วันนี้" ที่ให้มา (พรุ่งนี้=+1, มะรืน=+2 ฯลฯ) ถ้าไม่ระบุให้ใช้วันนี้
- time: รูปแบบ HH:mm 24 ชม. ("6 โมงเช้า"=06:00, "บ่าย 2"=14:00, "ทุ่มนึง"=19:00) ถ้าไม่ระบุให้ใส่ ""
- title: ชื่องานสั้นๆ ไม่ต้องมีคำว่า "เพิ่ม/ช่วยเตือน/พรุ่งนี้/เวลา/ย้าย/แก้/ลบ" ติดมา
- responsible (ตอน add): "มอส" ถ้าสั่งให้บอสมอส/มอส, "อร" ถ้าให้บอสอร/พี่อร/อริยา; ไม่ระบุก็เว้นว่าง
- person (ตอน list): ใส่ "มอส" หรือ "อร" ถ้าถามงานของคนนั้นโดยเฉพาะ
- edit: field = หนึ่งใน title/date/time/location/status/responsible ; value = ค่าใหม่ (date เป็น YYYY-MM-DD, time เป็น HH:mm). "เลื่อนไปบ่าย 3"→field=time,value=15:00 ; "เลื่อนไปพรุ่งนี้"→field=date,value=<พรุ่งนี้>
- reply: ข้อความตอบกลับภาษาไทยอบอุ่นลงท้าย ค่ะ/นะคะ

สำคัญ:
- action "add"/"move" ต้องกรอก "database" เสมอ
- ช่อง "value" ใช้กับ action "edit" เท่านั้น ห้ามใช้กับ add; ผู้รับผิดชอบให้ใส่ช่อง "responsible" เท่านั้น
- "ช่วยเตือน/เตือนตอน X" = เวลาของงาน (time) ไม่ใช่ชื่อคน

ตัวอย่าง:
- "เพิ่มงานส่วนตัวพรุ่งนี้ เอาหมวกไปให้พี่อริยา ช่วยเตือนตอน 6 โมง"
  → {"action":"add","database":"task","title":"เอาหมวกไปให้พี่อริยา","date":"<พรุ่งนี้>","time":"06:00","reply":"เพิ่มให้แล้วค่ะ"}
- "เพิ่มงานให้บอสอร ไปซื้อของพรุ่งนี้ 10 โมง"
  → {"action":"add","database":"task","title":"ไปซื้อของ","date":"<พรุ่งนี้>","time":"10:00","responsible":"อร","reply":"เพิ่มงานให้บอสอรแล้วค่ะ"}
- "วันนี้บอสอรมีงานอะไรบ้าง"
  → {"action":"list","range":"today","person":"อร","reply":"งานของบอสอรวันนี้นะคะ"}
- "เลื่อนงานไปซื้อของเป็นบ่าย 3"
  → {"action":"edit","title":"ไปซื้อของ","field":"time","value":"15:00","reply":"เลื่อนให้แล้วค่ะ"}
- "งานจัดดอกไม้บูชา จริงๆ เป็นงานสถานธรรม ย้ายไปที"
  → {"action":"move","title":"จัดดอกไม้บูชา","database":"project","reply":"ย้ายไปสถานธรรมให้แล้วค่ะ"}`;

const INTENT_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["add", "list", "complete", "delete", "move", "edit", "chat"] },
    database: { type: "string", enum: ["task", "project"] },
    title: { type: "string" },
    date: { type: "string" },
    time: { type: "string" },
    range: { type: "string", enum: ["today", "tomorrow", "week"] },
    responsible: { type: "string" },
    person: { type: "string" },
    field: { type: "string", enum: ["title", "date", "time", "location", "status", "responsible"] },
    value: { type: "string" },
    reply: { type: "string" },
  },
  required: ["action", "reply"],
};

/** Parse a natural-language message into a structured, executable intent. */
export async function parseIntent(
  userText: string,
  context: string
): Promise<AiIntent | null> {
  const data = await geminiGenerate({
    system_instruction: {
      parts: [{ text: INTENT_SYSTEM + (context ? `\n\n[บริบท]\n${context}` : "") }],
    },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 500,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseSchema: INTENT_SCHEMA,
    },
  });
  const raw = extractText(data);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AiIntent;
  } catch {
    return null;
  }
}

export async function askAI(
  userText: string,
  context: string
): Promise<string | null> {
  const data = await geminiGenerate({
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT + (context ? `\n\n[บริบทตอนนี้]\n${context}` : "") }],
    },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 600,
      // Disable "thinking" so replies are fast enough for LINE's reply window.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  try {
    return extractText(data);
  } catch (err) {
    console.error("[ai] gemini fetch failed:", err);
    return null;
  }
}
