/**
 * RehabitaCo — Motor de predicción v3
 * Conocimiento del Excel BUVE INVEST (costes por categoría, ITP por CCAA, cartera
 * proyectado-vs-real, compra-alquiler) + calibración con TU histórico + Monte Carlo
 * + factor de estado por fotos (IA). Sin dependencias; expone window.MP.
 *
 * Correcciones respecto al Excel:
 *  · PER = precio / (alquiler×12)  (el Excel hace D28/I32*12 → 2.633, absurdo)
 *  · Revalorización anual = precio×((1+r)^n−1)/n  (el Excel divide el total entre 12)
 *  · J4 compra-venta: (compra+corrientes+venta)/PV (faltaban paréntesis)
 *  · VLOOKUP del ITP sin 4º argumento FALSE (coincidencia aproximada) → aquí exacto.
 */
(function (g) {
  'use strict'

  // ITP general por CCAA — tabla "Tabla ITP" del Excel. VERIFICA cada año (varias CCAA
  // tienen tramos/bonificaciones y la app tenía cifras distintas en 3 sitios).
  const ITP = {
    'Andalucía': .08, 'Aragón': .08, 'Asturias': .08, 'Baleares': .08, 'Canarias': .065,
    'Cantabria': .10, 'Castilla - La Mancha': .09, 'Castilla León': .08, 'Cataluña': .10,
    'Ceuta': .06, 'Comunidad de Madrid': .06, 'Comunidad Valenciana': .10, 'Extremadura': .08,
    'Galicia': .09, 'La Rioja': .07, 'Melilla': .06, 'Murcia': .08, 'Navarra': .06, 'País Vasco': .04
  }
  const EJEC = ['obra', 'elect', 'font', 'dis'] // sectores que cuentan como ejecución de reforma

  // Supuestos editables (priors del sector hasta tener histórico propio)
  const CFG = {
    gastosCompraPct: .015,      // notaría + registro + gestoría
    comisionVentaPct: .03,      // comisión inmobiliaria
    otrosVentaPct: .004,        // tasación, certificado energético, notaría venta
    corrientesAnualPct: .012,   // comunidad + seguro + IBI + suministros (Excel: "gastos corrientes")
    vacioMeses: 1,              // coste de inocupación (alquiler)
    objetivoROI: .15,
    nShrink: 3,                 // peso del prior frente al histórico
    prior: { kVenta: 1, kReforma: 1.10, kMeses: 1.15, sdVenta: .07, sdReforma: .15, sdMeses: .25 },
    mcN: 4000, rho: .5          // correlación sobrecoste↔retraso
  }

  const num = v => (isFinite(+v) ? +v : 0)
  const meses = (a, b) => {
    if (!a || !b) return null
    const m = (new Date(b) - new Date(a)) / (30.44 * 864e5)
    return m > 0 ? Math.round(m * 10) / 10 : null
  }
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length
  const sd = a => a.length < 2 ? 0 : Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1))
  const shrink = (obs, prior, n, N) => prior + (obs - prior) * n / (n + N)

  /** Aprende de los proyectos finalizados: ratio PV real/proyectado, sobrecoste de obra y retraso. */
  function calibrar (proyectos, gastos, cfg) {
    cfg = cfg || CFG
    const P = cfg.prior, N = cfg.nShrink
    const rv = [], rr = [], rm = []
    for (const p of (proyectos || []).filter(x => x.estado === 'fin')) {
      if (num(p.precio_venta) > 0 && num(p.precio_venta_real) > 0) rv.push(p.precio_venta_real / p.precio_venta)
      if (num(p.reforma) > 0) {
        const gs = (gastos || []).filter(x => x.proyecto_id === p.id && EJEC.includes(x.sector)).reduce((s, x) => s + num(x.coste), 0)
        if (gs > 0) rr.push(gs / p.reforma)
      }
      const est = meses(p.inicio, p.fin_est), real = meses(p.inicio, p.fecha_venta)
      if (est && real) rm.push(real / est)
    }
    const one = (arr, pk, psd) => {
      const n = arr.length
      return {
        k: n ? shrink(mean(arr), P[pk], n, N) : P[pk],
        sd: n >= 2 ? (n * sd(arr) + N * P[psd]) / (n + N) : P[psd], n
      }
    }
    const v = one(rv, 'kVenta', 'sdVenta'), r = one(rr, 'kReforma', 'sdReforma'), m = one(rm, 'kMeses', 'sdMeses')
    const nMax = Math.max(v.n, r.n, m.n)
    return {
      kVenta: v.k, kReforma: r.k, kMeses: m.k, sdVenta: v.sd, sdReforma: r.sd, sdMeses: m.sd,
      n: { venta: v.n, reforma: r.n, meses: m.n }, confianza: Math.min(1, nMax / 8),
      origen: nMax ? 'histórico propio + prior' : 'prior del sector (sin proyectos finalizados)'
    }
  }

  /** Estado visual (0-100) → multiplicadores de sobrecoste/retraso e incertidumbre. */
  function fotoFactor (an) {
    if (!an || an.puntuacion == null) return { kReforma: 1, kMeses: 1, sdExtra: 0, conf: 0 }
    const deficit = (100 - an.puntuacion) / 100
    const conf = an.confianza != null ? +an.confianza : .6
    return { kReforma: 1 + deficit * .30 * conf, kMeses: 1 + deficit * .15 * conf, sdExtra: deficit * .10, conf }
  }

  function mulberry32 (a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
  function randn (rng) { let u = 0; while (!u) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()) }
  const pct = (s, q) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]

  /** Monte Carlo del flip. b = base determinista; s = desviaciones. Semilla fija → resultado estable. */
  function simular (b, s, cfg) {
    cfg = cfg || CFG
    const rng = mulberry32(Math.round(b.precio + b.ref + b.pv) || 1)
    const rois = []
    for (let i = 0; i < cfg.mcN; i++) {
      const zv = randn(rng), zr = randn(rng), zm = cfg.rho * zr + Math.sqrt(1 - cfg.rho ** 2) * randn(rng)
      const pv = b.pv * Math.max(.3, 1 + s.v * zv)
      const ref = b.ref * Math.exp(s.r * zr - s.r * s.r / 2)
      const m = b.meses * Math.exp(s.m * zm - s.m * s.m / 2)
      const carry = b.precio * cfg.corrientesAnualPct * m / 12 + b.hip * m / b.meses
      const inv = b.precio + b.itp + b.gCompra + ref + b.mob + carry
      const gv = b.gvFijo != null ? b.gvFijo : pv * b.pctVenta
      rois.push(inv > 0 ? (pv - gv - inv) / inv : 0)
    }
    rois.sort((x, y) => x - y)
    const lo = pct(rois, .01), hi = pct(rois, .99), K = 24, w = (hi - lo) / K || 1
    const counts = Array(K).fill(0)
    rois.forEach(x => { counts[Math.min(K - 1, Math.max(0, Math.floor((x - lo) / w)))]++ })
    return {
      p10: pct(rois, .1), p50: pct(rois, .5), p90: pct(rois, .9), media: mean(rois),
      probPerdida: rois.filter(x => x < 0).length / rois.length,
      probObjetivo: rois.filter(x => x >= cfg.objetivoROI).length / rois.length,
      hist: { labels: counts.map((_, i) => ((lo + (i + .5) * w) * 100).toFixed(0) + '%'), counts, centros: counts.map((_, i) => lo + (i + .5) * w) }
    }
  }

  /** Predicción compra-reforma-venta de un proyecto. */
  function prediccionCV (p, o) {
    o = o || {}
    const cfg = o.cfg || CFG, calib = o.calib || calibrar([], [], cfg), ff = fotoFactor(o.foto)
    const precio = num(p.precio), ref0 = num(p.reforma), mob = num(p.mobiliario)
    const itpPct = ITP[p.comunidad_autonoma] != null ? ITP[p.comunidad_autonoma] : .08
    const real = num(p.precio_venta_real) > 0
    const pvProy = num(p.precio_venta_real) || num(p.precio_venta)
    const mesesEst = meses(p.inicio, p.fin_est) || 6
    const alertas = []

    const kRef = calib.kReforma * ff.kReforma
    const ref = Math.max(ref0 * kRef, num(o.gastosEjec))
    const mesesP = mesesEst * calib.kMeses * ff.kMeses
    const pv = pvProy * (real ? 1 : calib.kVenta)
    const itp = precio * itpPct
    const gCompra = num(p.gastos_compra_extra) > 0 ? num(p.gastos_compra_extra) : precio * cfg.gastosCompraPct
    const hip = num(p.hipoteca_importe) * (num(p.hipoteca_interes) || .035) * mesesP / 12
    const carry = precio * cfg.corrientesAnualPct * mesesP / 12 + hip
    const pctVenta = cfg.comisionVentaPct + cfg.otrosVentaPct
    const gvFijo = num(p.gastos_venta_extra) > 0 ? num(p.gastos_venta_extra) : null
    const gVenta = gvFijo != null ? gvFijo : pv * pctVenta
    const inv = precio + itp + gCompra + ref + mob + carry
    const ben = pv - gVenta - inv
    const roi = inv > 0 ? ben / inv : 0
    const roiAnual = inv > 0 && roi > -1 ? Math.pow(1 + roi, 12 / mesesP) - 1 : null
    const bep = gvFijo != null ? inv + gvFijo : inv / (1 - pctVenta)

    const sdV = calib.sdVenta, sdR = calib.sdReforma + ff.sdExtra, sdM = calib.sdMeses
    const base = { precio, itp, gCompra, ref, mob, meses: mesesP, pv, pctVenta, gvFijo, hip }
    const mc = simular(base, { v: sdV, r: sdR, m: sdM }, cfg)

    const esc = (kp, kr, km) => {
      const pv2 = pv * kp, ref2 = ref * kr, m2 = mesesP * km
      const c2 = precio * cfg.corrientesAnualPct * m2 / 12 + hip * km
      const i2 = precio + itp + gCompra + ref2 + mob + c2, gv2 = gvFijo != null ? gvFijo : pv2 * pctVenta
      const b2 = pv2 - gv2 - i2
      return { pv: pv2, inv: i2, ben: b2, roi: i2 > 0 ? b2 / i2 : 0, meses: m2 }
    }
    const escenarios = { pesimista: esc(1 - sdV, 1 + sdR, 1 + sdM), base: esc(1, 1, 1), optimista: esc(1 + sdV * .6, 1 - sdR * .5, 1 - sdM * .4) }

    const invObj = pv * (1 - pctVenta) / (1 + cfg.objetivoROI)
    const precioMaxObjetivo = (invObj - ref - mob - hip) / (1 + itpPct + cfg.gastosCompraPct + cfg.corrientesAnualPct * mesesP / 12)

    if (ref0 > 0 && ref > ref0 * 1.05) alertas.push(`Reforma prevista ${Math.round((ref / ref0 - 1) * 100)}% sobre presupuesto (histórico + estado del inmueble).`)
    if (mesesP > mesesEst * 1.1) alertas.push(`Duración prevista ${mesesP.toFixed(1)} meses frente a ${mesesEst} estimados.`)
    if (!real && calib.kVenta < .97) alertas.push(`Tus ventas reales cierran de media ${((1 - calib.kVenta) * 100).toFixed(1)}% por debajo del PV proyectado.`)
    if (o.foto && o.foto.reforma_min != null && ref0 > 0 && ref0 < num(o.foto.reforma_min)) alertas.push(`El presupuesto (${Math.round(ref0)} €) está por debajo del mínimo estimado por las fotos (${Math.round(o.foto.reforma_min)} €).`)
    if (!pvProy) alertas.push('Falta precio de venta proyectado: sin él no hay predicción fiable.')
    if (calib.confianza < .3) alertas.push('Calibración débil: aún hay pocos proyectos finalizados con datos reales.')

    const semaforo = mc.probPerdida < .10 && mc.p50 >= cfg.objetivoROI ? 'verde' : (mc.probPerdida < .25 && mc.p50 > 0 ? 'ambar' : 'rojo')
    return {
      tipo: 'cv', itpPct, itp, gCompra, ref, ref0, kRef, mesesP, mesesEst, carry, inv, pv, pvProy, gVenta, ben, roi, roiAnual, bep,
      mc, escenarios, precioMaxObjetivo, semaforo, alertas, calib, foto: ff
    }
  }

  const pmt = (cap, i, n) => i > 0 ? cap * i / (1 - Math.pow(1 + i, -n)) : cap / n

  /** Predicción compra-reforma-alquiler (estructura de "Análisis compra - alquiler"). */
  function prediccionAlq (p, o) {
    o = o || {}
    const cfg = o.cfg || CFG, calib = o.calib || calibrar([], [], cfg), ff = fotoFactor(o.foto)
    const precio = num(p.precio), mob = num(p.mobiliario)
    const itpPct = ITP[p.comunidad_autonoma] != null ? ITP[p.comunidad_autonoma] : .08
    const ref = Math.max(num(p.reforma) * calib.kReforma * ff.kReforma, num(o.gastosEjec))
    const itp = precio * itpPct, gCompra = num(p.gastos_compra_extra) > 0 ? num(p.gastos_compra_extra) : precio * cfg.gastosCompraPct
    const inv = precio + itp + gCompra + ref + mob
    const hi = num(p.hipoteca_importe), plazo = num(p.hipoteca_plazo) || 25, tin = num(p.hipoteca_interes) || .035
    const calcCuota = t => pmt(hi, t / 12, plazo * 12)
    const cuota = hi > 0 ? calcCuota(tin) : 0
    let saldo = hi, int1 = 0
    for (let k = 0; k < 12 && saldo > 0; k++) { const i = saldo * tin / 12; int1 += i; saldo -= cuota - i }
    const amort1 = cuota * 12 - int1
    const alq = num(p.alquiler_mensual), ga = num(p.gastos_anuales_alq) || precio * cfg.corrientesAnualPct
    const rev = num(p.revalorizacion_anual) || .02
    const ing = alq * (12 - cfg.vacioMeses), noi = ing - ga, cf = noi - cuota * 12
    const capital = inv - hi
    const flujo = (alqM, vac, t, extraG) => (alqM * (12 - vac) - ga - (extraG || 0)) - (hi > 0 ? calcCuota(t) * 12 : 0)
    const cfEstres = flujo(alq * .9, 3, tin + .02)
    const proy = []
    let sd2 = hi, acum = 0
    for (let a = 1; a <= 10; a++) {
      for (let k = 0; k < 12 && sd2 > 0; k++) { const i = sd2 * tin / 12; sd2 -= cuota - i }
      acum += cf
      proy.push({ anio: a, patrimonio: precio * Math.pow(1 + rev, a) - Math.max(0, sd2) - capital + acum })
    }
    const alertas = []
    if (!alq) alertas.push('Falta alquiler mensual esperado.')
    if (cf < 0) alertas.push('Cash-flow anual negativo: la cuota y los gastos superan el alquiler neto.')
    if (cfEstres < 0) alertas.push('En estrés (alquiler −10%, 3 meses vacío, tipo +2 pp) el cash-flow es negativo.')
    if (hi > 0 && noi / (cuota * 12) < 1.2) alertas.push('DSCR bajo (<1,2): poco margen para cubrir la hipoteca.')
    return {
      tipo: 'alq', inv, capital, ref, itp, gCompra, cuota, ing, noi, cf, cfMensual: cf / 12, cfEstres, amort1, reval: precio * rev,
      rentBruta: precio > 0 ? alq * 12 / precio : 0, rentNeta: inv > 0 ? noi / inv : 0,
      cashOnCash: capital > 0 ? cf / capital : null, roe: capital > 0 ? (cf + amort1 + precio * rev) / capital : null,
      per: alq > 0 ? precio / (alq * 12) : null, payback: cf > 0 ? capital / cf : null,
      dscr: cuota > 0 ? noi / (cuota * 12) : null, proy, alertas, calib, foto: ff,
      semaforo: cf > 0 && cfEstres >= 0 ? 'verde' : (cf > 0 ? 'ambar' : 'rojo')
    }
  }

  /** Texto compacto para el contexto del agente IA. */
  function resumenIA (p, r) {
    const f = v => Math.round(v).toLocaleString('es-ES') + '€', q = v => (v * 100).toFixed(1) + '%'
    if (!r) return ''
    if (r.tipo === 'alq') return `PREDICCIÓN ALQUILER "${p.nombre}": inv ${f(r.inv)}, cash-flow ${f(r.cf)}/año (estrés ${f(r.cfEstres)}), rent. bruta ${q(r.rentBruta)}, neta ${q(r.rentNeta)}, ROE ${r.roe == null ? '—' : q(r.roe)}, PER ${r.per ? r.per.toFixed(1) : '—'}, semáforo ${r.semaforo}. ${r.alertas.join(' ')}`
    return `PREDICCIÓN FLIP "${p.nombre}": inv ${f(r.inv)} (reforma prevista ${f(r.ref)}), PV previsto ${f(r.pv)}, beneficio ${f(r.ben)}, ROI ${q(r.roi)} (P10 ${q(r.mc.p10)} · P50 ${q(r.mc.p50)} · P90 ${q(r.mc.p90)}), prob. pérdida ${q(r.mc.probPerdida)}, precio máx. para ROI ${q(CFG.objetivoROI)}: ${f(r.precioMaxObjetivo)}, punto de equilibrio ${f(r.bep)}, semáforo ${r.semaforo}. ${r.alertas.join(' ')}`
  }

  const MP = { ITP, EJEC, CFG, meses, calibrar, fotoFactor, simular, prediccionCV, prediccionAlq, resumenIA }
  if (typeof module !== 'undefined' && module.exports) module.exports = MP
  g.MP = MP
})(typeof window !== 'undefined' ? window : globalThis)
