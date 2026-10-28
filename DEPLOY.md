# SCANE — Production Deployment Guide (Render.com & Railway.app)

**SCANE** — Streaming Movies, TV Series & Interactive English Subtitle Platform.

---

## 1. GitHub-ga yuklash (1 daqiqa)

Terminalda loyiha papkasida (`C:\Users\Muham\.gemini\antigravity\scratch\kino-stream`) quyidagi buyruqlarni bajaring:

```bash
git init
git add .
git commit -m "Launch SCANE v1.0 Production"
git branch -M main
git remote add origin https://github.com/SIZNING_USERNAME/scane.git
git push -u origin main
```

---

## 2. Render.com orqali 1-klikda Deploy qilish (Tavsiya etiladi)

Loyiha ichida tayyor [`render.yaml`](./render.yaml) konfiguratsiyasi mavjud:
1. [Render.com](https://render.com) saytiga kiring va GitHub akkauntingizni ulang.
2. **New +** -> **Web Service** (yoki **Blueprint**) tugmasini bosing.
3. GitHub’dagi `scane` repozitoriyangizni tanlang.
4. Sozlamalar avtomatik o‘qiladi:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Health Check Path:** `/api/health`
5. **Deploy Web Service** tugmasini bosing — 1-2 daqiqada `https://scane.onrender.com` manzilingiz tayyor bo‘ladi!

---

## 3. Railway.app orqali 1-klikda Deploy qilish

Loyiha ichida tayyor [`railway.json`](./railway.json) va [`Procfile`](./Procfile) mavjud:
1. [Railway.app](https://railway.app) saytiga kiring.
2. **New Project** -> **Deploy from GitHub repo** ni tanlang.
3. `scane` repozitoriyasini tanlang.
4. Railway avtomatik ravishda `node server.js` ni ishga tushiradi va **Settings -> Networking -> Generate Domain** orqali tayyor HTTPS domenni beradi.
