import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import path from 'path'
import type { BaileysEventEmitter } from '@whiskeysockets/baileys'

interface Contact {
  number: string
  name: string
}

interface ContactStore {
  contacts: Record<string, Contact>
  excludes: string[]
}

const dir = path.resolve('auth_private')
const FILE = path.join(dir, 'contacts.json')

let store: ContactStore = { contacts: {}, excludes: [] }
let saveTimer: NodeJS.Timeout | null = null
const lidToPn: Record<string, string> = {}

function load() {
  try {
    store = JSON.parse(readFileSync(FILE, 'utf-8'))
    if (!store.contacts) store.contacts = {}
    if (!store.excludes) store.excludes = []
  } catch {
    store = { contacts: {}, excludes: [] }
  }
}

function save() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    mkdirSync(dir, { recursive: true })
    writeFileSync(FILE, JSON.stringify(store, null, 2))
  }, 500)
}

function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  mkdirSync(dir, { recursive: true })
  writeFileSync(FILE, JSON.stringify(store, null, 2))
}

function jidToNumber(jid: string): string | null {
  if (!jid) return null
  if (jid.endsWith('@g.us')) return null
  const raw = jid.split('@')[0].split(':')[0]
  if (!/^\d+$/.test(raw)) return null
  if (jid.endsWith('@lid')) {
    return lidToPn[raw] || null
  }
  return raw
}

function upsertContact(jid: string, name?: string | null) {
  const num = jidToNumber(jid)
  if (!num) return
  const cur = store.contacts[num]
  const nm = (name || '').trim()
  if (!cur) {
    store.contacts[num] = { number: num, name: nm }
    console.log(`[contacts] +new ${num} "${nm}" (total: ${Object.keys(store.contacts).length})`)
    save()
  } else if (nm && nm !== cur.name) {
    cur.name = nm
    save()
  }
}

export function bindContacts(ev: BaileysEventEmitter) {
  ev.on('contacts.upsert', (cs) => {
    for (const c of cs) upsertContact(c.id, c.name || c.notify || c.verifiedName)
  })
  ev.on('contacts.update', (cs) => {
    for (const c of cs) {
      if (c.id) upsertContact(c.id, c.name || c.notify || c.verifiedName)
    }
  })
  ev.on('messaging-history.set', ({ contacts, chats }) => {
    for (const c of contacts) upsertContact(c.id, c.name || c.notify || c.verifiedName)
    if (chats) {
      for (const c of chats) {
        if (c.id && !c.id.endsWith('@g.us')) upsertContact(c.id, c.name)
      }
    }
  })
  ev.on('chats.upsert', (cs) => {
    for (const c of cs) {
      if (c.id && !c.id.endsWith('@g.us')) upsertContact(c.id, c.name)
    }
  })
  ev.on('messages.upsert', ({ messages }) => {
    for (const m of messages) {
      const remote = m.key.remoteJid
      if (!remote || remote.endsWith('@g.us')) continue
      upsertContact(remote, m.pushName)
    }
  })
}

export function isExcluded(jid: string): boolean {
  const num = jidToNumber(jid)
  if (!num) return false
  return store.excludes.includes(num)
}

export function searchContacts(q: string, limit = 20): Contact[] {
  const query = q.trim().toLowerCase()
  if (!query) return []
  const all = Object.values(store.contacts)
  const matches = all.filter(c =>
    c.number.includes(query) || c.name.toLowerCase().includes(query)
  )
  matches.sort((a, b) => {
    const an = a.name ? 0 : 1
    const bn = b.name ? 0 : 1
    if (an !== bn) return an - bn
    return a.name.localeCompare(b.name)
  })
  return matches.slice(0, limit)
}

export function listExcludes(): Contact[] {
  return store.excludes.map(num => ({
    number: num,
    name: store.contacts[num]?.name || '',
  }))
}

export function addExclude(number: string): boolean {
  const num = number.replace(/\D/g, '')
  if (!num || store.excludes.includes(num)) return false
  store.excludes.push(num)
  saveNow()
  return true
}

export function removeExclude(number: string): boolean {
  const num = number.replace(/\D/g, '')
  const i = store.excludes.indexOf(num)
  if (i < 0) return false
  store.excludes.splice(i, 1)
  saveNow()
  return true
}

function scanAuthDirs() {
  const cwd = process.cwd()
  const candidates = readdirSync(cwd).filter(d => d.startsWith('auth_'))
  let added = 0
  let mapped = 0
  for (const ad of candidates) {
    const adPath = path.join(cwd, ad)
    let files: string[]
    try { files = readdirSync(adPath) } catch { continue }
    for (const f of files) {
      if (!f.startsWith('lid-mapping-')) continue
      const m = f.match(/^lid-mapping-(\d+)(_reverse)?\.json$/)
      if (!m) continue
      const id = m[1]
      const isReverse = !!m[2]
      let raw: string
      try { raw = readFileSync(path.join(adPath, f), 'utf-8').trim() } catch { continue }
      const val = raw.replace(/^"|"$/g, '').replace(/\D/g, '')
      if (!val || val.length < 8) continue
      if (isReverse) {
        // file: lid-mapping-{LID}_reverse.json  -> content: PN
        if (!lidToPn[id]) { lidToPn[id] = val; mapped++ }
        if (!store.contacts[val]) {
          store.contacts[val] = { number: val, name: '' }
          added++
        }
      } else {
        // file: lid-mapping-{PN}.json -> content: LID
        if (!lidToPn[val]) { lidToPn[val] = id; mapped++ }
        if (!store.contacts[id]) {
          store.contacts[id] = { number: id, name: '' }
          added++
        }
      }
    }
  }
  if (added > 0 || mapped > 0) {
    console.log(`[contacts] scanned auth dirs: +${added} numbers, +${mapped} LID mappings (total contacts: ${Object.keys(store.contacts).length})`)
    saveNow()
  }
  // cleanup: remove contacts where the number is actually a LID (we have it mapped to a PN)
  let removed = 0
  for (const num of Object.keys(store.contacts)) {
    if (lidToPn[num]) {
      delete store.contacts[num]
      removed++
    }
  }
  if (removed > 0) {
    console.log(`[contacts] cleanup: removed ${removed} LID-only entries`)
    saveNow()
  }
}

load()
scanAuthDirs()
