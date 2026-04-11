import { config } from './config.js'

const BASE = 'https://api.gladia.io/v2'
const hdrs = {
  'x-gladia-key': config.gladiaApiKey,
  'Content-Type': 'application/json',
}

interface GladiaUploadResponse {
  audio_url: string
  audio_metadata: { id: string; audio_duration: number }
}

interface GladiaUtterance {
  text: string
  language: string
  start: number
  end: number
}

interface GladiaResult {
  status: 'queued' | 'processing' | 'done' | 'error'
  result?: {
    transcription: {
      full_transcript: string
      utterances: GladiaUtterance[]
    }
  }
}

export async function uploadAudio(buf: Buffer, filename: string): Promise<string> {
  const form = new FormData()
  form.append('audio', new Blob([new Uint8Array(buf)]), filename)

  const res = await fetch(`${BASE}/upload`, {
    method: 'POST',
    headers: { 'x-gladia-key': config.gladiaApiKey },
    body: form,
  })

  if (!res.ok) throw new Error(`Gladia upload failed: ${res.status}`)
  const data = (await res.json()) as GladiaUploadResponse
  return data.audio_url
}

export async function transcribe(audioUrl: string): Promise<string> {
  const res = await fetch(`${BASE}/pre-recorded`, {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify({
      audio_url: audioUrl,
      detect_language: true,
    }),
  })

  if (!res.ok) throw new Error(`Gladia transcription start failed: ${res.status}`)
  const { result_url } = (await res.json()) as { id: string; result_url: string }

  // Poll for result
  for (let i = 0; i < 60; i++) {
    await sleep(2000)
    const poll = await fetch(result_url, { headers: { 'x-gladia-key': config.gladiaApiKey } })
    if (!poll.ok) continue
    const data = (await poll.json()) as GladiaResult

    if (data.status === 'done' && data.result) {
      return data.result.transcription.full_transcript
    }
    if (data.status === 'error') {
      throw new Error('Gladia transcription error')
    }
  }
  throw new Error('Gladia transcription timeout')
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}
