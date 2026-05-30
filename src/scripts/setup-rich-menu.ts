/**
 * One-time setup: creates the LINE rich menu (bottom button bar), uploads the
 * image, and sets it as the default for all users.
 *
 * Run once after deploying:  npx tsx src/scripts/setup-rich-menu.ts
 * Re-run anytime to replace the menu (it deletes old ones first).
 */
import fs from "fs";
import path from "path";
import { messagingApi } from "@line/bot-sdk";
import { config } from "../config";

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.line.channelAccessToken,
});
const blobClient = new messagingApi.MessagingApiBlobClient({
  channelAccessToken: config.line.channelAccessToken,
});

const WIDTH = 2500;
const HEIGHT = 843;
const COL = Math.floor(WIDTH / 3);

async function main() {
  // 1) Remove existing rich menus so re-running is clean
  const existing = await client.getRichMenuList();
  for (const rm of existing.richmenus) {
    await client.deleteRichMenu(rm.richMenuId);
    console.log("deleted old rich menu", rm.richMenuId);
  }

  // 2) Create the rich menu definition — 3 buttons sending text commands
  const created = await client.createRichMenu({
    size: { width: WIDTH, height: HEIGHT },
    selected: true,
    name: "mo-life-main",
    chatBarText: "เมนูน้องวินัย",
    areas: [
      {
        bounds: { x: 0, y: 0, width: COL, height: HEIGHT },
        action: { type: "message", text: "วันนี้" },
      },
      {
        bounds: { x: COL, y: 0, width: COL, height: HEIGHT },
        action: { type: "message", text: "เพิ่มงาน" },
      },
      {
        bounds: { x: COL * 2, y: 0, width: WIDTH - COL * 2, height: HEIGHT },
        action: { type: "message", text: "สัปดาห์นี้" },
      },
    ],
  });
  const richMenuId = created.richMenuId;
  console.log("created rich menu", richMenuId);

  // 3) Upload the image
  const imgPath = path.join(process.cwd(), "assets", "richmenu.png");
  const buffer = fs.readFileSync(imgPath);
  await blobClient.setRichMenuImage(
    richMenuId,
    new Blob([buffer], { type: "image/png" })
  );
  console.log("uploaded image from", imgPath);

  // 4) Set as default for everyone
  await client.setDefaultRichMenu(richMenuId);
  console.log("✅ rich menu is now the default. Done!");
}

main().catch((e) => {
  console.error("❌ setup failed:", e?.body ?? e);
  process.exit(1);
});
