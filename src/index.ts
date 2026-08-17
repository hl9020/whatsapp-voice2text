import { config } from './config.js'
import { registerSession, initSessions, enableSessionByName } from './wa.js'
import { startDashboard } from './dashboard.js'
import { loadState } from './state.js'
import { startMonitor } from './notify.js'
import path from 'path'

const sessionDefs = [
  { name: 'private', authDir: path.resolve('auth_private') },
  { name: 'business', authDir: path.resolve('auth_business') },
]

async function main() {
  console.log('WA Voice2Text starting...')
  startDashboard(config.dashboardPort)

  for (const s of sessionDefs) {
    registerSession(s.name, s.authDir)
  }
  initSessions()

  // Restore previous state
  const saved = loadState()
  config.enableGroups = saved.enableGroups
  for (const [name, enabled] of Object.entries(saved.sessions)) {
    if (enabled) {
      console.log(`[${name}] auto-enabling from saved state`)
      enableSessionByName(name)
    }
  }

  console.log('Ready - manage sessions via dashboard')
  startMonitor()
}

main().catch(console.error)
