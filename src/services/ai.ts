import { config } from "../config";

// Google Gemini (free tier) — used as a conversational fallback so the bot can
// chat naturally instead of replying "ไม่เข้าใจ". Get a free key at
// https://aistudio.google.com/apikey (no billing required).
const MODEL = "gemini-2.5-flash";

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

export async function askAI(
  userText: string,
  context: string
): Promise<string | null> {
  if (!config.geminiApiKey) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${config.geminiApiKey}`;
  const body = {
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
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error("[ai] gemini error", r.status, await r.text());
      return null;
    }
    const data: any = await r.json();
    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p.text)
        .join("")
        .trim() ?? null;
    return text || null;
  } catch (err) {
    console.error("[ai] gemini fetch failed:", err);
    return null;
  }
}
