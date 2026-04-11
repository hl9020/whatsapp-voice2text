# whatsapp-voice2text

Automatically transcribe WhatsApp voice messages and reply with the text - powered by [Baileys](https://github.com/WhiskeySockets/Baileys) and [Gladia](https://www.gladia.io/) (EU-hosted Speech-to-Text).

## Features

- Transcribes incoming and outgoing voice messages
- Replies directly under the voice message (quoted)
- Supports two WhatsApp accounts (e.g. personal + business)
- Per-session enable/disable toggle via web dashboard
- Group chat transcription toggle
- Web dashboard with QR code display, session status, and live transcription log
- Token-based authentication for the dashboard
- Gladia: 100+ languages, EU-hosted, GDPR compliant, 10h/month free tier

## How it works

```
Voice message received
  -> Baileys detects audioMessage
  -> Downloads audio buffer
  -> Uploads to Gladia API (EU)
  -> Polls for transcription result
  -> Sends transcript as quoted reply
```

## Tech Stack

- Node.js 22 + TypeScript
- Baileys v7 (WhatsApp Web API via WebSocket)
- Gladia v2 API (async pre-recorded Speech-to-Text, EU-hosted)
- Express (dashboard)
- Docker multi-stage build

## Setup

### 1. Get a Gladia API Key

- Create a free account at https://app.gladia.io
- Copy your API key (10h/month free)

### 2. Configure environment

```bash
cp .env.example .env
# Set GLADIA_API_KEY and DASHBOARD_TOKEN
```

### 3. Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000?token=YOUR_TOKEN`, enable a session via toggle, scan the QR code.

### 4. Deploy with Docker

```bash
docker compose up -d
```

Enable sessions and scan QR codes via the web dashboard. Auth data persists in Docker volumes across restarts.

## Configuration

| Variable | Description | Default |
|---|---|---|
| `GLADIA_API_KEY` | Gladia API key (required) | - |
| `DASHBOARD_TOKEN` | Auth token for web dashboard | - |
| `DASHBOARD_PORT` | Dashboard port | `3000` |
| `LOG_LEVEL` | Pino log level | `info` |

Group chats and individual sessions can be toggled on/off via the dashboard without restart.

## License

MIT
