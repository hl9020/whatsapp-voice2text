import 'dotenv/config'

interface Config {
  gladiaApiKey: string
  dashboardToken: string
  dashboardPort: number
  enableGroups: boolean
  logLevel: string
  transcriptLabel: string
  smtp: {
    host: string
    port: number
    user: string
    pass: string
    from: string
    to: string
    ssl: boolean
  }
  alertAfterMin: number
}

export const config: Config = {
  gladiaApiKey: process.env.GLADIA_API_KEY || '',
  dashboardToken: process.env.DASHBOARD_TOKEN || '',
  dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3000'),
  enableGroups: false,
  logLevel: process.env.LOG_LEVEL || 'info',
  transcriptLabel: process.env.TRANSCRIPT_LABEL || 'Transcript',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '465'),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    to: process.env.SMTP_TO || '',
    ssl: (process.env.SMTP_TLS || 'ssl') === 'ssl',
  },
  alertAfterMin: parseInt(process.env.ALERT_AFTER_MIN || '10'),
}

if (!config.gladiaApiKey) {
  console.error('GLADIA_API_KEY missing in .env')
  process.exit(1)
}
