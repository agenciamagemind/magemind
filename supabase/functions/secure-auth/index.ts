import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const allowedOrigins = new Set([
  'https://app.magemind.com.br',
  'https://agenciamagemind.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
])

function cors(req: Request) {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://app.magemind.com.br',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  }
}

function requestIp(req: Request) {
  const value = req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  return value && value.length <= 64 ? value : null
}

function parseAgent(value: string) {
  const browser = /Edg\//.test(value) ? 'Edge' : /OPR\//.test(value) ? 'Opera' :
    /CriOS|Chrome\//.test(value) ? 'Chrome' : /FxiOS|Firefox\//.test(value) ? 'Firefox' :
    /Safari\//.test(value) ? 'Safari' : 'Outro'
  const operatingSystem = /iPhone|iPad|iPod/.test(value) ? 'iOS' : /Android/.test(value) ? 'Android' :
    /Windows/.test(value) ? 'Windows' : /Mac OS X|Macintosh/.test(value) ? 'macOS' :
    /Linux/.test(value) ? 'Linux' : 'Outro'
  const deviceType = /iPad|Tablet/.test(value) ? 'Tablet' : /Mobile|iPhone|Android/.test(value) ? 'Celular' : 'Computador'
  return { browser, operatingSystem, deviceType }
}

async function fingerprint(token?: string | null) {
  if (!token) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function consume(key: string, limit: number, windowSeconds: number) {
  const { data, error } = await service.rpc('consume_security_rate_limit', {
    p_bucket_key: key.slice(0, 180), p_limit: limit, p_window_seconds: windowSeconds,
  })
  if (error) throw error
  return data?.[0] || { allowed: false, retry_after_seconds: windowSeconds }
}

async function logAccess(req: Request, entry: Record<string, unknown>) {
  const ua = (req.headers.get('user-agent') || '').slice(0, 512)
  const agent = parseAgent(ua)
  const { error } = await service.from('security_access_logs').insert({
    ip_address: requestIp(req),
    country_code: (req.headers.get('cf-ipcountry') || req.headers.get('cloudfront-viewer-country') || '').slice(0, 8) || null,
    user_agent: ua || null,
    browser: agent.browser,
    operating_system: agent.operatingSystem,
    device_type: agent.deviceType,
    origin: (req.headers.get('origin') || '').slice(0, 240) || null,
    ...entry,
  })
  if (error) console.error('security log insert failed', error.message)
}

Deno.serve(async (req) => {
  const headers = cors(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers })
  const origin = req.headers.get('origin') || ''
  if (origin && !allowedOrigins.has(origin)) return new Response(JSON.stringify({ error: 'Origem não autorizada.' }), { status: 403, headers })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Método não permitido.' }), { status: 405, headers })
  if (Number(req.headers.get('content-length') || 0) > 16_384) return new Response(JSON.stringify({ error: 'Requisição muito grande.' }), { status: 413, headers })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return new Response(JSON.stringify({ error: 'Dados inválidos.' }), { status: 400, headers }) }
  const action = String(body.action || '')
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254)
  const password = String(body.password || '')
  const timezone = String(body.timezone || '').slice(0, 80) || null
  const locale = String(body.locale || '').slice(0, 35) || null
  const path = String(body.path || '/').slice(0, 240)
  const ip = requestIp(req) || 'unknown'
  if (!['login', 'signup'].includes(action) || !email || !password || password.length > 128) {
    return new Response(JSON.stringify({ error: 'Confira os dados informados.' }), { status: 400, headers })
  }

  const limit = action === 'signup'
    ? await consume(`signup:ip:${ip}`, 5, 86400)
    : await consume(`login:ip:${ip}`, 30, 900)
  const emailLimit = action === 'signup'
    ? await consume(`signup:email:${email}`, 3, 86400)
    : await consume(`login:email:${email}`, 12, 900)
  if (!limit.allowed || !emailLimit.allowed) {
    const retry = Math.max(limit.retry_after_seconds || 0, emailLimit.retry_after_seconds || 0)
    await logAccess(req, { email_snapshot: email, event_type: 'rate_limited', outcome: 'blocked', risk_level: 'high', reason: 'Muitas tentativas em pouco tempo', timezone, locale, path })
    return new Response(JSON.stringify({ error: 'Muitas tentativas por aqui. Aguarde um pouco antes de tentar novamente.', retryAfter: retry }), { status: 429, headers: { ...headers, 'Retry-After': String(retry) } })
  }

  const auth = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  if (action === 'login') {
    const { data, error } = await auth.auth.signInWithPassword({ email, password })
    if (error || !data.user || !data.session) {
      await logAccess(req, { email_snapshot: email, event_type: 'login_failure', outcome: 'failure', risk_level: 'medium', reason: 'Credenciais recusadas', timezone, locale, path })
      return new Response(JSON.stringify({ error: error?.message?.includes('Email not confirmed') ? 'Confirme seu e-mail antes de entrar.' : 'E-mail ou senha incorretos.' }), { status: 401, headers })
    }
    await logAccess(req, { user_id: data.user.id, email_snapshot: data.user.email || email, event_type: 'login_success', outcome: 'success', risk_level: 'low', timezone, locale, path, session_fingerprint: await fingerprint(data.session.access_token) })
    return new Response(JSON.stringify({ session: data.session, user: data.user }), { status: 200, headers })
  }

  const name = String(body.name || '').trim().slice(0, 140)
  const phone = String(body.phone || '').replace(/\D/g, '').slice(0, 15)
  if (!name || phone.length < 10 || password.length < 8) return new Response(JSON.stringify({ error: 'Confira nome, WhatsApp e senha.' }), { status: 400, headers })
  const { data, error } = await auth.auth.signUp({ email, password, options: { data: { name, phone }, emailRedirectTo: 'https://app.magemind.com.br/' } })
  if (error || !data.user) {
    await logAccess(req, { email_snapshot: email, event_type: 'signup_failure', outcome: 'failure', risk_level: 'medium', reason: 'Cadastro recusado', timezone, locale, path })
    return new Response(JSON.stringify({ error: 'Não foi possível concluir o cadastro. Confira os dados ou faça login se o e-mail já estiver cadastrado.' }), { status: 400, headers })
  }
  await logAccess(req, { user_id: data.user.id, email_snapshot: data.user.email || email, event_type: 'signup_success', outcome: 'success', risk_level: 'low', timezone, locale, path, session_fingerprint: await fingerprint(data.session?.access_token) })
  return new Response(JSON.stringify({ session: data.session, user: data.user }), { status: 200, headers })
})
