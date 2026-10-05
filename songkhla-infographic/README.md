# สงขลา — Infographic Video

วิดีโอ infographic แนวตั้ง (1080×1920, 30fps, ~75 วินาที) แนะนำจังหวัดสงขลา เหมาะกับ TikTok / Reels / Shorts

**ไฟล์วิดีโอ:** `songkhla-infographic.mp4`

## ฉากในวิดีโอ
1. Intro — สงขลา เมืองสองทะเล
2. สงขลาในตัวเลข (พื้นที่ 7,394 ตร.กม. · 16 อำเภอ · ~1.4 ล้านคน · 2 ทะเล)
3. หาดสมิหลา & นางเงือกทอง
4. ทะเลสาบสงขลา & สะพานติณสูลานนท์ (เกาะยอ)
5. เมืองเก่าสงขลา
6. หาดใหญ่
7. น้ำตกโตนงาช้าง & เขาตังกวน
8. อร่อยต้องลอง
9. ทริปแนะนำ 3 วัน 2 คืน
10. วิธีเดินทาง
11. ปิดท้าย — ชวนมาเที่ยว

## สร้างวิดีโอใหม่
```bash
ln -sfn "$(npm root -g)/playwright" node_modules/playwright   # หรือ npm i playwright
node render.mjs frames 30                 # เรนเดอร์เฟรมจาก index.html
python3 music.py 75 music.wav             # สร้างเพลงประกอบ (ต้องมี numpy)
ffmpeg -framerate 30 -i frames/f%05d.jpg -i music.wav -c:v libx264 -pix_fmt yuv420p -crf 22 -c:a aac -b:a 160k -shortest songkhla-infographic.mp4
```
เปิด `index.html` ในเบราว์เซอร์เพื่อดูแอนิเมชันแบบสด ๆ ได้เช่นกัน แก้ข้อความ/สี ได้ในไฟล์เดียว
