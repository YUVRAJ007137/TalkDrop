-- Migration: add message edit/delete support
-- Date: 2025-11-27
-- Adds soft-delete and edit-tracking to messages table

BEGIN;

-- Add columns to track message edits and deletion (soft-delete)
ALTER TABLE public.messages 
  ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS original_message text;

-- Index for soft-delete queries (faster filtering of active messages)
CREATE INDEX IF NOT EXISTS idx_messages_is_deleted ON public.messages (is_deleted, room_id);

-- Optional: create an edit_history table to track all edits (for audit trail)
CREATE TABLE IF NOT EXISTS public.message_edits (
  id bigserial PRIMARY KEY,
  message_id bigint NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  username text NOT NULL,
  old_message text NOT NULL,
  new_message text NOT NULL,
  edited_at timestamptz DEFAULT now()
);

-- Index for looking up edits for a specific message
CREATE INDEX IF NOT EXISTS idx_message_edits_message_id ON public.message_edits (message_id);

COMMIT;

-- Rollback (if needed):
-- ALTER TABLE public.messages DROP COLUMN IF EXISTS is_deleted, DROP COLUMN IF EXISTS edited_at, DROP COLUMN IF EXISTS original_message;
-- DROP TABLE IF EXISTS public.message_edits;
