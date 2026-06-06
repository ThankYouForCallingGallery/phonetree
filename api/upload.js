/**
 * POST /api/upload
 *
 * Accepts an MP3 file upload from the editor, stores it in Backblaze B2,
 * and returns the public URL.
 *
 * Expects multipart/form-data with:
 *   - file: the MP3 file
 *   - projectId: the project this audio belongs to
 *   - nodeId: (optional) the node this audio belongs to
 */

import { PutObjectCommand } from '@aws-sdk/client-s3'
import b2, { BUCKET, PUBLIC_URL } from '../../lib/b2.js'
import busboy from 'busboy'

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { fileBuffer, filename, mimetype, fields } = await parseMultipart(req)

    // Validate it's an audio file
    if (!mimetype.startsWith('audio/')) {
      return res.status(400).json({ error: 'Only audio files are accepted' })
    }

    const projectId = fields.projectId || 'general'
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const key = `audio/${projectId}/${Date.now()}-${safeFilename}`

    // Upload to Backblaze B2
    await b2.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: fileBuffer,
        ContentType: mimetype,
      })
    )

    const publicUrl = `${PUBLIC_URL}/${key}`

    return res.status(200).json({
      success: true,
      url: publicUrl,
      key,
    })
  } catch (err) {
    console.error('Upload error:', err)
    return res.status(500).json({ error: 'Upload failed', details: err.message })
  }
}

// ─── Multipart Parser ─────────────────────────────────────────────────────────

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers })
    const fields = {}
    let fileBuffer = null
    let filename = null
    let mimetype = null

    bb.on('file', (fieldname, file, info) => {
      filename = info.filename
      mimetype = info.mimeType
      const chunks = []
      file.on('data', (chunk) => chunks.push(chunk))
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks)
      })
    })

    bb.on('field', (name, val) => {
      fields[name] = val
    })

    bb.on('finish', () => {
      if (!fileBuffer) return reject(new Error('No file received'))
      resolve({ fileBuffer, filename, mimetype, fields })
    })

    bb.on('error', reject)
    req.pipe(bb)
  })
}
