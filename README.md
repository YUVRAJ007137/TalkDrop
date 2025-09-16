# TalkDrop (MVP)

WhatsApp-inspired real-time chat with file sharing using React (Vite) + Supabase.

## Setup

1. Create a Supabase project.
2. Create tables using your provided SQL (Users, Rooms, Messages). Ensure `Messages.room_id` has `ON DELETE CASCADE`.
3. Create a public Storage bucket named `talkdrop-uploads` and enable public access.
4. Copy `.env.example` to `.env` and fill values.

## Run

```bash
pnpm install # or npm/yarn
pnpm dev
```

Open http://localhost:5173

## Env

- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY 