import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
  WAMessage,
  Browsers,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import { config } from './config.js'
import { uploadAudio, transcribe } from './gladia.js'
import { updateSession, addLog, setSessionToggleHandler } from './dashboard.js'
import { bindContacts, isExcluded } from './contacts.js'

async function handleAudioMessage(sock: WASocket, msg: WAMessage, sessionName: string) {
  const audio = msg.message?.audioMessage
  if (!audio) return

  const jid = msg.key.remoteJid
  if (!jid) return
  if (jid.endsWith('@g.us') && !config.enableGroups) return
  if (!jid.endsWith('@g.us') && isExcluded(jid)) return

  const tag = msg.key.fromMe ? 'outgoing' : 'incoming'
  const short = jid.replace('@s.whatsapp.net', '')
  console.log(`[${sessionName}] ${tag} voice msg from ${short}`)
  addLog(sessionName, `${tag} voice from ${short} - transcribing...`)

  try {
    const buf = await downloadMediaMessage(msg, 'buffer', {}, {
      logger: pino({ level: 'silent' }) as unknown as pino.Logger,
      reuploadRequest: sock.updateMediaMessage,
    }) as Buffer

    const audioUrl = await uploadAudio(buf, 'voice.ogg')
    const text = await transcribe(audioUrl)

    if (text.trim()) {
      await sock.sendMessage(jid, { text: `*${config.transcriptLabel}:*\n${text}` }, { quoted: msg })
      const preview = text.length > 60 ? text.slice(0, 60) + '...' : text
      addLog(sessionName, `${short}: ${preview}`)
      console.log(`[${sessionName}] sent transcript to ${short}`)
    }
  } catch (err) {
    addLog(sessionName, `error: ${err instanceof Error ? err.message : String(err)}`)
    console.error(`[${sessionName}] error:`, err)
  }
}

interface SessionHandle {
  name: string
  authDir: string
  sock: WASocket | null
  stop: boolean
}

const handles = new Map<string, SessionHandle>()

async function connectSession(h: SessionHandle) {
  if (h.stop) return
  const { state, saveCreds } = await useMultiFileAuthState(h.authDir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }) as unknown as pino.Logger),
    },
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: true,
    fireInitQueries: true,
    logger: pino({ level: 'silent' }) as unknown as pino.Logger,
    markOnlineOnConnect: false,
  })
  h.sock = sock

  bindContacts(sock.ev)

  sock.ev.process(async (events) => {
    const eventNames = Object.keys(events)
    if (eventNames.length) console.log(`[${h.name}] events:`, eventNames.join(','))
    if (events['creds.update']) await saveCreds()

    if (events['connection.update']) {
      const { connection, lastDisconnect, qr } = events['connection.update']

      if (qr) {
        console.log(`[${h.name}] QR ready - scan via dashboard`)
        updateSession(h.name, { status: 'waiting_qr', qr })
      }

      if (connection === 'open') {
        console.log(`[${h.name}] connected!`)
        sock.sendPresenceUpdate('unavailable')
        updateSession(h.name, { status: 'connected', qr: undefined })
        addLog(h.name, 'connected')
      }

      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode
        updateSession(h.name, { status: 'disconnected', qr: undefined })
        if (!h.stop && code !== DisconnectReason.loggedOut) {
          console.log(`[${h.name}] reconnecting in 5s...`)
          addLog(h.name, 'disconnected - reconnecting...')
          setTimeout(() => connectSession(h), 5000)
        } else if (code === DisconnectReason.loggedOut) {
          addLog(h.name, 'logged out')
        }
      }
    }

    if (events['messages.upsert']) {
      const upsert = events['messages.upsert']
      if (upsert.type !== 'notify') return
      for (const msg of upsert.messages) {
        if (msg.message?.audioMessage) handleAudioMessage(sock, msg, h.name)
      }
    }
  })
}

export function registerSession(name: string, authDir: string) {
  const h: SessionHandle = { name, authDir, sock: null, stop: true }
  handles.set(name, h)
  updateSession(name, { status: 'disabled', enabled: false })
}

function enableSession(name: string) {
  const h = handles.get(name)
  if (!h || !h.stop) return
  h.stop = false
  updateSession(name, { enabled: true, status: 'disconnected' })
  console.log(`[${name}] starting...`)
  connectSession(h)
}

export { enableSession as enableSessionByName }

function disableSession(name: string) {
  const h = handles.get(name)
  if (!h || h.stop) return
  h.stop = true
  if (h.sock) { h.sock.end(undefined); h.sock = null }
  updateSession(name, { enabled: false, status: 'disabled', qr: undefined })
  console.log(`[${name}] stopped`)
}

export function initSessions() {
  setSessionToggleHandler((name, enable) => {
    if (enable) enableSession(name)
    else disableSession(name)
  })
}
