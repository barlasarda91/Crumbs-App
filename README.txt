CRUMBS — Deployment Guide (Railway)
=====================================

LOCAL DEVELOPMENT
------------------
1. npm install
2. Copy .env.example to .env and add your Square API key
3. Run two terminals:
   Terminal 1: node server.js
   Terminal 2: npm run dev
4. Open http://localhost:5173

DEPLOY TO RAILWAY (free hosting)
----------------------------------
1. Go to https://railway.app and sign up with GitHub
   (create a free GitHub account at github.com if needed)

2. Create a new GitHub repository:
   - Go to github.com → New repository → name it "crumbs" → Create
   - Upload all files from this folder to the repository

3. In Railway:
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your "crumbs" repository
   - Railway will auto-detect the config and start building

4. Add your Square API key:
   - In Railway project → Variables tab
   - Add: SQUARE_API_KEY = your_production_key_here

5. Get your URL:
   - Railway → Settings → Networking → Generate Domain
   - Share that URL with your manager — no setup needed on their end

UPDATING THE APP
-----------------
Upload changed files to GitHub → Railway auto-redeploys in ~2 minutes.
