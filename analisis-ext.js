/**
 * RehabitaCo — Extensión de Análisis v3 (se carga DESPUÉS del script principal de index.html)
 *  1) Análisis por proyecto → pestañas: Predicción · Estado e imágenes (IA) · Archivos
 *  2) Predictor ROI → calibración con histórico + riesgo Monte Carlo
 *  3) Agente IA → /api/ia en streaming (Claude o ChatGPT) con contexto real
 * Usa globales de index.html: sb, PROYECTOS, loadProjFotos, openLightbox, mkChart, toast, esc, AI_SYSTEM, aiChatHistory…
 */
(function () {
  'use strict'
  const $ = id => document.getElementById(id)
  const E = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const EUR = v => v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('es-ES') + ' €'
  const PCT = (v, d = 1) => v == null || isNaN(v) ? '—' : (v * 100).toFixed(d) + '%'
  const tst = m => typeof toast === 'function' ? toast(m) : console.log(m)
  const proyecto = id => PROYECTOS.find(x => x.id === id)
  const SEM = { verde: ['🟢', 'Operación sólida', 'var(--sage)'], ambar: ['🟠', 'Riesgo moderado', 'var(--gold)'], rojo: ['🔴', 'Riesgo alto', 'var(--red)'] }
  const NIVEL_COL = { excelente: 'var(--sage)', bueno: 'var(--sage)', regular: 'var(--gold)', malo: 'var(--rust)', ruina: 'var(--red)' }
  const CATS = ['contrato', 'escritura', 'licencia', 'presupuesto', 'factura', 'plano', 'informe técnico', 'seguro', 'nota simple', 'otro']

  const st = document.createElement('style')
  st.textContent = `.afx-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;border-bottom:1px solid var(--line);padding-bottom:10px}
  .afx-tab{border:1px solid var(--line);background:var(--paper);padding:7px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;color:var(--muted)}
  .afx-tab.on{background:var(--gold);border-color:var(--gold);color:var(--ink)}
  .afx-card{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);padding:18px;margin-bottom:16px}
  .afx-h{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;margin-bottom:10px}
  .afx-grid{display:grid;gap:16px;grid-template-columns:1fr 1fr}
  .afx-kpis{display:grid;gap:10px;grid-template-columns:repeat(4,1fr);margin-bottom:16px}
  .afx-warn{background:var(--warm);border-left:3px solid var(--gold);padding:8px 12px;border-radius:8px;font-size:12px;margin-top:6px}
  .afx-table{width:100%;border-collapse:collapse;font-size:12px}.afx-table td,.afx-table th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:right}.afx-table th:first-child,.afx-table td:first-child{text-align:left}
  .afx-chip{border:1px solid var(--line);border-radius:14px;padding:3px 10px;font-size:11px;cursor:pointer;background:var(--paper)}.afx-chip.on{background:var(--ink);color:#fff}
  .afx-ph{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;cursor:pointer;border:2px solid transparent}.afx-ph img{width:100%;height:100%;object-fit:cover}
  .afx-ph.sel{border-color:var(--gold)}.afx-ph input{position:absolute;top:6px;left:6px;width:18px;height:18px;z-index:2}.afx-ph span{position:absolute;bottom:4px;left:4px;font-size:9px;background:rgba(0,0,0,.6);color:#fff;padding:1px 6px;border-radius:8px}
  @media(max-width:860px){.afx-grid{grid-template-columns:1fr}.afx-kpis{grid-template-columns:1fr 1fr}}`
  document.head.appendChild(st)

  const kpi = (ico, val, lbl, col) => `<div class="stat-card"><div class="stat-ico">${ico}</div><div class="stat-val" style="color:${col || 'var(--gold)'};font-size:18px">${val}</div><div class="stat-lbl">${lbl}</div></div>`
  const row = (l, v, b) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)"><span style="font-size:11px;color:var(--muted)">${l}</span><span style="font-size:12px;font-weight:${b ? 700 : 500}">${v}</span></div>`
  const aviso = (m) => `<div class="afx-warn">${m}</div>`
  const falloTabla = e => `<div class="afx-card"><div class="afx-h">⚠️ Falta preparar la base de datos</div><p style="font-size:12px">Ejecuta <code>migration_v3_fotos_archivos_ia.sql</code> en Supabase → SQL Editor. Detalle: ${E(e && e.message)}</p></div>`

  /* ───────────── calibración (histórico propio) ───────────── */
  let GASTOS_ALL = null, CALIB = null
  async function calibracion (force) {
    if (CALIB && !force) return CALIB
    const { data } = await sb.from('gastos').select('proyecto_id,sector,coste')
    GASTOS_ALL = data || []
    CALIB = MP.calibrar(PROYECTOS, GASTOS_ALL)
    return CALIB
  }
  const gastoEjec = id => (GASTOS_ALL || []).filter(g => g.proyecto_id === id && MP.EJEC.includes(g.sector)).reduce((s, g) => s + (+g.coste || 0), 0)

  async function analisisEstado (id, soloUltimo) {
    const q = sb.from('proyecto_analisis_estado').select('*').eq('proyecto_id', id).order('created_at', { ascending: false }).limit(soloUltimo ? 1 : 8)
    const { data, error } = await q
    if (error) throw error
    const norm = a => a && Object.assign({}, a, { reforma_min: a.reforma_min, reforma_max: a.reforma_max })
    return soloUltimo ? norm((data || [])[0]) : (data || []).map(norm)
  }

  /* ───────────── pestañas en Análisis por proyecto ───────────── */
  const TABS = [['fin', '📊 Financiero'], ['pred', '🔮 Predicción'], ['estado', '📷 Estado e imágenes'], ['arch', '📎 Archivos']]
  const AFX = window.AFX = { id: null, etapa: 'all', sel: new Set() }

  const origCargar = window.cargarAnalisisFinanciero
  window.cargarAnalisisFinanciero = async function (id) {
    await origCargar(id)
    if (!id) return
    const body = $('af-body'); if (!body || !body.firstChild) return
    const fin = document.createElement('div'); fin.id = 'afx-fin'
    while (body.firstChild) fin.appendChild(body.firstChild) // mover (no clonar) conserva los canvas/gráficos
    const bar = document.createElement('div'); bar.className = 'afx-tabs'
    bar.innerHTML = TABS.map(([k, l], i) => `<button class="afx-tab ${i ? '' : 'on'}" data-t="${k}" onclick="AFX.tab('${k}')">${l}</button>`).join('')
    body.append(bar, fin)
    TABS.slice(1).forEach(([k]) => { const d = document.createElement('div'); d.id = 'afx-' + k; d.style.display = 'none'; body.appendChild(d) })
    AFX.id = id; AFX.sel = new Set(); AFX.etapa = 'all'
  }

  AFX.tab = function (k) {
    document.querySelectorAll('.afx-tab').forEach(b => b.classList.toggle('on', b.dataset.t === k))
    TABS.forEach(([t]) => { const d = $('afx-' + t); if (d) d.style.display = t === k ? '' : 'none' })
    if (k === 'pred') rPred(); if (k === 'estado') rEstado(); if (k === 'arch') rArch()
  }

  /* ───────────── PREDICCIÓN ───────────── */
  async function rPred () {
    const p = proyecto(AFX.id), box = $('afx-pred'); if (!p || !box) return
    box.innerHTML = '<div class="loader"></div>'
    const calib = await calibracion()
    let an = null; try { an = await analisisEstado(p.id, true) } catch (_) {}
    const alq = p.tipo === 'alquiler'
    const r = alq ? MP.prediccionAlq(p, { calib, foto: an, gastosEjec: gastoEjec(p.id) }) : MP.prediccionCV(p, { calib, foto: an, gastosEjec: gastoEjec(p.id) })
    const s = SEM[r.semaforo]
    const cab = `<div class="afx-card" style="display:flex;gap:14px;align-items:center;border-left:4px solid ${s[2]}"><div style="font-size:30px">${s[0]}</div><div><div class="afx-h" style="margin:0">${s[1]}</div><div style="font-size:11px;color:var(--muted)">Calibración: ${E(calib.origen)} · n=${Math.max(calib.n.venta, calib.n.reforma, calib.n.meses)} · fiabilidad ${PCT(calib.confianza, 0)}${an ? ' · estado inmueble ' + an.puntuacion + '/100' : ' · sin análisis de fotos'}</div></div></div>`
    const al = r.alertas.map(aviso).join('')
    if (alq) {
      box.innerHTML = cab + `<div class="afx-kpis">${kpi('💰', PCT(r.rentNeta), 'Rentab. neta (NOI/inv.)')}${kpi('📆', EUR(r.cfMensual), 'Cash-flow / mes', r.cf >= 0 ? 'var(--sage)' : 'var(--red)')}${kpi('🏦', PCT(r.roe), 'ROE (incl. amort. + reval.)', 'var(--sky)')}${kpi('🧪', EUR(r.cfEstres), 'Cash-flow anual en estrés', r.cfEstres >= 0 ? 'var(--sage)' : 'var(--red)')}</div>
      <div class="afx-grid"><div class="afx-card"><div class="afx-h">Métricas</div>${row('Inversión total', EUR(r.inv), 1)}${row('Capital propio', EUR(r.capital))}${row('Cuota hipoteca', EUR(r.cuota))}${row('NOI anual', EUR(r.noi))}${row('Rent. bruta', PCT(r.rentBruta))}${row('Cash-on-cash', PCT(r.cashOnCash))}${row('PER (años de alquiler)', r.per ? r.per.toFixed(1) : '—')}${row('DSCR', r.dscr ? r.dscr.toFixed(2) : '—')}${row('Payback', r.payback ? r.payback.toFixed(1) + ' años' : '—')}${al}</div>
      <div class="afx-card"><div class="afx-h">Patrimonio neto proyectado (10 años)</div><div style="position:relative;height:260px"><canvas id="afx-ch1"></canvas></div></div></div>`
      setTimeout(() => mkChart('afx-ch1', { type: 'line', data: { labels: r.proy.map(x => 'Año ' + x.anio), datasets: [{ label: 'Patrimonio', data: r.proy.map(x => Math.round(x.patrimonio)), borderColor: '#4E7C5A', backgroundColor: '#4E7C5A22', fill: true, tension: .3 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => EUR(v) } } } } }), 50)
      return
    }
    const E3 = r.escenarios
    box.innerHTML = cab + `<div class="afx-kpis">${kpi('🎯', PCT(r.mc.p50), 'ROI esperado (P50)', r.mc.p50 > 0 ? 'var(--sage)' : 'var(--red)')}${kpi('⚠️', PCT(r.mc.probPerdida, 0), 'Probabilidad de pérdida', r.mc.probPerdida < .1 ? 'var(--sage)' : 'var(--red)')}${kpi('📈', EUR(r.ben), 'Beneficio previsto')}${kpi('🏷️', PCT(r.roiAnual), 'ROI anualizado', 'var(--lav)')}</div>
    <div class="afx-grid"><div class="afx-card"><div class="afx-h">Distribución de ROI (${MP.CFG.mcN} simulaciones)</div><div style="position:relative;height:230px"><canvas id="afx-ch1"></canvas></div><div style="font-size:11px;color:var(--muted);margin-top:6px">P10 ${PCT(r.mc.p10)} · P50 ${PCT(r.mc.p50)} · P90 ${PCT(r.mc.p90)} · P(ROI ≥ ${PCT(MP.CFG.objetivoROI, 0)}) = ${PCT(r.mc.probObjetivo, 0)}</div></div>
    <div class="afx-card"><div class="afx-h">Escenarios</div><table class="afx-table"><tr><th></th><th>Pesimista</th><th>Base</th><th>Optimista</th></tr>
      <tr><td>Precio venta</td>${['pesimista', 'base', 'optimista'].map(k => `<td>${EUR(E3[k].pv)}</td>`).join('')}</tr>
      <tr><td>Inversión</td>${['pesimista', 'base', 'optimista'].map(k => `<td>${EUR(E3[k].inv)}</td>`).join('')}</tr>
      <tr><td>Beneficio</td>${['pesimista', 'base', 'optimista'].map(k => `<td>${EUR(E3[k].ben)}</td>`).join('')}</tr>
      <tr><td><b>ROI</b></td>${['pesimista', 'base', 'optimista'].map(k => `<td><b style="color:${E3[k].roi > 0 ? 'var(--sage)' : 'var(--red)'}">${PCT(E3[k].roi)}</b></td>`).join('')}</tr>
      <tr><td>Meses</td>${['pesimista', 'base', 'optimista'].map(k => `<td>${E3[k].meses.toFixed(1)}</td>`).join('')}</tr></table>
      <div style="margin-top:12px">${row('Reforma presupuestada → prevista', EUR(r.ref0) + ' → ' + EUR(r.ref), 1)}${row('Duración estimada → prevista', r.mesesEst + ' → ' + r.mesesP.toFixed(1) + ' m')}${row('Precio de venta proyectado → previsto', EUR(r.pvProy) + ' → ' + EUR(r.pv))}${row('Punto de equilibrio (PV mínimo)', EUR(r.bep), 1)}${row('Precio máx. compra para ROI ' + PCT(MP.CFG.objetivoROI, 0), EUR(r.precioMaxObjetivo), 1)}</div>${al}</div></div>`
    setTimeout(() => mkChart('afx-ch1', { type: 'bar', data: { labels: r.mc.hist.labels, datasets: [{ data: r.mc.hist.counts, backgroundColor: r.mc.hist.centros.map(c => c < 0 ? '#DC4F4F99' : (c >= MP.CFG.objetivoROI ? '#4E7C5A99' : '#D4A84799')), borderRadius: 3 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { display: false }, x: { ticks: { maxTicksLimit: 8 } } } } }), 50)
  }

  /* ───────────── ESTADO E IMÁGENES ───────────── */
  function comprimir (file, max, q) {
    return new Promise(ok => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return ok(file)
      const img = new Image(), u = URL.createObjectURL(file)
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas')
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        c.toBlob(b => { URL.revokeObjectURL(u); ok(b && b.size < file.size ? b : file) }, 'image/jpeg', q)
      }
      img.onerror = () => { URL.revokeObjectURL(u); ok(file) }
      img.src = u
    })
  }
  const aB64 = blob => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(blob) })

  async function rEstado () {
    const p = proyecto(AFX.id), box = $('afx-estado'); if (!p || !box) return
    await loadProjFotos(p)
    let hist = [], errTabla = null
    try { hist = await analisisEstado(p.id) } catch (e) { errTabla = e }
    const todas = p.fotos_obj || [], ver = todas.filter(f => AFX.etapa === 'all' || f.etapa === AFX.etapa)
    const an = hist[0]
    const chips = [['all', 'Todas'], ['antes', 'Antes'], ['durante', 'Durante'], ['despues', 'Después']].map(([k, l]) => `<span class="afx-chip ${AFX.etapa === k ? 'on' : ''}" onclick="AFX.filtro('${k}')">${l} (${k === 'all' ? todas.length : todas.filter(f => f.etapa === k).length})</span>`).join(' ')
    const inf = an && an.informe || {}
    box.innerHTML = (errTabla ? falloTabla(errTabla) : '') + `<div class="afx-grid">
    <div class="afx-card"><div class="afx-h">📷 Fotos del proyecto</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
        <select class="fs" id="afx-etapa" style="width:auto"><option value="antes">Antes</option><option value="durante" selected>Durante</option><option value="despues">Después</option></select>
        <label class="btn btn-outline btn-sm" style="cursor:pointer">🖼️ Subir<input type="file" accept="image/*" multiple hidden onchange="AFX.subir(this)"></label>
        <label class="btn btn-gold btn-sm" style="cursor:pointer">📸 Hacer foto<input type="file" accept="image/*" capture="environment" hidden onchange="AFX.subir(this)"></label></div>
      <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">${chips}</div>
      ${ver.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px">${ver.map((f, i) => `<div class="afx-ph ${AFX.sel.has(f.id) ? 'sel' : ''}" onclick="openLightbox(${E(JSON.stringify(ver.map(x => x.url)))},${i})"><input type="checkbox" ${AFX.sel.has(f.id) ? 'checked' : ''} onclick="event.stopPropagation();AFX.marcar('${f.id}',this.checked)"><img loading="lazy" src="${E(f.url)}" alt=""><span>${E(f.etapa || 'sin etapa')}</span><button class="photo-del" onclick="event.stopPropagation();AFX.borrarFoto('${f.id}')">✕</button></div>`).join('')}</div>` : '<div class="empty"><div class="empty-ico">📷</div><p>Sin fotos en esta etapa</p></div>'}
      <div style="margin-top:12px"><button class="btn btn-gold btn-sm" id="afx-btn-ia" onclick="AFX.analizar()" ${todas.length ? '' : 'disabled'}>🤖 Analizar estado con IA (${AFX.sel.size || Math.min(4, todas.length)} fotos)</button>
      <div style="font-size:10px;color:var(--muted);margin-top:6px">Marca hasta 6 fotos (sin marcar usa las 4 más recientes). Valoración visual orientativa, no sustituye a una peritación.</div></div></div>
    <div class="afx-card"><div class="afx-h">🧠 Último análisis de estado</div>${an ? `
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:10px"><div style="font-size:34px;font-weight:800;color:${NIVEL_COL[an.nivel] || 'var(--gold)'}">${an.puntuacion}<span style="font-size:13px;color:var(--muted)">/100</span></div><div><b style="text-transform:capitalize">${E(an.nivel)}</b><div style="font-size:11px;color:var(--muted)">Confianza ${PCT(an.confianza, 0)} · ${E(an.proveedor || '')} · ${new Date(an.created_at).toLocaleDateString('es-ES')}</div></div></div>
      <p style="font-size:12px;line-height:1.5">${E(inf.resumen)}</p>
      ${an.reforma_min != null ? row('Reforma estimada por fotos', EUR(an.reforma_min) + ' – ' + EUR(an.reforma_max), 1) : ''}${row('Presupuesto actual', EUR(p.reforma))}
      ${(inf.hallazgos || []).slice(0, 8).map(h => `<div style="font-size:11.5px;padding:5px 0;border-bottom:1px solid var(--line)"><b>${E(h.zona)}</b> · ${E(h.tipo)} · sev. ${+h.severidad || '?'}/5<br><span style="color:var(--muted)">${E(h.descripcion)} (${EUR(h.coste_min_eur)}–${EUR(h.coste_max_eur)})</span></div>`).join('')}
      ${(inf.riesgos_ocultos || []).length ? `<div class="afx-warn"><b>Posibles riesgos ocultos:</b> ${inf.riesgos_ocultos.map(E).join(' · ')}</div>` : ''}
      ${(inf.zonas_sin_fotografiar || []).length ? `<div class="afx-warn"><b>Faltan fotos de:</b> ${inf.zonas_sin_fotografiar.map(E).join(', ')}</div>` : ''}
      <div style="font-size:10px;color:var(--muted);margin-top:8px">Este resultado ya ajusta la pestaña Predicción (sobrecoste, retraso e incertidumbre).</div>` : '<div class="empty" style="padding:20px 0"><p>Aún no hay análisis. Sube fotos de todas las estancias y pulsa “Analizar”.</p></div>'}</div></div>`
  }
  AFX.filtro = k => { AFX.etapa = k; rEstado() }
  AFX.marcar = (id, on) => { on ? (AFX.sel.size < 6 ? AFX.sel.add(id) : (tst('Máximo 6 fotos'), rEstado())) : AFX.sel.delete(id); const b = $('afx-btn-ia'); if (b) b.textContent = `🤖 Analizar estado con IA (${AFX.sel.size || 4} fotos)` }

  AFX.subir = async function (input) {
    const files = Array.from(input.files || []); input.value = ''
    const etapa = ($('afx-etapa') || {}).value || 'durante'
    let ok = 0
    for (const f of files) {
      try {
        const blob = await comprimir(f, 1600, .82)
        const ext = blob.type === 'image/jpeg' ? 'jpg' : (f.name.split('.').pop() || 'png').toLowerCase()
        const path = `proyectos/${AFX.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error } = await sb.storage.from('proyecto-fotos').upload(path, blob, { contentType: blob.type || f.type })
        if (error) throw error
        const url = sb.storage.from('proyecto-fotos').getPublicUrl(path).data.publicUrl
        const { data: last } = await sb.from('proyecto_fotos').select('orden').eq('proyecto_id', AFX.id).order('orden', { ascending: false }).limit(1)
        const { error: e2 } = await sb.from('proyecto_fotos').insert({ proyecto_id: AFX.id, url, path, etapa, orden: last && last.length ? last[0].orden + 1 : 0, created_by: null })
        if (e2) throw e2
        ok++
      } catch (e) { console.error(e); tst('⚠️ ' + f.name + ': ' + (e.message || 'error')) }
    }
    if (ok) tst(`✅ ${ok} foto${ok > 1 ? 's' : ''} subida${ok > 1 ? 's' : ''}`)
    rEstado()
  }
  AFX.borrarFoto = async function (id) {
    if (!confirm('¿Eliminar esta foto?')) return
    const { data: f } = await sb.from('proyecto_fotos').select('path').eq('id', id).single()
    if (f && f.path) await sb.storage.from('proyecto-fotos').remove([f.path])
    await sb.from('proyecto_fotos').delete().eq('id', id)
    AFX.sel.delete(id); rEstado()
  }

  async function iaFetch (body) {
    const { data: { session } } = await sb.auth.getSession()
    if (!session) throw new Error('Sesión caducada: vuelve a iniciar sesión')
    return fetch('/api/ia', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token }, body: JSON.stringify(body) })
  }

  AFX.analizar = async function () {
    const p = proyecto(AFX.id), btn = $('afx-btn-ia'); if (!p) return
    const todas = p.fotos_obj || []
    const elegidas = AFX.sel.size ? todas.filter(f => AFX.sel.has(f.id)) : todas.slice(-4)
    if (!elegidas.length) return tst('Sube fotos primero')
    btn.disabled = true; btn.textContent = '⏳ Analizando…'
    try {
      const images = []
      for (const f of elegidas) {
        const blob = await (await fetch(f.url)).blob()
        const small = await comprimir(new File([blob], 'x.jpg', { type: blob.type }), 1280, .8)
        images.push({ media_type: small.type || 'image/jpeg', data: await aB64(small) })
      }
      const r = await iaFetch({ mode: 'vision', proveedor: localStorage.getItem('afx_prov') || 'auto', images, contexto: { tipo: p.tipo, m2: p.m2, direccion: p.direccion, etapa: elegidas[0].etapa } })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status)
      const inf = j.informe, m2 = +p.m2 || 0, rm = inf.reforma_eur_m2 || {}
      const { error } = await sb.from('proyecto_analisis_estado').insert({
        proyecto_id: p.id, puntuacion: Math.max(0, Math.min(100, Math.round(inf.puntuacion_estado))), nivel: inf.nivel,
        confianza: Math.max(0, Math.min(1, +inf.confianza || .5)), reforma_min: m2 && rm.min ? rm.min * m2 : null, reforma_max: m2 && rm.max ? rm.max * m2 : null,
        informe: inf, foto_ids: elegidas.map(f => f.id), proveedor: j.proveedor, modelo: j.modelo, created_by: null
      })
      if (error) throw error
      tst('✅ Análisis guardado: la predicción ya lo usa')
      rEstado()
    } catch (e) { console.error(e); tst('⚠️ ' + e.message, 5000); btn.disabled = false; btn.textContent = '🤖 Reintentar análisis' }
  }

  /* ───────────── ARCHIVOS ───────────── */
  async function rArch () {
    const p = proyecto(AFX.id), box = $('afx-arch'); if (!p || !box) return
    const { data, error } = await sb.from('proyecto_archivos').select('*').eq('proyecto_id', p.id).order('created_at', { ascending: false })
    if (error) { box.innerHTML = falloTabla(error); return }
    const sz = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB'
    box.innerHTML = `<div class="afx-card"><div class="afx-h">📎 Documentación del proyecto</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <select class="fs" id="afx-cat" style="width:auto">${CATS.map(c => `<option>${c}</option>`).join('')}</select>
        <label class="btn btn-gold btn-sm" style="cursor:pointer">⬆ Adjuntar archivos<input type="file" multiple hidden onchange="AFX.adjuntar(this)"></label>
        <span style="font-size:10px;color:var(--muted)">PDF, Word, Excel, planos, imágenes… hasta 50 MB · almacenamiento privado</span></div>
      ${(data || []).length ? `<table class="afx-table"><tr><th>Archivo</th><th>Categoría</th><th>Tamaño</th><th>Fecha</th><th></th></tr>${data.map(a => `<tr><td>${E(a.nombre)}</td><td>${E(a.categoria)}</td><td>${a.size_bytes ? sz(a.size_bytes) : '—'}</td><td>${new Date(a.created_at).toLocaleDateString('es-ES')}</td><td style="white-space:nowrap"><button class="btn btn-outline btn-xs" onclick="AFX.abrir('${a.path}')">Abrir</button> <button class="btn btn-ghost btn-xs" onclick="AFX.borrarArch('${a.id}','${a.path}')">🗑</button></td></tr>`).join('')}</table>` : '<div class="empty"><div class="empty-ico">📁</div><p>Sin archivos. Adjunta contratos, escrituras, licencias, facturas…</p></div>'}</div>`
  }
  AFX.adjuntar = async function (input) {
    const files = Array.from(input.files || []); input.value = ''
    const cat = ($('afx-cat') || {}).value || 'otro'; let ok = 0
    for (const f of files) {
      if (f.size > 50 * 1024 * 1024) { tst('⚠️ ' + f.name + ' supera 50 MB'); continue }
      try {
        const path = `${AFX.id}/${Date.now()}_${f.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\-]+/g, '_')}`
        const { error } = await sb.storage.from('proyecto-archivos').upload(path, f, { contentType: f.type || 'application/octet-stream' })
        if (error) throw error
        const { error: e2 } = await sb.from('proyecto_archivos').insert({ proyecto_id: AFX.id, nombre: f.name, path, categoria: cat, mime: f.type, size_bytes: f.size, created_by: null })
        if (e2) throw e2
        ok++
      } catch (e) { console.error(e); tst('⚠️ ' + f.name + ': ' + (e.message || 'error')) }
    }
    if (ok) tst(`✅ ${ok} archivo${ok > 1 ? 's' : ''} adjunto${ok > 1 ? 's' : ''}`)
    rArch()
  }
  AFX.abrir = async function (path) {
    const { data, error } = await sb.storage.from('proyecto-archivos').createSignedUrl(path, 3600)
    if (error) return tst('⚠️ ' + error.message)
    window.open(data.signedUrl, '_blank', 'noopener')
  }
  AFX.borrarArch = async function (id, path) {
    if (!confirm('¿Eliminar el archivo? No se puede deshacer.')) return
    await sb.storage.from('proyecto-archivos').remove([path])
    await sb.from('proyecto_archivos').delete().eq('id', id)
    rArch()
  }

  /* ───────────── PREDICTOR ROI: calibración + riesgo ───────────── */
  async function initPredictorExtra () {
    const v = $('v-an-predictor'); if (!v) return
    let c = $('afx-pred-extra')
    if (!c) { c = document.createElement('div'); c.id = 'afx-pred-extra'; c.style.marginTop = '16px'; v.appendChild(c) }
    const calib = await calibracion(true), n = Math.max(calib.n.venta, calib.n.reforma, calib.n.meses)
    c.innerHTML = `<div class="afx-grid"><div class="afx-card"><div class="afx-h">🎯 Calibración con tu histórico</div>
      ${row('Venta real vs proyectada', PCT(calib.kVenta - 1) + ' (n=' + calib.n.venta + ')')}${row('Sobrecoste de reforma', PCT(calib.kReforma - 1) + ' (n=' + calib.n.reforma + ')')}${row('Retraso de la operación', PCT(calib.kMeses - 1) + ' (n=' + calib.n.meses + ')')}
      <div style="font-size:10.5px;color:var(--muted);margin:8px 0">${n ? 'Aprendido de tus proyectos finalizados' : 'Sin proyectos finalizados: se usa el prior del sector'} (fiabilidad ${PCT(calib.confianza, 0)}). Registra precio de venta real y fechas al cerrar cada proyecto para afinarlo.</div>
      <button class="btn btn-gold btn-sm" onclick="AFX.aplicarCalib()">Aplicar colchón y plazo calibrados</button></div>
      <div class="afx-card"><div class="afx-h">🎲 Riesgo del escenario actual (Monte Carlo)</div><div id="afx-mc">Introduce precio y venta…</div></div></div>`
    riesgoPredictor()
  }
  AFX.aplicarCalib = function () {
    const c = CALIB; if (!c) return
    const set = (id, v) => { const e = $(id); if (e) e.value = v }
    set('pColchon', Math.max(0, Math.round((c.kReforma - 1) * 100)))
    const m = +($('pMeses') || {}).value || 6; set('pMeses', Math.round(m * c.kMeses))
    if (typeof updatePredictor === 'function') updatePredictor()
    tst('✅ Colchón de reforma y plazo ajustados al histórico')
  }
  function riesgoPredictor () {
    const box = $('afx-mc'); if (!box || !CALIB || $('pTipo') && $('pTipo').value === 'alquiler') { if (box) box.textContent = 'Disponible para compra-reforma-venta.'; return }
    const g = id => +($(id) || {}).value || 0
    const precio = g('pPrecio'), pv = g('pPVenta'); if (!precio || !pv) { box.textContent = 'Introduce precio de compra y de venta.'; return }
    const meses = g('pMeses') || 6, ref = g('pReforma') * (1 + g('pColchon') / 100)
    const itp = typeof _calcImpuesto === 'function' ? _calcImpuesto(precio, ($('pCCAA') || {}).value || 'madrid', ($('pTipoInm') || {}).value || 'segunda').importe : precio * .08
    const gvExtra = g('pNotVenta') + g('pPlusValia')
    const base = { precio, itp, gCompra: g('pNotaria') + g('pGestoria'), ref, mob: g('pMob'), meses, pv, pctVenta: g('pAgencia') / 100 + gvExtra / pv, gvFijo: null, hip: 0 }
    const mc = MP.simular(base, { v: CALIB.sdVenta, r: CALIB.sdReforma, m: CALIB.sdMeses })
    const col = mc.probPerdida < .1 ? 'var(--sage)' : mc.probPerdida < .25 ? 'var(--gold)' : 'var(--red)'
    box.innerHTML = row('ROI antes de IRPF (P10 / P50 / P90)', `${PCT(mc.p10)} / <b>${PCT(mc.p50)}</b> / ${PCT(mc.p90)}`) + row('Probabilidad de pérdida', `<b style="color:${col}">${PCT(mc.probPerdida, 0)}</b>`) + row('P(ROI ≥ ' + PCT(MP.CFG.objetivoROI, 0) + ')', PCT(mc.probObjetivo, 0)) + '<div style="font-size:10.5px;color:var(--muted);margin-top:6px">Variabilidad calibrada con tu histórico; el colchón de reforma ya está en la media. El ROI del panel superior es después de IRPF.</div>'
  }
  const upOrig = window.updatePredictor
  window.updatePredictor = function () { const r = upOrig.apply(this, arguments); try { riesgoPredictor() } catch (_) {} return r }

  /* ───────────── AGENTE IA en tiempo real ───────────── */
  const NOMBRE_PROV = { anthropic: 'Claude', openai: 'ChatGPT' }
  const md = t => E(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^[-*] /gm, '• ').replace(/\n/g, '<br>')

  async function contextoIA (projId) {
    const calib = await calibracion()
    let t = (typeof AI_SYSTEM === 'string' ? AI_SYSTEM : '') + '\n\n'
    t += `CALIBRACIÓN (${calib.origen}): venta real/proyectada ${PCT(calib.kVenta - 1)}, sobrecoste reforma ${PCT(calib.kReforma - 1)}, retraso ${PCT(calib.kMeses - 1)}.\n`
    t += 'PROYECTOS:\n' + PROYECTOS.slice(0, 30).map(p => `- ${p.nombre} | ${p.tipo} | ${p.estado} | ${p.comunidad_autonoma || 'CCAA?'} | compra ${p.precio || 0}€ | reforma ${p.reforma || 0}€ | PV ${p.precio_venta_real || p.precio_venta || 0}€ | ${p.m2 || '?'}m²`).join('\n')
    const p = projId && proyecto(projId)
    if (p) {
      let an = null; try { an = await analisisEstado(p.id, true) } catch (_) {}
      const r = p.tipo === 'alquiler' ? MP.prediccionAlq(p, { calib, foto: an, gastosEjec: gastoEjec(p.id) }) : MP.prediccionCV(p, { calib, foto: an, gastosEjec: gastoEjec(p.id) })
      t += `\n\nPROYECTO EN FOCO: ${p.nombre} (${p.direccion || ''})\n` + MP.resumenIA(p, r)
      if (an) t += `\nESTADO POR FOTOS: ${an.puntuacion}/100 (${an.nivel}); ${(an.informe && an.informe.resumen) || ''}`
    }
    return t.slice(0, 13000)
  }

  window._getAIReply = async function (msg) {
    _showTyping()
    try {
      const foco = ($('afx-foco') || {}).value || ''
      const p = foco && proyecto(foco)
      const r = await iaFetch({ mode: 'chat', proveedor: localStorage.getItem('afx_prov') || 'auto', messages: aiChatHistory.slice(-12), contexto: await contextoIA(foco), ubicacion: p ? (p.direccion || '') : '', m2: p ? p.m2 : null })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'HTTP ' + r.status) }
      _hideTyping()
      const cont = $('aiMessages'), d = document.createElement('div'); d.className = 'ai-msg ai'
      d.innerHTML = '<div class="ai-avatar-an" style="width:28px;height:28px;font-size:12px;flex-shrink:0">✦</div><div class="ai-bubble"></div>'
      cont.appendChild(d); const bub = d.querySelector('.ai-bubble')
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '', full = ''
      for (;;) {
        const { done, value } = await rd.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const ev = buf.slice(0, i).trim(); buf = buf.slice(i + 2)
          if (!ev.startsWith('data:')) continue
          const j = JSON.parse(ev.slice(5)); if (j.error) throw new Error(j.error)
          if (j.t) { full += j.t; bub.innerHTML = md(full); cont.scrollTop = cont.scrollHeight }
        }
      }
      aiChatHistory.push({ role: 'assistant', content: full || 'Sin respuesta.' })
    } catch (e) {
      _hideTyping(); _pushAssistMsg('⚠️ ' + e.message + (/404|Failed to fetch/.test(e.message) ? ' (¿estás usando `vercel dev` o la web desplegada? /api solo existe ahí)' : ''))
    }
  }

  async function initAgente () {
    const act = document.querySelector('#v-an-agente .sec-actions'); if (!act) return
    if (!$('afx-foco')) {
      const w = document.createElement('div'); w.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap'
      w.innerHTML = '<select class="sort-sel" id="afx-foco" style="font-size:12px"></select><select class="sort-sel" id="afx-prov" style="font-size:12px"><option value="auto">IA: automática</option><option value="anthropic">Claude</option><option value="openai">ChatGPT</option></select>'
      act.prepend(w)
      $('afx-prov').value = localStorage.getItem('afx_prov') || 'auto'
      $('afx-prov').onchange = e => localStorage.setItem('afx_prov', e.target.value)
    }
    $('afx-foco').innerHTML = '<option value="">Toda la cartera</option>' + PROYECTOS.map(p => `<option value="${p.id}">${E(p.nombre)}</option>`).join('')
    const stEl = document.querySelector('#v-an-agente .ai-status')
    try {
      const { data: { session } } = await sb.auth.getSession()
      const r = await fetch('/api/ia', { headers: { Authorization: 'Bearer ' + session.access_token } })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      const names = j.proveedores.map(x => NOMBRE_PROV[x]).join(' + ')
      if (stEl) stEl.innerHTML = names ? `<span class="ai-dot"></span> Conectado · ${names} · tiempo real${j.datosMercado ? ' + datos de mercado' : ''}` : '⚠️ Sin claves de IA en Vercel'
      Array.from($('afx-prov').options).forEach(o => { if (o.value !== 'auto') o.disabled = !j.proveedores.includes(o.value) })
    } catch (e) { if (stEl) stEl.textContent = '⚠️ API no disponible (' + (e.message || 'sin /api') + ')' }
  }

  document.querySelectorAll('[data-v="an-agente"]').forEach(el => el.addEventListener('click', () => setTimeout(initAgente, 80)))
  document.querySelectorAll('[data-v="an-predictor"]').forEach(el => el.addEventListener('click', () => setTimeout(initPredictorExtra, 150)))
})()
