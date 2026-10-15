'use strict'
/**
 * ADAPTADOR DE DATOS DE MERCADO (API especializada inmobiliaria/financiera).
 * Hoy devuelve null si no hay DATOS_API_URL + DATOS_API_KEY.
 * Cuando contrates un proveedor (valoración AVM, precios €/m² por zona,
 * Catastro, índices de alquiler, tipos Euríbor…), SOLO tienes que adaptar
 * esta función: devuelve un objeto JSON pequeño y el agente lo recibe
 * automáticamente como contexto en cada pregunta (Claude y ChatGPT).
 */
module.exports.obtenerDatosMercado = async function ({ ubicacion, m2 } = {}) {
  const base = process.env.DATOS_API_URL
  const key = process.env.DATOS_API_KEY
  if (!base || !key || !ubicacion) return null
  const url = `${base.replace(/\/$/, '')}/mercado?ubicacion=${encodeURIComponent(ubicacion)}${m2 ? `&m2=${m2}` : ''}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) })
  if (!r.ok) return null
  return await r.json()
}
