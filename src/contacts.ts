import { readFileSync, writeFileSync, mkdirSync } from 'fs'
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
  const n = jid.split('@')[0].split(':')[0]
  return /^\d+$/.test(n) ? n : null
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
    console.log(`[contacts] event contacts.upsert (${cs.length})`)
    for (const c of cs) upsertContact(c.id, c.name || c.notify || c.verifiedName)
  })
  ev.on('contacts.update', (cs) => {
    console.log(`[contacts] event contacts.update (${cs.length})`)
    for (const c of cs) {
      if (c.id) upsertContact(c.id, c.name || c.notify || c.verifiedName)
    }
  })
  ev.on('messaging-history.set', ({ contacts, chats }) => {
    console.log(`[contacts] event messaging-history.set (contacts: ${contacts.length}, chats: ${chats?.length || 0})`)
    for (const c of contacts) upsertContact(c.id, c.name || c.notify || c.verifiedName)
    if (chats) {
      for (const c of chats) {
        if (c.id && !c.id.endsWith('@g.us')) upsertContact(c.id, c.name)
      }
    }
  })
  ev.on('chats.upsert', (cs) => {
    console.log(`[contacts] event chats.upsert (${cs.length})`)
    for (const c of cs) {
      if (c.id && !c.id.endsWith('@g.us')) upsertContact(c.id, c.name)
    }
  })
  ev.on('messages.upsert', ({ messages }) => {
    for (const m of messages) {
      const remote = m.key.remoteJid
      if (!remote || remote.endsWith('@g.us')) continue
      const jid = m.key.fromMe ? remote : remote
      upsertContact(jid, m.pushName)
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

load()
