/**
 * POST /api/call
 *
 * Main entry point. Twilio hits this when a call comes in.
 *
 * Performance optimisations:
 * 1. In-process cache — nodes and paths are loaded once and cached in memory.
 *    Cache is invalidated every 60 seconds so editor saves go live quickly.
 * 2. Autoplay chaining — consecutive autoplay nodes are resolved in one request
 *    and all their audio files are queued in a single TwiML response.
 *    No round trips between auto-playing nodes = no gaps.
 * 3. Keypress routing uses the cached paths — no DB hit per keypress.
 */

import supabase from '../lib/supabase.js'
import twilio from 'twilio'

const VoiceResponse = twilio.twiml.VoiceResponse

// ─── Trunk node fixed UUIDs ───────────────────────────────────────────────────
const TRUNK_IDS = {
  trunk_intro:  '00000000-0000-0000-0000-000000000001',
  trunk_gate:   '00000000-0000-0000-0000-000000000002',
  trunk_enter:  '00000000-0000-0000-0000-000000000003',
  trunk_count:  '00000000-0000-0000-0000-000000000004',
  trunk_menu:   '00000000-0000-0000-0000-000000000005',
  trunk_repeat: '00000000-0000-0000-0000-000000000006',
  trunk_about:  '00000000-0000-0000-0000-000000000007',
}

// ─── In-process tree cache ────────────────────────────────────────────────────
let cache = { nodes: null, paths: null, loadedAt: 0 }
const CACHE_TTL = 60 * 1000 // 60 seconds

async function getTree() {
  const now = Date.now()
  if (cache.nodes && (now - cache.loadedAt) < CACHE_TTL) {
    return cache
  }
  const [{ data: nodes }, { data: paths }] = await Promise.all([
    supabase.from('nodes').select('*'),
    supabase.from('paths').select('*'),
  ])
  cache = { nodes, paths, loadedAt: now }
  return cache
}

function getNode(tree, id) {
  return tree.nodes?.find(n => n.id === id) || null
}

function getAutoplays(tree, fromId) {
  return tree.paths?.filter(p => p.from_node_id === fromId && p.action_type === 'autoplay') || []
}

function getKeypressPath(tree, fromId, key) {
  return tree.paths?.find(p => p.from_node_id === fromId && p.action_type === 'keypress' && p.key === key) || null
}

// ─── Autoplay chain resolver ──────────────────────────────────────────────────
// Follows autoplay paths and collects all audio URLs into one list.
// Stops when it hits a node that needs user input (gather) or has no autoplay.
// Returns { audioUrls, terminalNode } where terminalNode is where we stopped.
function resolveAutoplays(tree, startNodeId, visited = new Set()) {
  const audioUrls = []
  let currentId = startNodeId

  while (currentId) {
    if (visited.has(currentId)) break // loop guard
    visited.add(currentId)

    const node = getNode(tree, currentId)
    if (!node) break

    // Nodes that need gather (user input) — stop chaining here
    const needsGather = ['trunk_gate', 'trunk_menu', 'trunk_repeat', 'project_menu', 'playlist', 'leave_message']
    if (needsGather.includes(node.type)) {
      return { audioUrls, terminalNode: node }
    }

    if (node.audio_url) {
      audioUrls.push(node.audio_url)
    }

    // Follow autoplay path
    const nextPaths = getAutoplays(tree, currentId)
    currentId = nextPaths[0]?.to_node_id || null
  }

  const terminalNode = currentId ? getNode(tree, currentId) : null
  return { audioUrls, terminalNode }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const twiml = new VoiceResponse()

  try {
    const digit = req.body?.Digits || null
    const callSid = req.body?.CallSid
    let nodeId = req.query?.node || null

    // Resolve string aliases to UUIDs
    if (nodeId && TRUNK_IDS[nodeId]) nodeId = TRUNK_IDS[nodeId]

    // Load tree from cache
    const tree = await getTree()

    // Log async — don't await, no need to block on this
    logCallEvent(callSid, nodeId, digit)

    // First call — start at trunk_intro
    if (!nodeId) nodeId = TRUNK_IDS.trunk_intro

    // Global navigation
    if (digit === '00') return sendRedirect(res, twiml, TRUNK_IDS.trunk_menu)
    if (digit === '0') return redirectToLastMenu(res, twiml, callSid, tree)

    const node = getNode(tree, nodeId)
    if (!node) {
      console.error('Node not found:', nodeId)
      return sendRedirect(res, twiml, TRUNK_IDS.trunk_menu)
    }

    // Universal keypress routing — paths table is always source of truth
    if (digit && digit !== '*' && digit !== '#') {
      const path = getKeypressPath(tree, node.id, digit)
      if (path?.to_node_id) return sendRedirect(res, twiml, path.to_node_id)
    }

    // Route by node type
    switch (node.type) {

      // ── Auto-play audio nodes — chain seamlessly ──
      case 'trunk_intro':
      case 'trunk_enter':
      case 'trunk_count':
      case 'project_intro':
      case 'audio_clip':
      case 'trunk_about':
      case 'project_about': {
        const { audioUrls, terminalNode } = resolveAutoplays(tree, node.id)
        for (const url of audioUrls) twiml.play(url)
        if (terminalNode) {
          return serveTerminalNode(res, twiml, terminalNode, tree, callSid, digit, req.query)
        }
        return sendRedirect(res, twiml, TRUNK_IDS.trunk_menu)
      }

      // ── Gate — must press 1 ──
      case 'trunk_gate': {
        const gather = twiml.gather({ numDigits: 1, timeout: 10, action: `/api/call?node=${node.id}`, method: 'POST' })
        if (node.audio_url) gather.play(node.audio_url)
        else gather.say('Press 1 to enter.')
        twiml.redirect(`/api/call?node=${node.id}`) // timeout replays
        return sendTwiml(res, twiml)
      }

      // ── Trunk menu playlist ──
      case 'trunk_menu':
        return serveTrunkMenuPlaylist(res, twiml, node, tree, callSid, req.query)

      // ── Trunk repeat ──
      case 'trunk_repeat': {
        const gather = twiml.gather({ numDigits: 1, timeout: 10, action: `/api/call?node=${node.id}`, method: 'POST' })
        if (node.audio_url) gather.play(node.audio_url)
        else gather.say('Press star to hear the menu again.')
        twiml.redirect(`/api/call?node=${TRUNK_IDS.trunk_menu}&track=0`)
        return sendTwiml(res, twiml)
      }

      // ── Project menu ──
      case 'project_menu':
        return serveMenuNode(res, twiml, node, tree, digit, callSid)

      // ── Playlist ──
      case 'playlist':
        return servePlaylistNode(res, twiml, node, tree, digit, req.query)

      // ── Leave message ──
      case 'leave_message':
        return serveLeaveMessageNode(res, twiml, node, callSid)

      // ── Return ──
      case 'return': {
        if (digit === '1' && node.project_node_id) return sendRedirect(res, twiml, node.project_node_id)
        return sendRedirect(res, twiml, TRUNK_IDS.trunk_menu)
      }

      default:
        twiml.say('This section is not yet available.')
        return sendRedirect(res, twiml, TRUNK_IDS.trunk_menu)
    }

  } catch (err) {
    console.error('Call handler error:', err)
    twiml.say('Sorry, something went wrong. Please try again.')
    return sendTwiml(res, twiml)
  }
}

// ─── Terminal node handler ────────────────────────────────────────────────────
// Called after an autoplay chain resolves to a node that needs user input.
function serveTerminalNode(res, twiml, node, tree, callSid, digit, query) {
  switch (node.type) {
    case 'trunk_gate': {
      const gather = twiml.gather({ numDigits: 1, timeout: 10, action: `/api/call?node=${node.id}`, method: 'POST' })
      if (node.audio_url) gather.play(node.audio_url)
      else gather.say('Press 1 to enter.')
      twiml.redirect(`/api/call?node=${node.id}`)
      return sendTwiml(res, twiml)
    }
    case 'trunk_menu':
      return serveTrunkMenuPlaylist(res, twiml, node, tree, callSid, query)
    case 'project_menu':
      return serveMenuNode(res, twiml, node, tree, digit, callSid)
    case 'playlist':
      return servePlaylistNode(res, twiml, node, tree, digit, query)
    case 'leave_message':
      return serveLeaveMessageNode(res, twiml, node, callSid)
    default:
      return sendRedirect(res, twiml, TRUNK_IDS.trunk_menu)
  }
}

// ─── Node handlers ────────────────────────────────────────────────────────────

async function serveTrunkMenuPlaylist(res, twiml, node, tree, callSid, query) {
  updateLastMenu(callSid, node.id) // async, don't block

  const tracks = node.playlist_tracks || []
  const trackIndex = parseInt(query?.track || '0', 10)

  if (!tracks.length) {
    const gather = twiml.gather({ numDigits: 2, timeout: 10, action: `/api/call?node=${node.id}`, method: 'POST' })
    gather.say('Welcome to Thank You For Calling. Check back soon.')
    twiml.redirect(`/api/call?node=${node.id}`)
    return sendTwiml(res, twiml)
  }

  if (trackIndex >= tracks.length) {
    return sendRedirect(res, twiml, TRUNK_IDS.trunk_repeat)
  }

  const currentTrack = tracks[trackIndex]
  const gather = twiml.gather({
    numDigits: 1,
    timeout: 999,
    action: `/api/call?node=${node.id}&track=${trackIndex + 1}`,
    method: 'POST',
  })
  gather.play(currentTrack.audio_url)
  twiml.redirect(`/api/call?node=${node.id}&track=${trackIndex + 1}`)
  return sendTwiml(res, twiml)
}

async function serveMenuNode(res, twiml, node, tree, digit, callSid) {
  updateLastMenu(callSid, node.id)

  if (digit === '#') {
    const path = getKeypressPath(tree, node.id, '#')
    if (path?.to_node_id) return sendRedirect(res, twiml, path.to_node_id)
  }

  const gather = twiml.gather({ numDigits: 2, timeout: 10, action: `/api/call?node=${node.id}`, method: 'POST' })
  if (node.audio_url) gather.play(node.audio_url)
  else gather.say('No audio available for this menu yet.')
  twiml.redirect(`/api/call?node=${node.id}`)
  return sendTwiml(res, twiml)
}

function servePlaylistNode(res, twiml, node, tree, digit, query) {
  const tracks = node.playlist_tracks || []
  const trackIndex = parseInt(query?.track || '0', 10)
  const nextIndex = digit === '*' ? trackIndex + 1 : trackIndex

  if (!tracks.length || nextIndex >= tracks.length) {
    if (node.loop) return sendRedirect(res, twiml, node.id + '?track=0')
    return sendRedirect(res, twiml, TRUNK_IDS.trunk_menu)
  }

  const gather = twiml.gather({
    numDigits: 1,
    timeout: 999,
    action: `/api/call?node=${node.id}&track=${nextIndex + 1}`,
    method: 'POST',
  })
  gather.play(tracks[nextIndex].audio_url)
  twiml.redirect(`/api/call?node=${node.id}&track=${nextIndex + 1}`)
  return sendTwiml(res, twiml)
}

function serveLeaveMessageNode(res, twiml, node, callSid) {
  if (node.audio_url) twiml.play(node.audio_url)
  else twiml.say('Please leave your message after the tone.')
  twiml.record({
    action: `/api/recording?callSid=${callSid}&nodeId=${node.id}`,
    method: 'POST',
    maxLength: 120,
    playBeep: true,
    transcribe: false,
  })
  return sendTwiml(res, twiml)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendRedirect(res, twiml, nodeId) {
  twiml.redirect('/api/call?node=' + nodeId)
  return sendTwiml(res, twiml)
}

async function redirectToLastMenu(res, twiml, callSid, tree) {
  const { data } = await supabase
    .from('call_sessions')
    .select('last_menu_node_id')
    .eq('call_sid', callSid)
    .single()
  return sendRedirect(res, twiml, data?.last_menu_node_id || TRUNK_IDS.trunk_menu)
}

function updateLastMenu(callSid, nodeId) {
  if (!callSid) return
  supabase.from('call_sessions').upsert(
    { call_sid: callSid, last_menu_node_id: nodeId, updated_at: new Date().toISOString() },
    { onConflict: 'call_sid' }
  ).then(() => {})
}

function logCallEvent(callSid, nodeId, digit) {
  if (!callSid) return
  supabase.from('call_events').insert({
    call_sid: callSid,
    node_id: nodeId || null,
    digit_pressed: digit,
    created_at: new Date().toISOString(),
  }).then(() => {})
}

function sendTwiml(res, twiml) {
  res.setHeader('Content-Type', 'text/xml')
  res.status(200).send(twiml.toString())
}
