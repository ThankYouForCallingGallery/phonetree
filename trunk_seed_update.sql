-- ============================================================
-- Updated trunk seed — 7 nodes
-- Run in Supabase SQL Editor
-- ============================================================

-- Remove old trunk nodes and paths
DELETE FROM paths WHERE from_node_id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000007'
);

DELETE FROM nodes WHERE id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000007'
);

-- Insert 7 trunk nodes
INSERT INTO nodes (id, type, name, is_locked, canvas_x, canvas_y)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'trunk_intro',  'Trunk Intro',  true, 100, 300),
  ('00000000-0000-0000-0000-000000000002', 'trunk_gate',   'Trunk Gate',   true, 300, 300),
  ('00000000-0000-0000-0000-000000000003', 'trunk_enter',  'Trunk Enter',  true, 500, 300),
  ('00000000-0000-0000-0000-000000000004', 'trunk_count',  'Trunk Count',  true, 700, 300),
  ('00000000-0000-0000-0000-000000000005', 'trunk_menu',   'Trunk Menu',   true, 900, 300),
  ('00000000-0000-0000-0000-000000000006', 'trunk_repeat', 'Trunk Repeat', true, 1100, 300),
  ('00000000-0000-0000-0000-000000000007', 'trunk_about',  'Trunk About',  true, 900, 500)
ON CONFLICT (id) DO UPDATE SET
  type = EXCLUDED.type,
  name = EXCLUDED.name,
  is_locked = EXCLUDED.is_locked,
  canvas_x = EXCLUDED.canvas_x,
  canvas_y = EXCLUDED.canvas_y;

-- Insert trunk paths
INSERT INTO paths (from_node_id, to_node_id, action_type, key)
VALUES
  -- trunk_intro → auto → trunk_gate
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'autoplay', null),
  -- trunk_gate → press 1 → trunk_enter
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'keypress', '1'),
  -- trunk_enter → auto → trunk_count
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'autoplay', null),
  -- trunk_count → auto → trunk_menu
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000005', 'autoplay', null),
  -- trunk_menu → auto → trunk_repeat (after playlist ends)
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006', 'autoplay', null),
  -- trunk_repeat → * → trunk_menu (loop)
  ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000005', 'keypress', '*')
ON CONFLICT DO NOTHING;
