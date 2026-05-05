# Ghost Skill Index

สารบัญ skill ทั้งหมดของ ghost agent จัดเรียงตาม URL context
ghost อ่านไฟล์นี้ก่อนเสมอ แทนการ `ls` ทั้งโฟลเดอร์

## วิธีใช้ (สำหรับ ghost)

1. ดู URL ปลายทาง หรือ site ที่ user พูดถึง
2. หา section ที่ตรงด้านล่าง
3. เลือก skill ที่ตรงกับ action แล้วอ่านไฟล์นั้นโดยตรง
4. ถ้าไม่มี section หรือไม่มี skill ที่ตรง → ทำงานตามปกติแล้วสร้าง skill ใหม่ + อัปเดต index นี้

---

## facebook.com

| Task | Skill | File |
|------|-------|------|
| ไปที่โปรไฟล์เพื่อน | `facebook-search-friend` | `.claude/skills/facebook-search-friend/skill.md` |

---

<!-- TEMPLATE สำหรับ section ใหม่

## <domain>.com

| Task | Skill | File |
|------|-------|------|
| <action> | `<skill-name>` | `.claude/skills/<skill-name>/skill.md` |

-->
