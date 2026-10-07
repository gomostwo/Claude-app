# สงขลา — Pixar-style 3D Video

วิดีโอแนวตั้ง (1080×1920, 30fps, 75 วินาที) สไตล์แอนิเมชันการ์ตูน 3D แบบ Pixar เรนเดอร์ด้วย three.js ทีละเฟรม

**ไฟล์วิดีโอ:** `songkhla-pixar.mp4`

## อะไรที่ทำให้ดูเป็น "Pixar"
- **ตัวละคร:** น้องนางเงือกทอง (ตาโต กะพริบตา โบกมือ ผมพลิ้ว แก้มชมพู), ปูน้อย, นกนางนวล, แมวส้มในเมืองเก่า, เครื่องบินมีตา
- **แสง:** key light อุ่น + fill จากท้องฟ้า + rim light จากด้านหลัง, เงานุ่ม (VSM), แสงสะท้อนจากท้องฟ้า (environment map)
- **วัสดุ:** ผิวนุ่มแบบดินปั้น/พลาสติก (sheen, clearcoat), รูปทรงโค้งมนทั้งหมด (rounded box, blob, tapered tube)
- **Post-processing:** Ambient Occlusion (GTAO), Bloom, Depth of Field (ฉากหลังเบลอ), Color grading อุ่น + vignette

## สร้างวิดีโอใหม่
```bash
ln -sfn "$(npm root -g)/playwright" node_modules/playwright
node render.mjs frames 30 --from=0 --to=19 & node render.mjs frames 30 --from=19 --to=38 &
node render.mjs frames 30 --from=38 --to=57 & node render.mjs frames 30 --from=57 --to=75 & wait
python3 music.py 75 music.wav
ffmpeg -framerate 30 -i frames/f%05d.jpg -i music.wav -c:v libx264 -pix_fmt yuv420p -crf 20 -c:a aac -b:a 160k -shortest songkhla-pixar.mp4
```
ฉาก ตัวละคร และกล้องอยู่ใน `app.js` ข้อความอยู่ใน `index.html` · three.js (MIT) อยู่ใน `vendor/`
