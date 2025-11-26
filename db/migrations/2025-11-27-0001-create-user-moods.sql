-- Migration: create user_moods table
-- Date: 2025-11-27
-- Creates a small table to persist user-presented moods so clients can fetch authoritative moods

BEGIN;

-- Table: user_moods
CREATE TABLE IF NOT EXISTS public.user_moods (
  username text PRIMARY KEY,
  mood text,
  updated_at timestamptz DEFAULT now()
);

-- Optional: keep a small index on updated_at for reconciliation queries
CREATE INDEX IF NOT EXISTS idx_user_moods_updated_at ON public.user_moods (updated_at);

COMMIT;

-- Rollback (if you want to drop the table):
-- DROP TABLE IF EXISTS public.user_moods;
