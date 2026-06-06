# Thank You For Calling — Backend

Interactive audio phone tree platform for artists.

## Structure

```
/api
  call.js        — Main TwiML handler (Twilio calls this)
  recording.js   — Voicemail webhook (saves recordings to B2 + Supabase)
  upload.js      — MP3 upload endpoint (editor → B2)
  analytics.js   — Call stats for dashboard
/lib
  supabase.js    — Supabase client
  b2.js          — Backblaze B2 (S3-compatible) client
schema.sql       — Run this in Supabase SQL Editor once
vercel.json      — Vercel config
.env.example     — Copy to .env.local and fill in your keys
```

## Setup

### 1. Environment variables
Copy `.env.example` to `.env.local` and fill in all values.
In Vercel, add these under Project → Settings → Environment Variables.

### 2. Database
Go to Supabase Dashboard → SQL Editor → New query.
Paste the contents of `schema.sql` and run it.

### 3. Deploy
Push to GitHub. Vercel auto-deploys on every push.

### 4. Point Twilio at your server
In Twilio console → Phone Numbers → your number:
- "A call comes in" webhook → `https://your-app.vercel.app/api/call`
- Method: HTTP POST

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/call` | POST | Main call handler (Twilio webhook) |
| `/api/recording` | POST | Voicemail callback (Twilio webhook) |
| `/api/upload` | POST | Upload MP3 from editor |
| `/api/analytics` | GET | Call stats for dashboard |

## Global navigation keys

| Key | Action |
|-----|--------|
| 0 | Back to last menu |
| 00 | Back to main projects menu |
| # | About node (from menus) |
| * | Skip track (in playlists) |
