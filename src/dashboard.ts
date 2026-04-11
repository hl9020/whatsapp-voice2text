import express from 'express'
import QRCode from 'qrcode'
import { config } from './config.js'
import { loadState, saveState } from './state.js'

interface SessionState {
  status: 'waiting_qr' | 'connected' | 'disconnected' | 'disabled'
  qr?: string
  enabled: boolean
}

interface LogEntry {
  time: string
  session: string
  text: string
}

const sessions = new Map<string, SessionState>()
const logs: LogEntry[] = []
const MAX_LOGS = 50
let onSessionToggle: ((name: string, enable: boolean) => void) | null = null

export function setSessionToggleHandler(handler: (name: string, enable: boolean) => void) {
  onSessionToggle = handler
}

export function updateSession(name: string, state: Partial<SessionState>) {
  const cur = sessions.get(name) || { status: 'disabled' as const, enabled: false }
  sessions.set(name, { ...cur, ...state })
}

export function addLog(session: string, text: string) {
  const time = new Date().toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  logs.unshift({ time, session, text })
  if (logs.length > MAX_LOGS) logs.pop()
}

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = config.dashboardToken
  if (!token) return next()
  const q = req.query.token as string
  const h = req.headers.authorization
  if (q === token || h === `Bearer ${token}`) return next()
  res.status(401).send('Unauthorized - add ?token=YOUR_TOKEN')
}

export function startDashboard(port: number) {
  const app = express()
  app.use(auth)

  app.get('/', (_req, res) => {
    const tk = config.dashboardToken
    res.send(`<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WA Voice2Text</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui;background:#0a0a0a;color:#e5e5e5;padding:24px;max-width:800px;margin:0 auto}
h1{font-size:1.5rem;margin-bottom:24px;color:#fff}
.card{background:#1a1a1a;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #333}
.row{display:flex;align-items:center;justify-content:space-between}
.status{display:inline-block;padding:4px 12px;border-radius:20px;font-size:.85rem;font-weight:600}
.connected{background:#052e16;color:#4ade80;border:1px solid #166534}
.waiting_qr{background:#422006;color:#fb923c;border:1px solid #9a3412}
.disconnected{background:#1c1917;color:#a8a29e;border:1px solid #44403c}
.disabled{background:#1c1917;color:#525252;border:1px solid #333}
.connecting{background:#172554;color:#60a5fa;border:1px solid #1e40af}
.qr{text-align:center;margin:16px 0}
.qr img{border-radius:8px;background:#fff;padding:12px}
.logs{background:#1a1a1a;border-radius:12px;padding:20px;border:1px solid #333}
.log{padding:6px 0;border-bottom:1px solid #262626;font-size:.85rem;font-family:monospace}
.log-time{color:#737373}.log-session{color:#60a5fa}.log-text{color:#d4d4d4}
h2{font-size:1.1rem;margin-bottom:12px;color:#a3a3a3}
.toggle{position:relative;width:48px;height:26px;cursor:pointer}
.toggle input{opacity:0;width:0;height:0}
.slider{position:absolute;inset:0;background:#333;border-radius:13px;transition:.3s}
.slider:before{content:"";position:absolute;height:20px;width:20px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.3s}
.toggle input:checked+.slider{background:#4ade80}
.toggle input:checked+.slider:before{transform:translateX(22px)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.pulse{animation:pulse 1.5s infinite}
</style>
</head><body>
<h1>WA Voice2Text</h1>
<div id="app"></div>
<script>
const TK='${tk}';
const q=TK?'?token='+TK:'';
let pendingToggle={};
let lastData={sessions:{},enableGroups:false,logs:[]};

async function api(path,method='GET'){
  const r=await fetch(path+(path.includes('?')?'&':'?')+'token='+TK,{method});
  return r.json();
}

async function toggleSession(name,enable){
  pendingToggle[name]=enable?'connecting':'disabling';
  render(lastData);
  await api('/api/session?name='+name+'&enable='+enable,'POST');
  setTimeout(async()=>{
    delete pendingToggle[name];
    await poll();
  },1500);
}

async function toggleGroups(enable){
  await api('/api/groups?enable='+enable,'POST');
  poll();
}

function render(data){
  lastData=data;
  const s=data.sessions||{};
  const g=data.enableGroups||false;
  const l=data.logs||[];
  let h='';

  for(const[name,state]of Object.entries(s)){
    const st=state;
    const pending=pendingToggle[name];
    const status=pending||(st.status||'disabled');
    const checked=pending==='connecting'||st.enabled?'checked':'';
    const disabled=pending?'disabled':'';
    const statusClass=pending?'connecting':st.status;
    const statusText=status.replace('_',' ');
    h+='<div class="card"><div class="row">';
    h+='<div><strong>'+name+'</strong> ';
    h+='<span class="status '+statusClass+(pending?' pulse':'')+'">'+statusText+'</span></div>';
    h+='<label class="toggle"><input type="checkbox" '+checked+' '+disabled;
    h+=' onchange="toggleSession(\\\''+name+'\\\',this.checked)">';
    h+='<span class="slider"></span></label>';
    h+='</div>';

    if(st.enabled && st.qrDataUrl){
      h+='<div class="qr"><img src="'+st.qrDataUrl+'" alt="QR"></div>';
    }
    h+='</div>';
  }

  h+='<div class="card"><div class="row"><span>Group chats</span>';
  h+='<label class="toggle"><input type="checkbox" '+(g?'checked':'')+' onchange="toggleGroups(this.checked)">';
  h+='<span class="slider"></span></label></div></div>';

  h+='<div class="logs"><h2>Recent Transcriptions</h2>';
  if(!l.length) h+='<p style="color:#737373">No transcriptions yet...</p>';
  for(const e of l){
    h+='<div class="log"><span class="log-time">'+e.time+'</span> ';
    h+='<span class="log-session">['+e.session+']</span> ';
    h+='<span class="log-text">'+e.text+'</span></div>';
  }
  h+='</div>';
  document.getElementById('app').innerHTML=h;
}

async function poll(){
  try{
    const data=await api('/api/status');
    render(data);
  }catch(e){}
}
poll();
setInterval(poll,3000);
</script>
</body></html>`);
  })

  app.post('/api/session', (req, res) => {
    const name = req.query.name as string
    const enable = req.query.enable === 'true'
    if (!name || !sessions.has(name)) return res.status(400).json({ error: 'unknown session' })
    updateSession(name, { enabled: enable, status: enable ? 'disconnected' : 'disabled', qr: undefined })
    addLog('system', `${name} ${enable ? 'enabled' : 'disabled'}`)
    console.log(`[${name}] ${enable ? 'enabled' : 'disabled'}`)
    if (onSessionToggle) onSessionToggle(name, enable)
    const st = loadState()
    st.sessions[name] = enable
    saveState(st)
    res.json({ ok: true })
  })

  app.post('/api/groups', (req, res) => {
    config.enableGroups = req.query.enable === 'true'
    addLog('system', `Group chats ${config.enableGroups ? 'enabled' : 'disabled'}`)
    const st = loadState()
    st.enableGroups = config.enableGroups
    saveState(st)
    res.json({ enableGroups: config.enableGroups })
  })

  app.get('/api/status', async (_req, res) => {
    const out: Record<string, unknown> = {}
    for (const [name, state] of sessions) {
      let qrDataUrl: string | undefined
      if (state.enabled && state.status === 'waiting_qr' && state.qr) {
        qrDataUrl = await QRCode.toDataURL(state.qr, { width: 260, margin: 2 })
      }
      out[name] = { ...state, qr: undefined, qrDataUrl }
    }
    res.json({ sessions: out, enableGroups: config.enableGroups, logs: logs.slice(0, 20) })
  })

  app.listen(port, () => console.log(`Dashboard: http://localhost:${port}`))
}
