/**
 * POST /api/call
 *
 * Main entry point. Twilio hits this when a call comes in.
 * Reads the caller's keypress (if any), looks up the current node,
 * and returns TwiML telling Twilio what to do next.
 */

import supabase from '../lib/supabase.js'
import twilio from 'twilio'

const VoiceResponse = twilio.twiml.VoiceResponse

export default async function handler(req, res) {
  const twiml = new VoiceResponse()

  try {
    const digit = req.body?.Digits || null
    const callSid = req.body?.CallSid
    const nodeId = req.query?.node || null

    // Log the call event
    await logCallEvent(callSid, nodeId, digit)

    // First call — no node yet, start at trunk intro
    if (!nodeId) {
      return serveTrunkIntro(twiml, res)
    }

    // Fetch current node from Supabase
    const { data: node, error } = await supabase
      .from('nodes')
      .select('*')
      .eq('id', nodeId)
      .single()

    if (error || !node) {
      twiml.say('Sorry, something went wrong. Please call back.')
      return sendTwiml(res, twiml)
    }

    // Handle global navigation keys
    if (digit === '00') {
      return redirectToTrunk(twiml, res)
    }
    if (digit === '0') {
      return redirectToLastMenu(twiml, res, callSid)
    }

    // Route based on node type
    switch (node.type) {
      case 'trunk_intro':
      case 'project_intro':
      case 'audio_clip':
        return serveAudioNode(twiml, res, node)

      case 'trunk_menu':
      case 'project_menu':
        return serveMenuNode(twiml, res, node, digit, callSid)

      case 'trunk_about':
      case 'project_about':
        return serveAudioNode(twiml, res, node)

      case 'playlist':
        return servePlaylistNode(twiml, res, node, digit, req.query)

      case 'leave_message':
        return serveLeaveMessageNode(twiml, res, node, callSid)

      case 'return':
        return serveReturnNode(twiml, res, node, digit)

      default:
        twiml.say('This section is not yet available.')
        addMainMenuPrompt(twiml)
        return sendTwiml(res, twiml)
    }
  } catch (err) {
    console.error('Call handler error:', err)
    twiml.say('Sorry, something went wrong. Please try again.')
    return sendTwiml(res, twiml)
  }
}

// ─── Node Handlers ────────────────────────────────────────────────────────────

function serveTrunkIntro(twiml, res) {
  // Play welcome audio then redirect to trunk menu
  twiml.redirect(`/api/call?node=trunk_menu`)
  return sendTwiml(res, twiml)
}

function serveAudioNode(twiml, res, node) {
  if (node.audio_url) {
    twiml.play(node.audio_url)
  }
  // If there's a next auto-play node, go there; otherwise prompt
  if (node.auto_next_node) {
    twiml.redirect(`/api/call?node=${node.auto_next_node}`)
  } else {
    addMainMenuPrompt(twiml)
  }
  return sendTwiml(res, twiml)
}

async function serveMenuNode(twiml, res, node, digit, callSid) {
  // Track last menu visited for 0 (back) key
  await updateLastMenu(callSid, node.id)

  // If a digit was pressed, find the matching path
  if (digit && digit !== '#') {
    const { data: path } = await supabase
      .from('paths')
      .select('*')
      .eq('from_node_id', node.id)
      .eq('key', digit)
      .single()

    if (path?.to_node_id) {
      twiml.redirect(`/api/call?node=${path.to_node_id}`)
      return sendTwiml(res, twiml)
    }
  }

  // # key — go to about node
  if (digit === '#' && node.about_node_id) {
    twiml.redirect(`/api/call?node=${node.about_node_id}`)
    return sendTwiml(res, twiml)
  }

  // Play menu audio and gather input
  const gather = twiml.gather({
    numDigits: 2,
    timeout: 10,
    action: `/api/call?node=${node.id}`,
    method: 'POST',
  })

  if (node.audio_url) {
    gather.play(node.audio_url)
  }

  // Timeout fallback — replay menu
  twiml.redirect(`/api/call?node=${node.id}`)
  return sendTwiml(res, twiml)
}

async function servePlaylistNode(twiml, res, node, digit, query) {
  const trackIndex = parseInt(query.track || '0', 10)
  const tracks = node.playlist_tracks || []

  if (!tracks.length) {
    twiml.say('This playlist has no tracks yet.')
    addMainMenuPrompt(twiml)
    return sendTwiml(res, twiml)
  }

  // * key skips to next track
  const nextIndex = digit === '*' ? trackIndex + 1 : trackIndex

  // Loop if enabled, otherwise end
  if (nextIndex >= tracks.length) {
    if (node.loop) {
      twiml.redirect(`/api/call?node=${node.id}&track=0`)
    } else {
      addMainMenuPrompt(twiml)
    }
    return sendTwiml(res, twiml)
  }

  const currentTrack = tracks[nextIndex]

  const gather = twiml.gather({
    numDigits: 1,
    timeout: 999,
    action: `/api/call?node=${node.id}&track=${nextIndex + 1}`,
    method: 'POST',
  })

  gather.play(currentTrack.audio_url)

  // Auto-advance to next track
  twiml.redirect(`/api/call?node=${node.id}&track=${nextIndex + 1}`)
  return sendTwiml(res, twiml)
}

function serveLeaveMessageNode(twiml, res, node, callSid) {
  if (node.audio_url) {
    twiml.play(node.audio_url)
  } else {
    twiml.say('Please leave your message after the tone. Press any key when done.')
  }

  twiml.record({
    action: `/api/recording?callSid=${callSid}&nodeId=${node.id}`,
    method: 'POST',
    maxLength: 120,
    playBeep: true,
    transcribe: false,
  })

  return sendTwiml(res, twiml)
}

function serveReturnNode(twiml, res, node, digit) {
  if (digit === '1' && node.project_node_id) {
    twiml.redirect(`/api/call?node=${node.project_node_id}`)
  } else {
    redirectToTrunk(twiml, res)
    return
  }
  return sendTwiml(res, twiml)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function redirectToTrunk(twiml, res) {
  twiml.redirect(`/api/call?node=trunk_menu`)
  return sendTwiml(res, twiml)
}

async function redirectToLastMenu(twiml, res, callSid) {
  const { data } = await supabase
    .from('call_sessions')
    .select('last_menu_node_id')
    .eq('call_sid', callSid)
    .single()

  const nodeId = data?.last_menu_node_id || 'trunk_menu'
  twiml.redirect(`/api/call?node=${nodeId}`)
  return sendTwiml(res, twiml)
}

function addMainMenuPrompt(twiml) {
  const gather = twiml.gather({
    numDigits: 2,
    timeout: 10,
    action: `/api/call?node=trunk_menu`,
    method: 'POST',
  })
  gather.say('Press 0 0 to return to the main menu.')
  twiml.redirect(`/api/call?node=trunk_menu`)
}

async function updateLastMenu(callSid, nodeId) {
  await supabase.from('call_sessions').upsert(
    { call_sid: callSid, last_menu_node_id: nodeId, updated_at: new Date().toISOString() },
    { onConflict: 'call_sid' }
  )
}

async function logCallEvent(callSid, nodeId, digit) {
  if (!callSid) return
  await supabase.from('call_events').insert({
    call_sid: callSid,
    node_id: nodeId,
    digit_pressed: digit,
    created_at: new Date().toISOString(),
  })
}

function sendTwiml(res, twiml) {
  res.setHeader('Content-Type', 'text/xml')
  res.status(200).send(twiml.toString())
}
