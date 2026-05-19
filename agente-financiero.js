/**
 * ════════════════════════════════════════════════════════════
 *  RehabitaCo — Agente Financiero v2
 *  Fichero: agente-financiero.js
 *  Descripción: Motor de cálculo financiero inmobiliario.
 *  Se alimenta 100% de los datos ya introducidos en proyectos
 *  y gastos. Sin entrada manual adicional.
 * ════════════════════════════════════════════════════════════
 */

/* ──────────────────────────────────────────────────────────
   TABLA ITP POR COMUNIDAD AUTÓNOMA
   (fallback local si Supabase no responde)
────────────────────────────────────────────────────────── */
const ITP_LOCAL = {
  'Andalucía': 0.08, 'Aragón': 0.08, 'Asturias': 0.08,
  'Baleares': 0.08, 'Canarias': 0.065, 'Cantabria': 0.10,
  'Castilla - La Mancha': 0.09, 'Castilla León': 0.08,
  'Cataluña': 0.10, 'Ceuta': 0.06, 'Comunidad de Madrid': 0.06,
  'Comunidad Valenciana': 0.10, 'Extremadura': 0.08,
  'Galicia': 0.09, 'La Rioja': 0.07, 'Melilla': 0.06,
  'Murcia': 0.08, 'Navarra': 0.06, 'País Vasco': 0.04
}

export function getITP(comunidad) {
  return ITP_LOCAL[comunidad] ?? 0.08
}

/* ──────────────────────────────────────────────────────────
   MOTOR COMPRA-VENTA (flip)
   Fuentes de datos → tabla proyectos:
     precio, reforma, precio_venta, precio_venta_real,
     comunidad_autonoma, gastos_compra_extra, gastos_venta_extra,
     mobiliario, inicio, fin_est, fecha_venta, m2
   + tabla gastos (suma automática por proyecto)
────────────────────────────────────────────────────────── */
export function calcularCompraVenta(proyecto, gastosRegistrados = 0) {
  const {
    precio = 0,
    reforma = 0,
    precio_venta = 0,
    precio_venta_real = null,
    comunidad_autonoma = null,
    gastos_compra_extra = 0,
    gastos_venta_extra = 0,
    mobiliario = 0,
    inicio = null,
    fin_est = null,
    fecha_venta = null,
    m2 = null
  } = proyecto

  const pvFinal = precio_venta_real || precio_venta || 0
  const itp = precio * getITP(comunidad_autonoma)
  const totalCompra = precio + itp + reforma + (mobiliario || 0) + (gastos_compra_extra || 0)
  const totalGastosRegistrados = gastosRegistrados // suma de tabla gastos
  const inversionTotal = Math.max(totalCompra, totalGastosRegistrados > 0 ? totalGastosRegistrados + precio + itp : totalCompra)
  const beneficioNeto = pvFinal - inversionTotal - (gastos_venta_extra || 0)
  const roi = inversionTotal > 0 ? beneficioNeto / inversionTotal : 0
  const per = beneficioNeto > 0 && pvFinal > 0 ? pvFinal / beneficioNeto : null

  // Duración en meses
  const fechaInicio = inicio ? new Date(inicio) : null
  const fechaFin = fecha_venta ? new Date(fecha_venta) : (fin_est ? new Date(fin_est) : null)
  const mesesObra = (fechaInicio && fechaFin)
    ? Math.max(1, Math.round((fechaFin - fechaInicio) / (1000 * 60 * 60 * 24 * 30)))
    : null

  // ROI anualizado
  const roiAnualizado = (roi && mesesObra) ? roi / (mesesObra / 12) : null

  // Coste por m²
  const costePorM2 = m2 > 0 ? inversionTotal / m2 : null
  const pvPorM2 = (m2 > 0 && pvFinal > 0) ? pvFinal / m2 : null

  // Desglose de gastos por sector (de los gastos registrados)
  return {
    tipo: 'compraventa',
    // Inputs
    precioCompra: precio,
    itp,
    itpPct: getITP(comunidad_autonoma),
    reforma,
    mobiliario: mobiliario || 0,
    gastosCompraExtra: gastos_compra_extra || 0,
    gastosVentaExtra: gastos_venta_extra || 0,
    gastosRegistrados: totalGastosRegistrados,
    precioVentaProyectado: precio_venta || 0,
    precioVentaReal: precio_venta_real || null,
    pvFinal,
    // Calculados
    totalCompra,
    inversionTotal,
    beneficioNeto,
    roi,
    roiPct: roi * 100,
    per,
    mesesObra,
    roiAnualizado,
    roiAnualizadoPct: roiAnualizado ? roiAnualizado * 100 : null,
    costePorM2,
    pvPorM2,
    // Estado
    rentable: roi > 0,
    margenSeguridad: pvFinal > 0 ? ((pvFinal - inversionTotal) / pvFinal) * 100 : 0
  }
}

/* ──────────────────────────────────────────────────────────
   MOTOR ALQUILER
   Fuentes de datos → tabla proyectos:
     precio, reforma, mobiliario, comunidad_autonoma,
     hipoteca_importe, hipoteca_plazo, hipoteca_interes,
     alquiler_mensual, gastos_anuales_alq, revalorizacion_anual
────────────────────────────────────────────────────────── */
export function calcularAlquiler(proyecto, gastosRegistrados = 0) {
  const {
    precio = 0,
    reforma = 0,
    mobiliario = 0,
    comunidad_autonoma = null,
    hipoteca_importe = 0,
    hipoteca_plazo = 25,
    hipoteca_interes = 0.035,
    alquiler_mensual = 0,
    gastos_anuales_alq = 1500,
    revalorizacion_anual = 0.02,
    precio_venta = 0,
    m2 = null
  } = proyecto

  const itp = precio * getITP(comunidad_autonoma)
  const inversionTotal = precio + itp + (reforma || 0) + (mobiliario || 0)

  // Cuota hipotecaria mensual (amortización francesa)
  let cuotaMensual = 0
  let interesAnual = 0
  if (hipoteca_importe > 0 && hipoteca_plazo > 0 && hipoteca_interes > 0) {
    const r = hipoteca_interes / 12
    const n = hipoteca_plazo * 12
    cuotaMensual = hipoteca_importe > 0 ? hipoteca_importe * r / (1 - Math.pow(1 + r, -n)) : 0
    interesAnual = cuotaMensual * 12 - (hipoteca_importe / hipoteca_plazo)
  }

  const capitalPropio = inversionTotal - (hipoteca_importe || 0)
  const ingresoAnual = (alquiler_mensual || 0) * 12
  const gastosAnuales = gastos_anuales_alq || 1500
  const cashFlowMensual = (alquiler_mensual || 0) - cuotaMensual - (gastosAnuales / 12)
  const cashFlowAnual = cashFlowMensual * 12
  const revalorizacion = precio * (revalorizacion_anual || 0.02)

  // Rentabilidad bruta
  const rentBruta = precio > 0 ? ingresoAnual / precio : 0
  // Rentabilidad neta sobre inversión total (incluye revalorización)
  const rentNeta = inversionTotal > 0
    ? (cashFlowAnual + revalorizacion) / inversionTotal
    : 0
  // PER (ratio precio-alquiler)
  const per = ingresoAnual > 0 ? precio / ingresoAnual : null
  // Años para recuperar inversión
  const payback = cashFlowAnual > 0 ? inversionTotal / cashFlowAnual : null

  return {
    tipo: 'alquiler',
    // Inputs
    precioCompra: precio,
    itp,
    reforma: reforma || 0,
    mobiliario: mobiliario || 0,
    hipotecaImporte: hipoteca_importe || 0,
    hipotecaPlazo: hipoteca_plazo || 25,
    hipotecaInteres: hipoteca_interes || 0.035,
    alquilerMensual: alquiler_mensual || 0,
    gastosAnuales,
    // Calculados
    inversionTotal,
    capitalPropio,
    cuotaMensual,
    interesAnual,
    ingresoAnual,
    cashFlowMensual,
    cashFlowAnual,
    revalorizacion,
    rentBruta,
    rentBrutaPct: rentBruta * 100,
    rentNeta,
    rentNetaPct: rentNeta * 100,
    per,
    payback,
    costePorM2: m2 > 0 ? inversionTotal / m2 : null,
    alquilerPorM2: (m2 > 0 && alquiler_mensual > 0) ? alquiler_mensual / m2 : null,
    rentable: cashFlowAnual > 0
  }
}

/* ──────────────────────────────────────────────────────────
   AGENTE PROYECTO — análisis completo de 1 proyecto
   Combina motor correcto según tipo + gastos reales
────────────────────────────────────────────────────────── */
export function analizarProyecto(proyecto, gastos = [], fases = [], fasesCompletadas = []) {
  const totalGastos = gastos.reduce((s, g) => s + (g.coste || 0), 0)
  const gastosPorSector = gastos.reduce((acc, g) => {
    acc[g.sector] = (acc[g.sector] || 0) + (g.coste || 0)
    return acc
  }, {})

  const kpis = proyecto.tipo === 'alquiler'
    ? calcularAlquiler(proyecto, totalGastos)
    : calcularCompraVenta(proyecto, totalGastos)

  // Progreso de fases
  const totalFases = fases.length
  const fasesDone = fasesCompletadas.length
  const progresoPct = totalFases > 0 ? Math.round((fasesDone / totalFases) * 100) : 0

  // Desglose fases por sector
  const fasesPorSector = fases.reduce((acc, f) => {
    if (!acc[f.sector]) acc[f.sector] = { total: 0, done: 0 }
    acc[f.sector].total++
    if (fasesCompletadas.includes(f.id)) acc[f.sector].done++
    return acc
  }, {})

  // Desviación presupuestaria
  const presupuestoObra = (proyecto.reforma || 0)
  const gastoObra = gastosPorSector['obra'] || 0
  const desviacionObra = presupuestoObra > 0
    ? ((gastoObra - presupuestoObra) / presupuestoObra) * 100
    : null

  return {
    proyecto,
    kpis,
    totalGastos,
    gastosPorSector,
    progresoPct,
    fasesDone,
    totalFases,
    fasesPorSector,
    desviacionObra,
    // Helpers para gráficos
    chartDesglose: _chartDesglose(proyecto, kpis, gastosPorSector),
    chartGastosSector: _chartGastosSector(gastosPorSector),
    chartProgreso: _chartProgreso(fasesPorSector)
  }
}

/* ──────────────────────────────────────────────────────────
   AGENTE CARTERA — análisis global de todos los proyectos
────────────────────────────────────────────────────────── */
export function analizarCartera(proyectos, todosGastos, todasFases) {
  const total = proyectos.length
  if (!total) return _cartesVacia()

  // KPIs individuales de cada proyecto
  const analisisIndividual = proyectos.map(p => {
    const gastosProj = todosGastos.filter(g => g.proyecto_id === p.id)
    const fasesComp = (p.proyecto_fases || []).filter(f => f.done).map(f => f.fase_id)
    return analizarProyecto(p, gastosProj, todasFases, fasesComp)
  })

  // Inversión y retorno totales
  const inversionTotal = analisisIndividual.reduce((s, a) => s + (a.kpis.inversionTotal || 0), 0)
  const retornoTotal = analisisIndividual
    .filter(a => a.proyecto.estado === 'fin')
    .reduce((s, a) => s + (a.kpis.pvFinal || 0), 0)
  const beneficioTotal = analisisIndividual
    .filter(a => a.proyecto.estado === 'fin')
    .reduce((s, a) => s + (a.kpis.beneficioNeto || 0), 0)
  const roiMedio = analisisIndividual
    .filter(a => a.kpis.roi != null && a.proyecto.estado === 'fin')
    .reduce((s, a, _, arr) => s + a.kpis.roi / arr.length, 0)
  const gastoTotal = todosGastos.reduce((s, g) => s + (g.coste || 0), 0)

  // Por estado
  const porEstado = { neg: 0, ref: 0, act: 0, fin: 0 }
  proyectos.forEach(p => { porEstado[p.estado] = (porEstado[p.estado] || 0) + 1 })

  // Por tipo
  const porTipo = {}
  proyectos.forEach(p => { porTipo[p.tipo] = (porTipo[p.tipo] || 0) + 1 })

  // Comparativa de ROI por proyecto (solo con precio_venta definido)
  const comparativaROI = analisisIndividual
    .filter(a => a.kpis.inversionTotal > 0)
    .map(a => ({
      id: a.proyecto.id,
      nombre: a.proyecto.nombre,
      direccion: a.proyecto.direccion,
      tipo: a.proyecto.tipo,
      estado: a.proyecto.estado,
      inversion: a.kpis.inversionTotal,
      pvFinal: a.kpis.pvFinal || 0,
      beneficio: a.kpis.beneficioNeto || 0,
      roi: a.kpis.roi || 0,
      roiPct: a.kpis.roiPct || 0,
      rentNeta: a.kpis.rentNetaPct || null,
      gastos: a.totalGastos,
      progreso: a.progresoPct,
      m2: a.proyecto.m2
    }))
    .sort((a, b) => b.roi - a.roi)

  // Gastos por sector (cartera global)
  const gastosPorSectorGlobal = todosGastos.reduce((acc, g) => {
    acc[g.sector] = (acc[g.sector] || 0) + (g.coste || 0)
    return acc
  }, {})

  // Evolución temporal (por mes de inicio)
  const evolucionTemporal = _evolucionTemporal(proyectos)

  return {
    total,
    porEstado,
    porTipo,
    inversionTotal,
    retornoTotal,
    beneficioTotal,
    gastoTotal,
    roiMedio,
    roiMedioPct: roiMedio * 100,
    comparativaROI,
    gastosPorSectorGlobal,
    evolucionTemporal,
    analisisIndividual,
    // Helpers para gráficos
    chartCartera: _chartCartera(comparativaROI),
    chartEstados: _chartEstados(porEstado),
    chartSectoresGlobal: _chartSectoresGlobal(gastosPorSectorGlobal),
    chartEvolucion: _chartEvolucion(evolucionTemporal)
  }
}

/* ──────────────────────────────────────────────────────────
   HELPERS — preparación de datos para Chart.js
────────────────────────────────────────────────────────── */
const COLORS = {
  gold: '#D4A847', gold2: '#E8C46A', rust: '#C25C3A',
  sage: '#4E7C5A', sage2: '#6B9E78', sky: '#3A6EA8',
  lav: '#7A6EA8', dis: '#C25C8A', muted: '#9A8F80', red: '#DC4F4F'
}
const SECTOR_COLORS = {
  legal: COLORS.sky, arq: COLORS.lav, obra: COLORS.rust,
  elect: COLORS.gold, font: COLORS.sage, dis: COLORS.dis
}
const SECTOR_LABELS = {
  legal: '⚖️ Legal', arq: '📐 Arquitecto', obra: '🔨 Obra',
  elect: '⚡ Electricidad', font: '🔧 Fontanería', dis: '🎨 Diseño'
}

function _chartDesglose(proyecto, kpis, gastosPorSector) {
  // Donut: cómo se compone la inversión
  const labels = []
  const data = []
  const bg = []

  if (kpis.tipo === 'compraventa') {
    if (kpis.precioCompra > 0) { labels.push('Precio compra'); data.push(kpis.precioCompra); bg.push(COLORS.sky) }
    if (kpis.itp > 0) { labels.push('ITP'); data.push(kpis.itp); bg.push(COLORS.lav) }
    if (kpis.reforma > 0) { labels.push('Reforma'); data.push(kpis.reforma); bg.push(COLORS.rust) }
    if (kpis.mobiliario > 0) { labels.push('Mobiliario'); data.push(kpis.mobiliario); bg.push(COLORS.dis) }
    if (kpis.gastosCompraExtra > 0) { labels.push('Gastos compra'); data.push(kpis.gastosCompraExtra); bg.push(COLORS.gold) }
  } else {
    if (kpis.precioCompra > 0) { labels.push('Precio compra'); data.push(kpis.precioCompra); bg.push(COLORS.sky) }
    if (kpis.itp > 0) { labels.push('ITP'); data.push(kpis.itp); bg.push(COLORS.lav) }
    if (kpis.reforma > 0) { labels.push('Reforma'); data.push(kpis.reforma); bg.push(COLORS.rust) }
    if (kpis.mobiliario > 0) { labels.push('Mobiliario'); data.push(kpis.mobiliario); bg.push(COLORS.dis) }
  }
  return { labels, data, bg }
}

function _chartGastosSector(gastosPorSector) {
  const sectores = Object.keys(gastosPorSector).sort((a, b) => gastosPorSector[b] - gastosPorSector[a])
  return {
    labels: sectores.map(s => SECTOR_LABELS[s] || s),
    data: sectores.map(s => gastosPorSector[s]),
    bg: sectores.map(s => SECTOR_COLORS[s] || COLORS.muted)
  }
}

function _chartProgreso(fasesPorSector) {
  const sectores = Object.keys(fasesPorSector)
  return {
    labels: sectores.map(s => SECTOR_LABELS[s] || s),
    done: sectores.map(s => fasesPorSector[s].done),
    total: sectores.map(s => fasesPorSector[s].total),
    bg: sectores.map(s => SECTOR_COLORS[s] || COLORS.muted)
  }
}

function _chartCartera(comparativaROI) {
  return {
    labels: comparativaROI.map(p => p.nombre.length > 18 ? p.nombre.slice(0, 18) + '…' : p.nombre),
    inversion: comparativaROI.map(p => p.inversion),
    retorno: comparativaROI.map(p => p.pvFinal),
    gastos: comparativaROI.map(p => p.gastos),
    roi: comparativaROI.map(p => parseFloat(p.roiPct.toFixed(1)))
  }
}

function _chartEstados(porEstado) {
  const labels = { neg: 'Negociación', ref: 'En Reforma', act: 'En Venta', fin: 'Finalizado' }
  const bg = { neg: COLORS.muted, ref: COLORS.gold, act: COLORS.sage, fin: COLORS.sky }
  const keys = ['neg', 'ref', 'act', 'fin'].filter(k => porEstado[k] > 0)
  return {
    labels: keys.map(k => labels[k]),
    data: keys.map(k => porEstado[k]),
    bg: keys.map(k => bg[k])
  }
}

function _chartSectoresGlobal(gastosPorSectorGlobal) {
  const sectores = Object.keys(gastosPorSectorGlobal).sort((a, b) => gastosPorSectorGlobal[b] - gastosPorSectorGlobal[a])
  return {
    labels: sectores.map(s => SECTOR_LABELS[s] || s),
    data: sectores.map(s => gastosPorSectorGlobal[s]),
    bg: sectores.map(s => SECTOR_COLORS[s] || COLORS.muted)
  }
}

function _evolucionTemporal(proyectos) {
  // Agrupa inversión acumulada por mes
  const byMonth = {}
  proyectos.forEach(p => {
    if (!p.inicio) return
    const mes = p.inicio.slice(0, 7) // YYYY-MM
    if (!byMonth[mes]) byMonth[mes] = { inversion: 0, proyectos: 0 }
    byMonth[mes].inversion += (p.precio || 0) + (p.reforma || 0)
    byMonth[mes].proyectos++
  })
  const meses = Object.keys(byMonth).sort()
  let acum = 0
  return meses.map(m => {
    acum += byMonth[m].inversion
    return { mes: m, inversion: byMonth[m].inversion, acumulado: acum, proyectos: byMonth[m].proyectos }
  })
}

function _chartEvolucion(evolucion) {
  return {
    labels: evolucion.map(e => {
      const [y, m] = e.mes.split('-')
      return `${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][parseInt(m)-1]} ${y}`
    }),
    inversion: evolucion.map(e => e.inversion),
    acumulado: evolucion.map(e => e.acumulado)
  }
}

function _cartesVacia() {
  return {
    total: 0, porEstado: {}, porTipo: {}, inversionTotal: 0,
    retornoTotal: 0, beneficioTotal: 0, gastoTotal: 0, roiMedio: 0,
    roiMedioPct: 0, comparativaROI: [], gastosPorSectorGlobal: {},
    evolucionTemporal: [], analisisIndividual: [],
    chartCartera: { labels: [], inversion: [], retorno: [], roi: [] },
    chartEstados: { labels: [], data: [], bg: [] },
    chartSectoresGlobal: { labels: [], data: [], bg: [] },
    chartEvolucion: { labels: [], inversion: [], acumulado: [] }
  }
}

/* ──────────────────────────────────────────────────────────
   HELPERS DE FORMATO (usables en la UI)
────────────────────────────────────────────────────────── */
export function fmtEur(v) {
  if (v == null || isNaN(v)) return '—'
  return Number(v).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €'
}
export function fmtPct(v, dec = 1) {
  if (v == null || isNaN(v)) return '—'
  return Number(v).toFixed(dec) + '%'
}
export function fmtNum(v, dec = 2) {
  if (v == null || isNaN(v)) return '—'
  return Number(v).toFixed(dec)
}
export function fmtMeses(m) {
  if (!m) return '—'
  return m >= 12 ? `${Math.floor(m / 12)}a ${m % 12}m` : `${m} mes${m !== 1 ? 'es' : ''}`
}
