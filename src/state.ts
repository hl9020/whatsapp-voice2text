import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs'
import path from 'path'

interface PersistedState {
  sessions: Record<string, boolean>
  enableGroups: boolean
}

export const dataDir = path.resolve('data')
const STATE_FILE = path.join(dataDir, 'state.json')

export function migrateFromAuthDir(name: string) {
  const target = path.join(dataDir, name)
  const legacy = path.resolve('auth_private', name)
  if (existsSync(target) || !existsSync(legacy)) return
  mkdirSync(dataDir, { recursive: true })
  copyFileSync(legacy, target)
  console.log(`[data] migrated ${name} from auth_private`)
}

export function loadState(): PersistedState {
  migrateFromAuthDir('state.json')
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
  } catch {
    return { sessions: {}, enableGroups: false }
  }
}

export function saveState(state: PersistedState) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}
