import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const allowedOrigins = new Set(['https://app.magemind.com.br','https://agenciamagemind.github.io','http://localhost:3000','http://127.0.0.1:3000'])

function cors(req: Request) {
  const origin = req.headers.get('origin') || ''
  return {'Access-Control-Allow-Origin':allowedOrigins.has(origin)?origin:'https://app.magemind.com.br','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Vary':'Origin','Cache-Control':'no-store'}
}
function ip(req: Request) { const value=req.headers.get('cf-connecting-ip')||req.headers.get('x-real-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||null; return value&&value.length<=64?value:null }
function agent(ua: string) {
  const browser=/Edg\//.test(ua)?'Edge':/OPR\//.test(ua)?'Opera':/CriOS|Chrome\//.test(ua)?'Chrome':/FxiOS|Firefox\//.test(ua)?'Firefox':/Safari\//.test(ua)?'Safari':'Outro'
  const operating_system=/iPhone|iPad|iPod/.test(ua)?'iOS':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Mac OS X|Macintosh/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'Outro'
  const device_type=/iPad|Tablet/.test(ua)?'Tablet':/Mobile|iPhone|Android/.test(ua)?'Celular':'Computador'
  return {browser,operating_system,device_type}
}
async function fingerprint(token: string) { const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)); return Array.from(new Uint8Array(d)).slice(0,12).map(b=>b.toString(16).padStart(2,'0')).join('') }

Deno.serve(async (req) => {
  const headers=cors(req)
  if(req.method==='OPTIONS') return new Response(null,{headers})
  const origin=req.headers.get('origin')||''
  if(origin&&!allowedOrigins.has(origin)) return new Response(JSON.stringify({error:'Origem não autorizada.'}),{status:403,headers})
  if(req.method!=='POST') return new Response(JSON.stringify({error:'Método não permitido.'}),{status:405,headers})
  if(Number(req.headers.get('content-length')||0)>8192) return new Response(JSON.stringify({error:'Requisição muito grande.'}),{status:413,headers})
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'')
  if(!token) return new Response(JSON.stringify({error:'Sessão ausente.'}),{status:401,headers})
  const auth=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}})
  const {data,error}=await auth.auth.getUser(token)
  if(error||!data.user) return new Response(JSON.stringify({error:'Sessão inválida.'}),{status:401,headers})
  let body:Record<string,unknown>={}
  try{body=await req.json()}catch{/* empty body is acceptable */}
  const event=String(body.eventType||'session_access')
  if(!['session_access','page_view','logout','access_denied'].includes(event)) return new Response(JSON.stringify({error:'Evento inválido.'}),{status:400,headers})
  const ua=(req.headers.get('user-agent')||'').slice(0,512)
  const parsed=agent(ua)
  const {error:insertError}=await service.from('security_access_logs').insert({
    user_id:data.user.id,email_snapshot:data.user.email||null,event_type:event,
    outcome:event==='access_denied'?'blocked':'success',risk_level:event==='access_denied'?'medium':'low',
    reason:String(body.reason||'').slice(0,300)||null,ip_address:ip(req),
    country_code:(req.headers.get('cf-ipcountry')||req.headers.get('cloudfront-viewer-country')||'').slice(0,8)||null,
    timezone:String(body.timezone||'').slice(0,80)||null,locale:String(body.locale||'').slice(0,35)||null,
    user_agent:ua||null,...parsed,session_fingerprint:await fingerprint(token),
    path:String(body.path||'/').slice(0,240),origin:origin.slice(0,240)||null,
    metadata:{visibilityState:String(body.visibilityState||'').slice(0,20)||null}
  })
  if(insertError){console.error(insertError.message);return new Response(JSON.stringify({error:'Falha ao registrar acesso.'}),{status:500,headers})}
  return new Response(JSON.stringify({ok:true}),{status:200,headers})
})
