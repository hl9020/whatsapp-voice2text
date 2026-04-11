import 'dotenv/config'

interface Config {
  gladiaApiKey: string
  dashboardToken: string
  dashboardPort: number
  enableGroups: boolean
  logLevel: string
}

export const config: Config = {
  gladiaApiKey: process.env.GLADIA_API_KEY || '',
  dashboardToken: process.env.DASHBOARD_TOKEN || '',
  dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3000'),
  enableGroups: false,
  logLevel: process.env.LOG_LEVEL || 'info',
}

if (!config.gladiaApiKey) {
  console.error('GLADIA_API_KEY missing in .env')
  process.exit(1)
}
