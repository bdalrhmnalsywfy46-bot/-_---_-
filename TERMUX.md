# التشغيل من تليفون أندرويد فقط (مجاني)

1. نزّل **Termux** و**Termux:Boot** من F-Droid (نسخة بلاي ستور قديمة ومش بتشتغل).
2. افتح Termux واكتب:
   ```
   pkg update -y && pkg install -y nodejs git cloudflared nano
   git clone https://github.com/USERNAME/REPO.git
   cd REPO && npm install
   cp .env.example .env && nano .env
   ```
   في `.env` اتأكد: `WA_DRIVER=baileys`، وغيّر `DASHBOARD_PASSWORD` و`VERIFY_TOKEN` وحط `APP_ID` و`APP_SECRET`. (حفظ في nano: Ctrl+X ثم Y ثم Enter، وCtrl من الصف الإضافي فوق الكيبورد).
3. شغّل السيرفر:
   ```
   termux-wake-lock
   node server.js
   ```
4. افتح جلسة Termux تانية (اسحب من حرف الشاشة الشمال ثم New session) واكتب:
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
   هيطلع رابط `https://....trycloudflare.com`، ده رابطك.
5. افتح الرابط في كروم، سجّل دخول، وروح الإعدادات: اربط واتساب بكود الربط، اختار الجروب، وأضف الصفحات.
6. في ميتا: Callback URL = `الرابط/webhook`.

## مهم
- الرابط **بيتغير كل مرة** تشغّل cloudflared، فلازم تغيّره في ميتا بعدها.
- الإعدادات: Termux ← إيقاف توفير البطارية، وسيبه شغال في الإشعارات.
- الرقم اللي بتربطه لازم يكون عضو في الجروب.
- Baileys غير رسمية، فاستخدم رقم مخصص للشغل.
