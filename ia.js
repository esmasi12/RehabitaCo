'use strict'
/**
 * RehabitaCo — Pasarela IA (Vercel Serverless)
 * POST /api/ia  { mode:'chat'|'vision', proveedor:'auto'|'anthropic'|'openai', ... }
 *  - chat   → respuesta en streaming SSE:  data: {"t":"texto"}  …  data: {"fin":true}
 *  - vision → JSON { informe:{…} } con el análisis del estado del inmueble
 * GET  /api/ia → { proveedores:[…], datosMercado:bool }
 * Las claves viven SOLO en variables de entorno de Vercel. Requiere sesión Supabase.
 */
const { obtenerDatosMercado } = require('./_datos')

const SYSTEM_BASE = `Eres el Agente Financiero e Inmobiliario de RehabitaCo (reformas, compraventa y alquiler en España).
Responde en español, claro y accionable; cifras clave en **negrita**.
Usa SOLO los datos del contexto. Si falta un dato, dilo y pide lo mínimo. Distingue hechos, estimaciones y suposiciones.
Las predicciones son probabilísticas (no garantías). No des asesoramiento fiscal/legal vinculante: indica cuándo consultar a un profesional.`

const VISION_PROMPT = `Eres perito de reformas en España. Analiza las fotos del inmueble para estimar su estado y el riesgo de sobrecoste de reforma.
Devuelve SOLO un JSON válido (sin markdown) con esta forma exacta:
{"puntuacion_estado":0-100 (100 = reformado/impecable),"nivel":"excelente|bueno|regular|malo|ruina","confianza":0-1,
"resumen":"2-3 frases","hallazgos":[{"zona":"","tipo":"humedad|estructura|electricidad|fontaneria|cubierta|carpinteria|suelos|paredes|cocina|bano|otros","severidad":1-5,"descripcion":"","coste_min_eur":0,"coste_max_eur":0}],
"reforma_eur_m2":{"min":0,"max":0},"riesgos_ocultos":[""],"recomendaciones":[""],"zonas_sin_fotografiar":[""]}
Reglas: no inventes lo que no se ve; con fotos pobres o pocas, baja la confianza; costes orientativos en euros (España, IVA incl.). Es una valoración visual, no una peritación.`

const MODELOS = {
  anthropic: () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  openai: () => process.env.OPENAI_MODEL || 'gpt-4o'
}

function disponibles () {
  const d = []
  if (process.env.ANTHROPIC_API_KEY) d.push('anthropic')
  if (process.env.OPENAI_API_KEY) d.push('openai')
  return d
}
function elegir (pedido, disp) {
  if (pedido && pedido !== 'auto' && disp.includes(pedido)) return pedido
  const pref = process.env.IA_PROVIDER
  if (pref && disp.includes(pref)) return pref
  return disp[0] || null
}

async function verificarUsuario (req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!token || !url || !key) return null
  const h = { Authorization: `Bearer ${token}`, apikey: key }
  const r = await fetch(`${url}/auth/v1/user`, { headers: h })
  if (!r.ok) return null
  const user = await r.json()
  const pr = await fetch(`${url}/rest/v1/perfiles?id=eq.${user.id}&select=activo`, { headers: h })
  const perfil = pr.ok ? (await pr.json())[0] : null
  return perfil && perfil.activo ? user : null
}

async function* lineas (body) {
  const dec = new TextDecoder(); let buf = ''
  for await (const ch of body) {
    buf += dec.decode(ch, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) { yield buf.slice(0, i).trim(); buf = buf.slice(i + 1) }
  }
  if (buf.trim()) yield buf.trim()
}
const sse = (res, o) => res.write('data: ' + JSON.stringify(o) + '\n\n')

async function llamar (prov, { system, messages, max, stream }) {
  const model = MODELOS[prov]()
  let r
  if (prov === 'anthropic') {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: max, system, messages, stream })
    })
  } else {
    r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_completion_tokens: max, stream, messages: [{ role: 'system', content: system }, ...messages] })
    })
  }
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`${prov} ${r.status}: ${t.slice(0, 300)}`)
  }
  return { r, model }
}

async function chat (b, prov, res) {
  let msgs = (Array.isArray(b.messages) ? b.messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 8000) }))
  while (msgs.length && msgs[0].role !== 'user') msgs.shift()
  if (!msgs.length) throw new Error('Mensaje vacío')

  let system = SYSTEM_BASE + '\n\nCONTEXTO DE LA CARTERA (datos reales del usuario):\n' + String(b.contexto || '').slice(0, 14000)
  try {
    const datos = await obtenerDatosMercado({ ubicacion: b.ubicacion, m2: b.m2 })
    if (datos) system += '\n\nDATOS DE MERCADO (API externa):\n' + JSON.stringify(datos).slice(0, 4000)
  } catch (_) { /* el agente sigue sin datos externos */ }

  const { r, model } = await llamar(prov, { system, messages: msgs, max: 1400, stream: true })
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' })
  for await (const l of lineas(r.body)) {
    if (!l.startsWith('data:')) continue
    const raw = l.slice(5).trim()
    if (!raw || raw === '[DONE]') continue
    let j; try { j = JSON.parse(raw) } catch (_) { continue }
    const t = prov === 'anthropic'
      ? (j.type === 'content_block_delta' ? j.delta && j.delta.text : '')
      : (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content)
    if (t) sse(res, { t })
  }
  sse(res, { fin: true, proveedor: prov, modelo: model })
  res.end()
}

async function vision (b, prov, res) {
  const imgs = (Array.isArray(b.images) ? b.images : []).slice(0, 6)
    .filter(i => i && /^image\/(jpeg|png|webp)$/.test(i.media_type) && typeof i.data === 'string')
  if (!imgs.length) throw new Error('Sin imágenes válidas')
  if (imgs.some(i => i.data.length > 2.2e6)) return res.status(413).json({ error: 'Imagen demasiado grande' })
  const c = b.contexto || {}
  const txt = VISION_PROMPT + `\nDatos: tipo=${c.tipo || '?'}, m2=${c.m2 || '?'}, dirección=${c.direccion || '?'}, etapa=${c.etapa || '?'}.`
  const content = prov === 'anthropic'
    ? [...imgs.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } })), { type: 'text', text: txt }]
    : [{ type: 'text', text: txt }, ...imgs.map(i => ({ type: 'image_url', image_url: { url: `data:${i.media_type};base64,${i.data}` } }))]
  const { r, model } = await llamar(prov, { system: 'Responde únicamente con JSON válido.', messages: [{ role: 'user', content }], max: 2200, stream: false })
  const data = await r.json()
  const texto = prov === 'anthropic' ? (data.content || []).map(x => x.text || '').join('') : data.choices[0].message.content
  const a = texto.indexOf('{'), z = texto.lastIndexOf('}')
  if (a < 0 || z < a) throw new Error('La IA no devolvió un informe válido')
  const limpio = texto.slice(a, z + 1).replace(/:\s*\.(\d)/g, ': 0.$1').replace(/,\s*([}\]])/g, '$1')
  res.status(200).json({ informe: JSON.parse(limpio), proveedor: prov, modelo: model })
}

const ORIGENES = ['capacitor://localhost', 'https://localhost', 'http://localhost', ...(process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)]

module.exports = async (req, res) => {
  const origen = req.headers.origin
  if (origen && ORIGENES.includes(origen)) {
    res.setHeader('Access-Control-Allow-Origin', origen); res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.status(204).end()
  try {
    const user = await verificarUsuario(req)
    if (!user) return res.status(401).json({ error: 'No autorizado: inicia sesión de nuevo' })
    const disp = disponibles()
    if (req.method === 'GET') return res.status(200).json({ proveedores: disp, datosMercado: !!(process.env.DATOS_API_URL && process.env.DATOS_API_KEY) })
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
    const b = req.body || {}
    const prov = elegir(b.proveedor, disp)
    if (!prov) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY u OPENAI_API_KEY en las variables de entorno de Vercel' })
    return b.mode === 'vision' ? await vision(b, prov, res) : await chat(b, prov, res)
  } catch (e) {
    if (!res.headersSent) return res.status(502).json({ error: String(e.message || e) })
    sse(res, { error: String(e.message || e) }); res.end()
  }
}
