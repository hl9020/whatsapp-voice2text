import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'

interface PersistedState {
  sessions: Record<string, boolean>
  enableGroups: boolean
}

const stateDir = path.resolve('auth_private')
const STATE_FILE = path.join(stateDir, 'state.json')

export function loadState(): PersistedState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
  } catch {
    return { sessions: {}, enableGroups: false }
  }
}

export function saveState(state: PersistedState) {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}
