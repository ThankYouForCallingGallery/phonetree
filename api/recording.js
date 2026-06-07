/**
 * POST /api/recording
 *
 * Twilio calls this after a voicemail is recorded.
 * Downloads the recording from Twilio, uploads it to Backblaze B2,
 * logs it in Supabase, then redirects caller back to main menu.
 */

import twilio from 'twilio'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import b2, { BUCKET, PUBLIC_URL } from '../lib/b2.js'
import supabase from '../lib/supabase.js'

const VoiceResponse = twilio.twiml.VoiceResponse

export default async function handler(req, res) {
  const twiml = new VoiceResponse()

  try {
    const {
      RecordingUrl,
      RecordingDuration,
      CallSid,
    } = req.body

    const { callSid, nodeId } = req.query

    if (RecordingUrl) {
      // Fetch the recording from Twilio (add .mp3)
      const audioUrl = `${RecordingUrl}.mp3`
      const twilioResponse = await fetch(audioUrl, {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
          ).toString('base64')}`,
        },
      })

      if (twilioResponse.ok) {
        const audioBuffer = Buffer.from(await twilioResponse.arrayBuffer())

        // Upload to Backblaze B2
        const filename = `voicemails/${callSid || CallSid}-${Date.now()}.mp3`
        await b2.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: filename,
            Body: audioBuffer,
            ContentType: 'audio/mpeg',
          })
        )

        const publicFileUrl = `${PUBLIC_URL}/${filename}`

        // Log in Supabase
        await supabase.from('voicemails').insert({
          call_sid: callSid || CallSid,
          node_id: nodeId || null,
          audio_url: publicFileUrl,
          duration_seconds: parseInt(RecordingDuration || '0', 10),
          created_at: new Date().toISOString(),
        })
      }
    }

    // Return caller to main menu after leaving message
    twiml.say('Thank you for your message.')
    twiml.redirect('/api/call?node=trunk_menu')
  } catch (err) {
    console.error('Recording handler error:', err)
    twiml.say('Thank you.')
    twiml.redirect('/api/call?node=trunk_menu')
  }

  res.setHeader('Content-Type', 'text/xml')
  res.status(200).send(twiml.toString())
}
