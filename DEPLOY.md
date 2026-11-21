# النشر 24 ساعة على سيرفر (VPS)

1. اعمل سيرفر Ubuntu صغير (Hetzner / DigitalOcean / Contabo، حوالي 4-6$ في الشهر) وركّب Docker:
   `curl -fsSL https://get.docker.com | sh`
2. وجّه دومين (أو DuckDNS المجاني) على IP السيرفر.
3. على السيرفر:
   ```
   git clone https://github.com/USERNAME/REPO.git && cd REPO
   cp .env.example .env && nano .env     # عبّي القيم، DOMAIN = الدومين
   docker compose up -d --build
   ```
4. اربط واتساب (مرة واحدة): من جهازك
   `ssh -L 3001:localhost:3001 user@IP` ثم افتح http://localhost:3001 ← Sessions ← default ← امسح QR بالرقم المخصص.
5. هات id الجروب من `https://دومينك/api/groups` وحطه في WHATSAPP_GROUP_ID في .env ثم `docker compose up -d`.
6. في ميتا: Callback URL = `https://دومينك/webhook`.

التحديث بعد أي تعديل: `git pull && docker compose up -d --build`
الـ restart: unless-stopped بيخلي كل حاجة ترجع تشتغل لوحدها بعد أي إعادة تشغيل للسيرفر.
