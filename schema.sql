-- ============================================================
-- Thank You For Calling — Database Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  artist_name TEXT,
  is_live BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Nodes (all node types)
CREATE TABLE IF NOT EXISTS nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- trunk_intro, trunk_menu, trunk_about, project_intro, project_menu, project_about, audio_clip, playlist, leave_message, return
  name TEXT,
  audio_url TEXT,
  playlist_tracks JSONB DEFAULT '[]', -- [{name, audio_url}]
  loop BOOLEAN DEFAULT false,
  shuffle BOOLEAN DEFAULT false,
  auto_next_node UUID, -- for auto-play chaining
  about_node_id UUID, -- for menu nodes, points to their about node
  project_node_id UUID, -- for return nodes, points back to project menu
  is_locked BOOLEAN DEFAULT false, -- trunk nodes are locked
  canvas_x FLOAT DEFAULT 0,
  canvas_y FLOAT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Paths (connections between nodes)
CREATE TABLE IF NOT EXISTS paths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  from_node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
  to_node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL DEFAULT 'keypress', -- keypress | autoplay
  key TEXT, -- e.g. '1', '2', '#', '*'
  from_anchor TEXT DEFAULT 'right', -- top, right, bottom, left
  to_anchor TEXT DEFAULT 'left',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Call sessions (tracks active calls for 0/back navigation)
CREATE TABLE IF NOT EXISTS call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid TEXT UNIQUE NOT NULL,
  last_menu_node_id UUID,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Call events (every keypress and node visit)
CREATE TABLE IF NOT EXISTS call_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid TEXT NOT NULL,
  node_id UUID,
  digit_pressed TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Voicemails
CREATE TABLE IF NOT EXISTS voicemails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid TEXT NOT NULL,
  node_id UUID,
  audio_url TEXT NOT NULL,
  duration_seconds INTEGER DEFAULT 0,
  is_heard BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_paths_from ON paths(from_node_id);
CREATE INDEX IF NOT EXISTS idx_call_events_call_sid ON call_events(call_sid);
CREATE INDEX IF NOT EXISTS idx_call_events_created ON call_events(created_at);
CREATE INDEX IF NOT EXISTS idx_voicemails_created ON voicemails(created_at);

-- ── Trunk nodes (pre-built, locked) ──────────────────────────
-- These are global — not tied to any project
INSERT INTO nodes (id, type, name, is_locked, canvas_x, canvas_y)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'trunk_intro', 'Trunk Intro', true, 100, 200),
  ('00000000-0000-0000-0000-000000000002', 'trunk_menu', 'Projects Menu', true, 350, 200),
  ('00000000-0000-0000-0000-000000000003', 'trunk_about', 'About', true, 350, 400)
ON CONFLICT (id) DO NOTHING;

-- Auto-play from trunk intro to trunk menu
INSERT INTO paths (from_node_id, to_node_id, action_type)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'autoplay')
ON CONFLICT DO NOTHING;

-- # from trunk menu to trunk about
INSERT INTO paths (from_node_id, to_node_id, action_type, key)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'keypress', '#')
ON CONFLICT DO NOTHING;
