import nodemailer from 'nodemailer'
import { config } from './config.js'
import { listSessions, addLog } from './dashboard.js'

let transport: nodemailer.Transporter | null = null

function mailer() {
  const s = config.smtp
  if (!s.host || !s.user || !s.pass || !s.to) return null
  if (!transport) {
    transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.ssl,
      auth: { user: s.user, pass: s.pass },
    })
  }
  return transport
}

export async function sendAlert(subject: string, text: string) {
  const t = mailer()
  if (!t) return
  try {
    await t.sendMail({ from: config.smtp.from, to: config.smtp.to, subject, text })
    console.log(`[alert] mail sent: ${subject}`)
  } catch (err) {
    console.error('[alert] mail failed:', err instanceof Error ? err.message : err)
  }
}

const downSince = new Map<string, number>()
const alerted = new Set<string>()

function check() {
  const now = Date.now()
  const limit = config.alertAfterMin * 60000
  for (const s of listSessions()) {
    if (!s.enabled) { downSince.delete(s.name); alerted.delete(s.name); continue }
    if (s.status === 'connected') {
      if (alerted.has(s.name)) {
        alerted.delete(s.name)
        addLog(s.name, 'wieder verbunden - Entwarnung gesendet')
        sendAlert(`WA Voice2Text: ${s.name} wieder verbunden`, `Session ${s.name} ist seit ${new Date().toLocaleString('de-AT')} wieder verbunden.`)
      }
      downSince.delete(s.name)
      continue
    }
    const since = downSince.get(s.name) ?? now
    downSince.set(s.name, since)
    if (now - since < limit || alerted.has(s.name)) continue
    alerted.add(s.name)
    const mins = Math.round((now - since) / 60000)
    addLog(s.name, 'Alarm-Mail gesendet')
    sendAlert(
      `WA Voice2Text: ${s.name} seit ${mins} min getrennt`,
      `Session: ${s.name}\nStatus: ${s.status}\nGetrennt seit: ${new Date(since).toLocaleString('de-AT')}\n\nDashboard: https://whatsapp-voice2text.app.y7services.at\nBei Status waiting_qr muss neu gescannt werden.`
    )
  }
}

export function startMonitor() {
  if (!mailer()) {
    console.log('[alert] SMTP nicht konfiguriert - Monitor aus')
    return
  }
  console.log(`[alert] Monitor aktiv (Alarm nach ${config.alertAfterMin} min)`)
  setInterval(check, 60000)
}
