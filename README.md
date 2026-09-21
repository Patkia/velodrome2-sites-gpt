# Velodrome Position Monitor — ChatGPT Site

โปรเจกต์นี้คือเวอร์ชันของ **Velodrome Position Monitor** ที่ปรับสำหรับ deploy บน **ChatGPT Site** โดยเฉพาะ

> Live Site: https://velodrome.patkia.chatgpt.site/

โปรเจกต์นี้แยกจากเวอร์ชัน production ที่ deploy บน Vercel (`velodrome2`) เพื่อให้สามารถใช้ runtime และโครงสร้างของ ChatGPT Site ได้โดยตรง

## ความสามารถหลัก

- แสดง Velodrome positions แบบ live จากหลาย chain
  - Optimism
  - Celo
  - Soneium
- อ่านข้อมูลผ่าน RPC แบบ read-only
- แสดงสถานะ In Range / Out of Range
- แสดงมูลค่าปัจจุบันของ position
- คำนวณ Initial Value จาก mint transaction / IncreaseLiquidity history
- คำนวณ P/L และ P/L %
- แสดง token amounts และมูลค่า USD
- แสดง reward และมูลค่า USD
- รองรับ Telegram notification สำหรับ position ที่ Out of Range
- ใช้ Upstash Redis สำหรับ stateful deduplication ของ notification
- มี endpoint สำหรับ cron monitor และ manual test notification

## สถาปัตยกรรม

Browser → ChatGPT Site → Site Worker → RPC / Blockscout / DeFiLlama

ทุก blockchain operation ในโปรเจกต์นี้เป็นแบบ **read-only** ไม่มี transaction signing หรือ private key สำหรับส่งธุรกรรม

## Environment Variables

ค่าที่เป็นความลับต้องตั้งผ่าน Environment Variables ของ deployment เท่านั้น และห้าม commit ลง Git เช่น:

- `CRON_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

ไฟล์ `.env*` และ `.serena/` ถูก ignore จาก Git แล้ว

## คำสั่งสำหรับพัฒนา

```powershell
npm test
npm run lint
npm run check
npm run build
npm start
```

ก่อน deploy ควรให้ `test`, `lint`, `check` และ `build` ผ่านทั้งหมด

## หมายเหตุ

- Repo นี้มีไว้สำหรับ **ChatGPT Site deployment**
- เวอร์ชัน Vercel อยู่ในโปรเจกต์ `velodrome2` แยกต่างหาก
- Upstash namespace เดิม `velodrome2-sites-poc:` ยังคงไว้เพื่อรักษา notification state เดิม
