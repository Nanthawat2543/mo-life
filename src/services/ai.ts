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

const SYSTEM_PROMPT = `คุณคือ "น้องช่วยจำ" ผู้ช่วยส่วนตัวใน LINE ของคู่รักคู่หนึ่ง (พี่ยุ้ย กับคู่ของเขา) ที่ดูแลทั้งงานส่วนตัวและงานอาสาที่สถานธรรม (งานธรรมะ)

บุคลิก: อบอุ่น เป็นกันเอง ให้กำลังใจ พูดไทยสุภาพลงท้าย "ค่ะ/นะคะ" ตอบกระชับ ไม่ยืดยาด ใส่อิโมจิได้บ้างพอเหมาะ

หน้าที่:
- คุยเล่น ตอบคำถามทั่วไป ให้กำลังใจ ช่วยคิด/วางแผน
- ถ้าผู้ใช้อยากจัดการงาน (เพิ่ม/ดู/แก้/ลบ/ย้าย) ให้แนะนำคำสั่งที่ถูกต้อง:
  • ดูงาน: พิมพ์ "วันนี้" / "พรุ่งนี้" / "สัปดาห์นี้"
  • เพิ่มงานส่วนตัว: "เพิ่ม <ชื่องาน> <วันเวลา>" เช่น "เพิ่ม เอาผ้าไปอบ วันนี้ 18:00"
  • เพิ่มงานสถานธรรม: "เพิ่มสถานธรรม <ชื่องาน> <วันเวลา>"
  • เสร็จ/แก้/ลบ: กดปุ่มบนการ์ดงาน หรือ "เสร็จ 1" / "ลบ 1" / "แก้ 1 เวลา 14:00"
  • ย้ายข้ามฐาน: "ย้าย 1 สถานธรรม" / "ย้าย 1 ส่วนตัว"
- ถ้ามีรายการงานวันนี้แนบมาในบริบท ใช้ตอบคำถามเกี่ยวกับตารางได้เลย
- อย่าแต่งข้อมูลงานที่ไม่มีจริง ถ้าไม่รู้ให้บอกตามตรงและชวนให้พิมพ์ "วันนี้" เพื่อดู

ตอบสั้นๆ ตรงประเด็น เหมือนเพื่อนที่คอยช่วยจำค่ะ`;

export interface AiIntent {
  action: "add" | "list" | "complete" | "delete" | "chat";
  database?: "task" | "project";
  title?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:mm or ""
  range?: "today" | "tomorrow" | "week";
  reply: string;
}

const INTENT_SYSTEM = `คุณคือตัวแยกเจตนา (intent parser) ของผู้ช่วย LINE ชื่อ "น้องช่วยจำ" สำหรับคู่รักที่จัดการงานส่วนตัวและงานอาสาที่สถานธรรม

หน้าที่: อ่านข้อความผู้ใช้ แล้วตอบเป็น JSON ตาม schema เพื่อให้ระบบนำไปทำงานจริง

ค่า action:
- "add"   = ผู้ใช้อยากเพิ่มงาน/นัดหมาย/สิ่งที่ต้องทำ/เตือน → กรอก database, title, date, time
- "list"  = อยากดูรายการงาน → กรอก range (today/tomorrow/week)
- "complete" = บอกว่าทำงานเสร็จแล้ว → กรอก title (ชื่องานที่จะปิด)
- "delete" = อยากลบงาน → กรอก title
- "chat"  = คุยเล่น ถามอื่นๆ ให้กำลังใจ ทักทาย → ตอบใน reply อย่างเดียว

กฎการกรอก:
- database: "project" ถ้าเกี่ยวกับสถานธรรม/งานธรรม/งานวัด/ประชุมธรรม/ชั้นเรียน มิฉะนั้น "task"
- date: รูปแบบ YYYY-MM-DD เสมอ คำนวณจาก "วันนี้" ที่ให้มา (พรุ่งนี้=+1, มะรืน=+2, สัปดาห์หน้า ฯลฯ) ถ้าไม่ระบุวันให้ใช้วันนี้
- time: รูปแบบ HH:mm 24 ชม. ("6 โมงเช้า"=06:00, "บ่าย 2"=14:00, "ทุ่มนึง"=19:00) ถ้าไม่ระบุเวลาให้ใส่ ""
- title: ชื่องานสั้นๆ ไม่ต้องมีคำว่า "เพิ่ม/ช่วยเตือน/พรุ่งนี้/เวลา" ติดมา
- reply: ข้อความตอบกลับภาษาไทยอบอุ่นลงท้าย ค่ะ/นะคะ สำหรับ action ที่ทำจริง ให้ตอบสั้นๆ ยืนยัน; สำหรับ chat ให้ตอบเนื้อหาจริง

ตัวอย่าง: "เพิ่มงานส่วนตัวพรุ่งนี้ เอาหมวกไปให้พี่อริยา ช่วยเตือนตอน 6 โมง"
→ {"action":"add","database":"task","title":"เอาหมวกไปให้พี่อริยา","date":"<พรุ่งนี้>","time":"06:00","reply":"เพิ่มให้แล้วค่ะ"}`;

const INTENT_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["add", "list", "complete", "delete", "chat"] },
    database: { type: "string", enum: ["task", "project"] },
    title: { type: "string" },
    date: { type: "string" },
    time: { type: "string" },
    range: { type: "string", enum: ["today", "tomorrow", "week"] },
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
