# Supabase setup for TalkDrop

Do these in the [Supabase Dashboard](https://supabase.com/dashboard) for your project.

---

## 1. Create a project

- Go to [Supabase](https://supabase.com) → **New project**.
- Pick org, name, database password, region.
- Wait for the project to be ready.

---

## 2. Database tables

In **SQL Editor** → **New query**, run the following (order matters because of foreign keys).

```sql
-- Rooms
CREATE TABLE IF NOT EXISTS public.rooms (
  id serial PRIMARY KEY,
  room_name character varying NOT NULL,
  password character varying
);

-- Messages (depends on rooms)
CREATE TABLE IF NOT EXISTS public.messages (
  id serial PRIMARY KEY,
  room_id integer NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  username character varying NOT NULL,
  message text NOT NULL,
  timestamp timestamptz DEFAULT now(),
  is_edited boolean DEFAULT false,
  is_deleted boolean DEFAULT false,
  reply_to_id integer REFERENCES public.messages(id),
  reply_to_username text,
  edited_at timestamptz,
  original_message text
);

-- Read receipts (per room per user)
CREATE TABLE IF NOT EXISTS public.read_receipts (
  room_id integer NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  username text NOT NULL,
  last_seen_message_id integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, username)
);

-- User moods (for presence)
CREATE TABLE IF NOT EXISTS public.user_moods (
  username text PRIMARY KEY,
  mood text,
  updated_at timestamptz DEFAULT now()
);

-- Audit log for message edits (optional but used by the app)
CREATE TABLE IF NOT EXISTS public.message_edits (
  id serial PRIMARY KEY,
  message_id integer NOT NULL REFERENCES public.messages(id),
  username text NOT NULL,
  old_message text NOT NULL,
  new_message text NOT NULL,
  edited_at timestamptz DEFAULT now()
);

-- Optional: users table (for future auth / RLS)
CREATE TABLE IF NOT EXISTS public.users (
  id serial PRIMARY KEY,
  username character varying NOT NULL
);
```

Then enable **Row Level Security (RLS)** on tables you care about (optional for MVP; recommended later for edit/delete):

- **Table Editor** → select table → **RLS** → **Enable RLS** and add policies as needed.

---

## 3. Realtime

The app uses:

- **Postgres Changes** (INSERT/UPDATE on `messages`, and all events on `user_moods`).
- **Presence** (room channels for “who’s online” and typing).
- **Broadcast** (room channels for video-call signaling).

In the dashboard:

1. Go to **Database** → **Replication** (or **Realtime** in the left sidebar).
2. Ensure **Realtime** is enabled for the project.
3. Under **Realtime** → **Publications** (or “Tables in replication”), add:
   - `messages` (for new messages and edit/delete updates).
   - `user_moods` (for mood updates).

If your UI shows “Supabase Realtime” and a list of tables, enable **Realtime** for `messages` and `user_moods`. Presence and Broadcast work at the channel level and don’t require table replication.

---

## 4. Storage (file uploads)

1. Go to **Storage** → **New bucket**.
2. Name: `talkdrop-uploads`.
3. **Public bucket**: turn **ON** (so the app can use public URLs for images/files).
4. Create the bucket.
5. (Optional) Under **Policies** for `talkdrop-uploads`, add a policy so anyone can upload and read (for anon MVP), for example:
   - **Allow uploads**: `INSERT` for `authenticated` or `anon` if you’re not using auth yet.
   - **Allow public read**: `SELECT` for `anon` (or use “Public bucket” which already allows reads).

If the bucket is **public**, the app can generate public URLs without extra policies for read.

---

## 5. Environment variables

In your app (e.g. `.env` in the project root):

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

Optional:

```env
VITE_SUPABASE_BUCKET=talkdrop-uploads
VITE_APP_PUBLIC_URL=https://your-production-domain.com
```

Get both values from Supabase: **Project Settings** → **API** → **Project URL** and **anon public** key.

---

## 6. Quick checklist

- [ ] Project created
- [ ] All tables created (rooms → messages → read_receipts, user_moods, message_edits, optional users)
- [ ] Realtime enabled for `messages` and `user_moods`
- [ ] Storage bucket `talkdrop-uploads` created and set to **Public**
- [ ] `.env` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- [ ] Restart dev server after changing `.env`

After this, the app should be able to create rooms, send messages, use presence, moods, read receipts, reply-to, edit/delete, file uploads, and video-call signaling.
