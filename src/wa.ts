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
import { readdirSync, statSync, unlinkSync } from 'fs'
import path from 'path'
import { config } from './config.js'
import { uploadAudio, transcribe } from './gladia.js'
import { updateSession, addLog, setSessionToggleHandler } from './dashboard.js'
import { bindContacts, isExcluded, peerJid, toNumber } from './contacts.js'

async function handleAudioMessage(sock: WASocket, msg: WAMessage, sessionName: string) {
  const audio = msg.message?.audioMessage
  if (!audio) return

  const jid = msg.key.remoteJid
  if (!jid) return
  const isGroup = jid.endsWith('@g.us')
  if (isGroup && !config.enableGroups) return
  const peer = peerJid(msg.key)
  if (!isGroup && isExcluded(peer)) return

  const tag = msg.key.fromMe ? 'outgoing' : 'incoming'
  const short = toNumber(peer) || peer.replace('@s.whatsapp.net', '')
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
  connecting: boolean
  retries: number
  reconnectTimer: NodeJS.Timeout | null
  watchdog: NodeJS.Timeout | null
  missedChecks: number
}

const handles = new Map<string, SessionHandle>()

const KEEP_PREKEYS = 1000
const PREKEY_MIN_AGE_MS = 14 * 24 * 3600 * 1000

function prunePreKeys(authDir: string, name: string) {
  let files: string[]
  try { files = readdirSync(authDir) } catch { return }
  const keys: { id: number; file: string }[] = []
  for (const f of files) {
    const m = f.match(/^pre-key-(\d+)\.json$/)
    if (m) keys.push({ id: Number(m[1]), file: f })
  }
  if (keys.length <= KEEP_PREKEYS) return
  keys.sort((a, b) => b.id - a.id)
  const cutoff = Date.now() - PREKEY_MIN_AGE_MS
  let removed = 0
  for (const k of keys.slice(KEEP_PREKEYS)) {
    const p = path.join(authDir, k.file)
    try {
      if (statSync(p).mtimeMs > cutoff) continue
      unlinkSync(p)
      removed++
    } catch {}
  }
  if (removed) console.log(`[${name}] pruned ${removed} old pre-keys (${keys.length} -> ${keys.length - removed})`)
}

function scheduleReconnect(h: SessionHandle) {
  if (h.stop || h.reconnectTimer) return
  const delay = Math.min(5000 * 2 ** h.retries, 60000)
  h.retries++
  console.log(`[${h.name}] reconnecting in ${delay / 1000}s (try ${h.retries})...`)
  addLog(h.name, 'disconnected - reconnecting...')
  h.reconnectTimer = setTimeout(() => {
    h.reconnectTimer = null
    connectSession(h)
  }, delay)
}

function isSocketAlive(h: SessionHandle): boolean {
  const ws = h.sock?.ws as { isOpen?: boolean; socket?: { readyState?: number } } | undefined
  if (!ws) return false
  if (typeof ws.isOpen === 'boolean') return ws.isOpen
  return ws.socket?.readyState === 1
}

function startWatchdog(h: SessionHandle) {
  if (h.watchdog) return
  h.watchdog = setInterval(() => {
    if (h.stop) return
    if (h.connecting || h.reconnectTimer) return
    if (isSocketAlive(h)) { h.missedChecks = 0; return }
    h.missedChecks++
    if (h.missedChecks < 2) return
    console.log(`[${h.name}] watchdog: socket dead, forcing reconnect`)
    addLog(h.name, 'watchdog - forcing reconnect')
    try { h.sock?.end(undefined) } catch {}
    h.sock = null
    h.missedChecks = 0
    scheduleReconnect(h)
  }, 30000)
}

async function connectSession(h: SessionHandle) {
  if (h.stop) return
  prunePreKeys(h.authDir, h.name)
  const { state, saveCreds } = await useMultiFileAuthState(h.authDir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }) as unknown as pino.Logger),
    },
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false,
    logger: pino({ level: 'silent' }) as unknown as pino.Logger,
    markOnlineOnConnect: false,
    keepAliveIntervalMs: 25000,
  })
  h.sock = sock
  h.connecting = true

  bindContacts(sock.ev)

  sock.ev.process(async (events) => {
    if (events['creds.update']) await saveCreds()

    if (events['connection.update']) {
      const { connection, lastDisconnect, qr } = events['connection.update']

      if (qr) {
        console.log(`[${h.name}] QR ready - scan via dashboard`)
        updateSession(h.name, { status: 'waiting_qr', qr })
      }

      if (connection === 'open') {
        console.log(`[${h.name}] connected!`)
        h.connecting = false
        h.retries = 0
        h.missedChecks = 0
        sock.sendPresenceUpdate('unavailable')
        updateSession(h.name, { status: 'connected', qr: undefined })
        addLog(h.name, 'connected')
        startWatchdog(h)
      }

      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode
        h.connecting = false
        updateSession(h.name, { status: 'disconnected', qr: undefined })
        if (!h.stop && code !== DisconnectReason.loggedOut) {
          scheduleReconnect(h)
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
  const h: SessionHandle = {
    name, authDir, sock: null, stop: true,
    connecting: false, retries: 0, reconnectTimer: null, watchdog: null, missedChecks: 0,
  }
  handles.set(name, h)
  updateSession(name, { status: 'disabled', enabled: false })
}

function enableSession(name: string) {
  const h = handles.get(name)
  if (!h || !h.stop) return
  h.stop = false
  h.retries = 0
  updateSession(name, { enabled: true, status: 'disconnected' })
  console.log(`[${name}] starting...`)
  connectSession(h)
}

export { enableSession as enableSessionByName }

function disableSession(name: string) {
  const h = handles.get(name)
  if (!h || h.stop) return
  h.stop = true
  h.connecting = false
  if (h.reconnectTimer) { clearTimeout(h.reconnectTimer); h.reconnectTimer = null }
  if (h.watchdog) { clearInterval(h.watchdog); h.watchdog = null }
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
