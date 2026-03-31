# Fast Threads DTF Manager - Deployment Guide

## Quick Deploy to Vercel

1. **Push to GitHub:**
   ```bash
   cd fast-threads-dtf
   git init
   git add .
   git commit -m "Initial commit - Fast Threads DTF Manager"
   gh repo create fast-threads-dtf --private --push --source=.
   ```

2. **Connect to Vercel:**
   - Go to https://vercel.com/new
   - Import the `fast-threads-dtf` repo
   - It will auto-detect Next.js — just click Deploy

3. **Once Supabase Pro is active:**
   - Create the `fast-threads-dtf` project in Supabase
   - Add these env vars in Vercel project settings:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Redeploy

## Local Development

```bash
npm install
npm run dev
```

The app works in demo mode (in-memory storage) without Supabase configured.
Open http://localhost:3000

## What's Built

- **Submit Job** — File upload with auto-sizing, placement checks, youth/adult validation
- **Print Queue** — All submitted jobs across 3 locations
- **Batch Management** — Select items, preview gang sheet layout, create batches
- **Batch Detail** — Printable summary sheet with batch #, thumbnails, invoice #s, quantities
- **History** — Archive of all batches with filtering
- **Settings** — Configurable size profiles and gang sheet dimensions
