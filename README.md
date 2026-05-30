# Mo Life — น้องช่วยจำ (LINE × Notion)

บอทแจ้งเตือนตารางชีวิตคู่รักผ่าน LINE OA โดยใช้ Notion เป็นฐานข้อมูล
แจ้งเตือนเป็น **Flex message** และจัดการงาน (เพิ่ม/แก้/เสร็จ/ลบ) ได้ **ทั้งหมดผ่าน LINE**

เชื่อมกับ:
- LINE OA: **NxL ทูตสวรรค์ไท่ฮุ่ย** (`@490qlucx`)
- Notion: **Tasksส่วนตัว** + **โปรเจค (งานธรรม/สถานธรรม)**

---

## ✨ การแจ้งเตือน (Flex message อัตโนมัติ)

| เวลา | อะไร |
|------|------|
| 07:30 | สรุปตารางวันนี้ (การ์ดสีเขียว เรียงตามเวลา) |
| ทุก 5 นาที | เตือนล่วงหน้า 30 นาทีก่องานที่มีเวลา (การ์ดส้ม + ปุ่ม "เสร็จแล้ว") |
| 21:00 | สรุปงานที่ยังไม่เสร็จ + ให้กำลังใจ |

ปรับเวลาได้ใน `.env` (`CRON_MORNING`, `CRON_EVENING`, `CRON_REMINDER`, `REMINDER_LEAD_MINUTES`)

---

## 🎮 ใช้งานผ่าน LINE ได้ทุกอย่าง

### เมนูล่าง (Rich Menu) — กดได้เลย
`📋 งานวันนี้` · `➕ เพิ่มงาน` · `📅 สัปดาห์นี้`

### ดูงาน
กดเมนู หรือพิมพ์: `วันนี้` / `พรุ่งนี้` / `สัปดาห์นี้`
→ ได้การ์ดงานแต่ละใบ พร้อมปุ่ม **✅ เสร็จแล้ว · ✏️ แก้ไข · 🗑️ ลบ**

### เพิ่มงาน (2 วิธี)
1. **แบบกดปุ่ม:** กด `➕ เพิ่มงาน` → พิมพ์ชื่องาน → เลือกวันเวลาจาก**ปฏิทินในแชท**
2. **แบบพิมพ์เร็ว:** `เพิ่ม ออกกำลังกาย พรุ่งนี้ 18:00`

### ทำเสร็จ / แก้ไข / ลบ
- กดปุ่มบนการ์ดงานได้เลย
  - **✅ เสร็จแล้ว** → ติ๊ก checkbox + เปลี่ยนสถานะเป็น "เสร็จแล้ว"
  - **✏️ แก้ไข** → เลือกเปลี่ยน ชื่อ / วันเวลา (ปฏิทิน) / สถานที่ / สถานะ
  - **🗑️ ลบ** → ถามยืนยันก่อน แล้วเก็บงานออก (archive)
- หรือพิมพ์: `เสร็จ 2` · `ลบ 1` · `แก้ 1 เวลา 14:00`

### อื่นๆ
- `ช่วยเหลือ` — ดูวิธีใช้
- `ไอดี` — ดูปลายทางที่บอทจะส่งแจ้งเตือน

> งานที่เพิ่ม/แก้/ลบ จะไปอยู่ใน Notion **Tasksส่วนตัว** ทันที

---

## 🛠️ ติดตั้ง

```bash
npm install
cp .env.example .env   # กรอกค่าต่างๆ
npm run build
npm start
```

### ค่าใน `.env`
- `NOTION_TOKEN`, `NOTION_TASKS_DB_ID`, `NOTION_PROJECTS_DB_ID`
- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`
- `LINE_TARGET_ID` — เว้นว่างได้ (บอทจับเองเมื่อทักครั้งแรก)
- `CRON_SECRET` — สุ่มข้อความสำหรับ endpoint `/cron/*`

### แชร์ Notion DB กับ integration
เปิด database → `···` → **Connections** → เพิ่ม integration ของคุณ (ทำทั้ง 2 อัน)

### ตั้งค่า LINE webhook
1. [LINE Developers Console](https://developers.line.biz/) → channel → **Messaging API**
2. **Webhook URL** = `https://<your-domain>/line/webhook`
3. เปิด **Use webhook** = ON
4. ปิด **Auto-reply** / **Greeting** ใน OA Manager

### ติดตั้ง Rich Menu (เมนูล่าง) — ทำครั้งเดียว
```bash
npm run setup:richmenu
```

---

## 🆓 Deploy ฟรี (Render + cron-job.org)

1. push โปรเจคขึ้น GitHub
2. [render.com](https://render.com) → **New → Blueprint** → เลือก repo (มี `render.yaml` ให้แล้ว)
3. กรอก env vars ใน dashboard (Notion/LINE/CRON_SECRET)
4. ได้ URL เช่น `https://mo-life.onrender.com` → เอาไปใส่เป็น LINE Webhook URL
5. ที่ [cron-job.org](https://cron-job.org) (ฟรี) สร้าง 3 งาน เรียกทุก endpoint ตามเวลา:
   - `https://<url>/cron/morning?key=CRON_SECRET` — 07:30
   - `https://<url>/cron/evening?key=CRON_SECRET` — 21:00
   - `https://<url>/cron/reminder?key=CRON_SECRET` — ทุก 5 นาที

> Render free จะ "หลับ" เมื่อไม่มีคนใช้ การให้ cron-job.org ยิงทุก 5 นาที
> จะปลุกเครื่องให้ตื่นตลอด + สั่งงานแจ้งเตือนไปในตัว ทำให้ทำงาน 24 ชม. แบบฟรีๆ

ถ้า host แบบไม่หลับ (VPS/Railway) ตั้ง `DISABLE_INPROCESS_CRON=0` แล้วบอทจัดการ cron เองได้เลย ไม่ต้องใช้ cron-job.org

---

## โครงสร้าง

```
src/
  index.ts                  Express: webhook + /cron/* + health
  config.ts                 อ่าน env
  types/                    TaskItem
  utils/  date · session · state · reminderStore · targetStore
  services/  notion · line · scheduler
  handlers/  webhook        (คำสั่ง + ปุ่ม postback + flow เพิ่ม/แก้)
  scripts/  setup-rich-menu
assets/richmenu.png         รูปเมนูล่าง
```
