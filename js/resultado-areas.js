import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { getCurrentUser } from './auth.js';
import { AREAS_COMERCIALES, areaDeOrden } from './areas-comerciales.js';
import { fmtCOP, fmtNum, toast, exportarExcel, MARCA } from './helpers.js';

// Resultado por Área Comercial (Fase 7), con el modelo del Excel de Julián:
//   ventas por área  →  × % de margen de contribución del área  =  margen de contribución
//   margen de contribución total − costos fijos del mes          =  utilidad neta
//   punto de equilibrio mensual = costos fijos mensuales ÷ margen de contribución promedio
// Los costos fijos NO se reparten por área (como en el Excel); el reparto es una vista
// opcional para decisiones (por margen, por ventas o por horas registradas). Cada línea del
// plan de costos fijos se puede marcar como "cuenta como costo de la empresa", llevar un % a
// cargo de la empresa y estar asociada a un área comercial (ej. el arriendo de máquina).
// Solo la ve el Gerente: las tablas tienen lectura restringida en la base de datos.

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const COLOR = { 'Litografía': MARCA.blue, 'Servicio': MARCA.violet, 'Digital': MARCA.sky, 'Gran formato': MARCA.magenta, 'Tercero': MARCA.navy, 'Sin área': MARCA.slate };
const GRUPOS = ['Nómina y cargas', 'Bodega y servicios', 'Maquinaria', 'Seguros y salud', 'Impuestos', 'Administrativos', 'Financieros', 'Adicionales'];

let D = { vaa: [], plan: [], marg: [], cfg: {} };
let cargado = false, chart = null;
let anio = null, desde = 1, hasta = 12, reparto = 'ninguno';

const pct = (a, b) => b > 0 ? a / b * 100 : null;
const fp = v => v == null ? '—' : fmtNum(v, 1) + '%';
const fM = v => v == null ? '—' : '$' + fmtNum(v / 1e6, 1) + ' M';
const rol = () => (getCurrentUser() || {}).nombre || null;

async function cargarDatos(){
  const t = ['ventas_area_mensual', 'costos_fijos_plan', 'margen_area_param', 'config_resultado'];
  const r = await Promise.all(t.map(x => sb.from(x).select('*').limit(5000)));
  if(r.some(x => x.error)){ console.error(r.map(x => x.error).filter(Boolean)); return false; }
  D.vaa = r[0].data || []; D.plan = (r[1].data || []).sort((a, b) => a.anio - b.anio || a.orden - b.orden || a.id - b.id);
  D.marg = r[2].data || []; D.cfg = Object.fromEntries((r[3].data || []).map(x => [x.clave, Number(x.valor)]));
  return true;
}

// ---------- ventas por área y mes (Excel hasta su último mes; después, el aplicativo) ----------
function ventasPorMes(){
  const m = new Map();
  // Cada venta se guarda en tres partes (regla del Excel de Julián): facturas antes de IVA (f),
  // remisiones sin IVA (r) e IVA de las remisiones (i). El margen se calcula sobre f + r y el IVA
  // de la remisión se suma completo como ganancia.
  const suma = (a, mes, area, p, erp) => { const k = a * 100 + mes; if(!m.has(k)) m.set(k, { anio: a, mes, erp: false, v: {} }); const o = m.get(k); const x = o.v[area] || (o.v[area] = { f: 0, r: 0, i: 0 }); x.f += p.f || 0; x.r += p.r || 0; x.i += p.i || 0; if(erp) o.erp = true; };
  D.vaa.forEach(r => { const f = Number(r.facturas_sub) || 0, rs = Number(r.remisiones_sub) || 0, ri = Number(r.remisiones_iva) || 0; suma(r.anio, r.mes, r.area, (f + rs + ri) ? { f, r: rs, i: ri } : { f: Number(r.valor) || 0 }, false); });
  const corte = D.vaa.length ? Math.max(...D.vaa.map(r => r.anio * 100 + r.mes)) : 0;
  const ordenArea = new Map(DB.opp_ordenes.map(o => [o.orden, areaDeOrden(o)]));
  const fact = new Map(DB.facturas_venta.map(f => [f.id, f]));
  const rem = new Map(DB.remisiones.map(r => [r.id, r]));
  const lineas = [];
  DB.facturas_venta_items.forEach(it => { const f = fact.get(it.factura_id); if(f && f.fecha) lineas.push({ tabla: 'facturas_venta_items', it, fecha: String(f.fecha), valor: Number(it.valor_neto ?? it.valor_total) || 0, cliente: f.cliente, doc: 'Factura ' + (f.numero_factura || '') }); });
  DB.remision_items.forEach(it => { const r = rem.get(it.remision_id); if(r && r.fecha) lineas.push({ tabla: 'remision_items', rem: true, it, fecha: String(r.fecha), valor: Number(it.valor_total) || 0, cliente: r.cliente, doc: 'Remisión ' + (r.numero || '') }); });
  const sinArea = [];
  lineas.forEach(l => {
    const a = +l.fecha.slice(0, 4), mes = +l.fecha.slice(5, 7);
    if(a * 100 + mes <= corte) return;                               // esos meses ya están en el Excel
    const area = l.it.area_comercial || (l.it.orden != null ? ordenArea.get(l.it.orden) : null);
    if(!area) sinArea.push(l);
    suma(a, mes, area || 'Sin área', l.rem ? { r: l.valor / 1.19, i: l.valor - l.valor / 1.19 } : { f: l.valor }, true);
  });
  return { m, sinArea, lineas, corte };
}

// ---------- plan de costos fijos ----------
function planDe(a){
  const anios = [...new Set(D.plan.map(p => p.anio))].sort();
  if(!anios.length) return { lineas: [], fuente: a, prestado: false };
  const fuente = anios.includes(a) ? a : (a < anios[0] ? anios[0] : anios.filter(x => x < a).pop());
  return { lineas: D.plan.filter(p => p.anio === fuente), fuente, prestado: fuente !== a };
}
const imprev = a => D.cfg['imprevistos_' + a] ?? 0;
const montoLinea = l => l.cuenta_empresa ? Number(l.valor_mensual) * Number(l.pct_empresa) / 100 : 0;
function costoFijoMensual(a){
  const { lineas, fuente } = planDe(a);
  const base = lineas.reduce((s, l) => s + montoLinea(l), 0);
  const explicito = {};
  lineas.forEach(l => { if(l.area_comercial) explicito[l.area_comercial] = (explicito[l.area_comercial] || 0) + montoLinea(l); });
  const f = 1 + imprev(fuente) / 100;
  return { total: base * f, explicito: Object.fromEntries(Object.entries(explicito).map(([k, v]) => [k, v * f])), factor: f };
}
function margenPct(a, area){
  const exacto = D.marg.find(x => x.anio === a && x.area === area);
  if(exacto) return Number(exacto.margen_pct);
  const previos = D.marg.filter(x => x.area === area && x.anio < a).sort((x, y) => y.anio - x.anio);
  return previos.length ? Number(previos[0].margen_pct) : 0;
}

// ---------- cálculo del período ----------
function calcular(){
  const { m, sinArea } = ventasPorMes();
  const filas = Object.fromEntries([...AREAS_COMERCIALES, 'Sin área'].map(a => [a, { area: a, ventas: 0, contrib: 0, fijos: 0 }]));
  let fijosTotal = 0, meses = 0, ultimoMes = null;
  for(let mes = desde; mes <= hasta; mes++){
    const o = m.get(anio * 100 + mes); if(!o) continue;
    meses++; ultimoMes = mes;
    Object.entries(o.v).forEach(([area, x]) => { filas[area].ventas += x.f + x.r + x.i; filas[area].contrib += area === 'Sin área' ? 0 : (x.f + x.r) * margenPct(anio, area) / 100 + x.i; });
    fijosTotal += costoFijoMensual(anio).total;
  }
  const ventas = Object.values(filas).reduce((s, f) => s + f.ventas, 0), contrib = Object.values(filas).reduce((s, f) => s + f.contrib, 0);
  // reparto opcional de los costos fijos entre áreas
  if(reparto !== 'ninguno'){
    const cf = costoFijoMensual(anio), explicito = cf.explicito, totExp = Object.values(explicito).reduce((s, v) => s + v, 0);
    const resto = Math.max(0, cf.total - totExp) * meses;
    let base = {};
    if(reparto === 'ventas') AREAS_COMERCIALES.forEach(a => { base[a] = filas[a].ventas; });
    else if(reparto === 'horas') base = horasPorArea();
    else AREAS_COMERCIALES.forEach(a => { base[a] = filas[a].contrib; });
    let sb_ = Object.values(base).reduce((s, v) => s + v, 0);
    if(!(sb_ > 0)){ AREAS_COMERCIALES.forEach(a => { base[a] = filas[a].contrib; }); sb_ = Object.values(base).reduce((s, v) => s + v, 0); }
    AREAS_COMERCIALES.forEach(a => { filas[a].fijos = (explicito[a] || 0) * meses + (sb_ > 0 ? resto * (base[a] || 0) / sb_ : 0); });
  }
  const utilidad = contrib - fijosTotal;
  const cfm = costoFijoMensual(anio).total;
  return { filas, ventas, contrib, fijosTotal, utilidad, meses, ultimoMes, margenUtilidad: pct(utilidad, ventas), razon: ventas > 0 ? contrib / ventas : null, cfm, pe: ventas > 0 && contrib > 0 ? cfm / (contrib / ventas) : null, sinArea, promMensual: meses ? ventas / meses : null };
}

function horasPorArea(){
  const ordenArea = new Map(DB.opp_ordenes.map(o => [o.orden, areaDeOrden(o)]));
  const h = {}; AREAS_COMERCIALES.forEach(a => { h[a] = 0; });
  DB.produccion.forEach(r => {
    if(r.orden == null || !r.fecha) return;
    const a = +String(r.fecha).slice(0, 4), mes = +String(r.fecha).slice(5, 7);
    if(a !== anio || mes < desde || mes > hasta) return;
    h[ordenArea.get(r.orden) || 'Litografía'] += r.tiempoHr || 0;
  });
  return h;
}

// Ley 2101 de 2021: jornada de 46 → 44 h (2025) y 44 → 42 h (2026) por semana.
const horasSemana = (a, mes) => a <= 2024 ? 46 : a === 2025 ? (mes <= 6 ? 46 : 44) : a === 2026 ? (mes <= 6 ? 44 : 42) : 42;

// ---------- pantalla ----------
function pintar(){
  const R = calcular();
  const metaM = D.cfg.meta_margen ?? 35;
  const mu = R.margenUtilidad;
  const kp = (t, v, s, color) => `<div class="kpi"><div class="lbl">${t}</div><div class="val"${color ? ` style="color:${color}"` : ''}>${v}</div><div class="sub">${s}</div></div>`;
  $('ra-kpis').innerHTML = [
    kp('Ventas del período', fM(R.ventas), `${R.meses} mes(es) · ${MESES[desde - 1]}–${MESES[hasta - 1]} ${anio}`),
    kp('Margen de contribución', fM(R.contrib), R.razon != null ? fmtNum(R.razon * 100, 1) + '% de las ventas' : ''),
    kp('Costos fijos', fM(R.fijosTotal), `${fM(R.cfm)} al mes${planDe(anio).prestado ? ' · plan ' + planDe(anio).fuente : ''}`),
    kp('Utilidad neta', fM(R.utilidad), 'contribución − costos fijos', R.utilidad >= 0 ? 'var(--good)' : 'var(--bad)'),
    kp('Margen de utilidad', fp(mu), `meta ${metaM}% · ${mu == null ? '' : mu >= metaM ? 'cumple' : 'faltan ' + fmtNum(metaM - mu, 1) + ' puntos'}`, mu == null ? null : mu >= metaM ? 'var(--good)' : mu >= metaM * 0.6 ? MARCA.violet : 'var(--bad)'),
    kp('Punto de equilibrio', fM(R.pe), `ventas por mes · promedio real ${fM(R.promMensual)}`, R.pe != null && R.promMensual != null ? (R.promMensual >= R.pe ? 'var(--good)' : 'var(--bad)') : null)
  ].join('');

  const areas = [...AREAS_COMERCIALES, ...(R.filas['Sin área'].ventas ? ['Sin área'] : [])];
  const conReparto = reparto !== 'ninguno';
  $('ra-areas').innerHTML = `<table class="detalle-mini-table"><thead><tr><th>Área comercial</th><th class="num">Ventas</th><th class="num">% de ventas</th><th class="num">Margen asumido</th><th class="num">Margen de contribución</th>${conReparto ? '<th class="num">Costos fijos asignados</th><th class="num">Resultado</th>' : ''}</tr></thead><tbody>${areas.map(a => { const f = R.filas[a];
    return `<tr><td><b style="color:${COLOR[a]}">${a}</b></td><td class="num">${fmtCOP(f.ventas)}</td><td class="num">${fp(pct(f.ventas, R.ventas))}</td><td class="num">${a === 'Sin área' ? '—' : fp(margenPct(anio, a))}</td><td class="num">${fmtCOP(f.contrib)}</td>${conReparto ? `<td class="num">${a === 'Sin área' ? '—' : fmtCOP(f.fijos)}</td><td class="num" style="color:${f.contrib - f.fijos >= 0 ? 'var(--good)' : 'var(--bad)'};font-weight:600">${a === 'Sin área' ? '—' : fmtCOP(f.contrib - f.fijos)}</td>` : ''}</tr>`; }).join('')}</tbody>
    <tfoot><tr><th>Total</th><th class="num">${fmtCOP(R.ventas)}</th><th></th><th></th><th class="num">${fmtCOP(R.contrib)}</th>${conReparto ? `<th class="num">${fmtCOP(R.fijosTotal)}</th><th class="num">${fmtCOP(R.utilidad)}</th>` : ''}</tr></tfoot></table>
    <p class="card-hint" style="margin:6px 0 0">${conReparto ? 'Los costos fijos están repartidos entre las áreas con el criterio elegido (las líneas con un área asignada van completas a esa área).' : 'Sin repartir los costos fijos, como en el Excel: la utilidad neta sale del margen de contribución total menos los costos fijos totales.'}</p>`;

  if(typeof Chart !== 'undefined'){
    if(chart) chart.destroy();
    const ar = AREAS_COMERCIALES;
    chart = new Chart($('ra-chart'), { type: 'bar', data: { labels: ar, datasets: [
      { label: 'Ventas', data: ar.map(a => R.filas[a].ventas), backgroundColor: MARCA.sky },
      { label: 'Margen de contribución', data: ar.map(a => R.filas[a].contrib), backgroundColor: MARCA.blue },
      ...(conReparto ? [{ label: 'Resultado después de costos fijos', data: ar.map(a => R.filas[a].contrib - R.filas[a].fijos), backgroundColor: MARCA.magenta }] : [])] },
      options: { responsive: true, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtCOP(c.parsed.y)}` } } }, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(150,150,150,.15)' }, ticks: { font: { size: 10 }, callback: v => '$' + fmtNum(v / 1e6, 0) + ' M' } } } } });
  }
  pintarMargenReal(); pintarSinArea(R); pintarUtilizacion(); pintarMargenes();
}

// Margen real con los datos del aplicativo: ingreso de cada orden menos los costos registrados con esa orden.
function pintarMargenReal(){
  const { lineas } = ventasPorMes();
  const ordenArea = new Map(DB.opp_ordenes.map(o => [o.orden, areaDeOrden(o)]));
  const ing = new Map();
  lineas.forEach(l => { if(l.it.orden == null) return; const a = +l.fecha.slice(0, 4), mes = +l.fecha.slice(5, 7); if(a !== anio || mes < desde || mes > hasta) return; ing.set(l.it.orden, (ing.get(l.it.orden) || 0) + l.valor); });
  const costos = new Map(); DB.costos_movimientos.forEach(c => { if(c.orden != null) costos.set(c.orden, (costos.get(c.orden) || 0) + (Number(c.valor) || 0)); });
  const por = Object.fromEntries(AREAS_COMERCIALES.map(a => [a, { ing: 0, costo: 0, n: 0, conCosto: 0 }]));
  ing.forEach((v, o) => { const a = ordenArea.get(o) || 'Litografía'; por[a].ing += v; por[a].n++; if(costos.get(o)) { por[a].costo += costos.get(o); por[a].conCosto++; } });
  $('ra-real').innerHTML = `<table class="detalle-mini-table"><thead><tr><th>Área comercial</th><th class="num">Órdenes facturadas</th><th class="num">Con costos registrados</th><th class="num">Ingreso</th><th class="num">Costos con la orden</th><th class="num">Margen real</th><th class="num">Margen asumido</th></tr></thead><tbody>${AREAS_COMERCIALES.map(a => { const p = por[a]; const real = p.conCosto ? pct(p.ing - p.costo, p.ing) : null;
    return `<tr><td>${a}</td><td class="num">${p.n}</td><td class="num">${p.conCosto}</td><td class="num">${fmtCOP(p.ing)}</td><td class="num">${fmtCOP(p.costo)}</td><td class="num"><b>${fp(real)}</b></td><td class="num">${fp(margenPct(anio, a))}</td></tr>`; }).join('')}</tbody></table>
    <p class="card-hint" style="margin:6px 0 0">Margen real = (ingreso − costos registrados con la orden) ÷ ingreso, solo sobre órdenes facturadas en el aplicativo en este período que tienen costos con su número de orden. Mientras más compras y servicios se registren con la OP, más confiable.</p>`;
}

function pintarSinArea(R){
  const cont = $('ra-sinarea');
  const l = R.sinArea;
  $('ra-sinarea-card').style.display = l.length ? '' : 'none';
  cont.innerHTML = `<table class="detalle-mini-table"><thead><tr><th>Documento</th><th>Fecha</th><th>Cliente</th><th>Descripción</th><th class="num">Valor</th><th>Área comercial</th></tr></thead><tbody>${l.slice(0, 200).map((x, i) => `<tr><td>${esc(x.doc)}</td><td>${x.fecha.slice(0, 10)}</td><td>${esc(x.cliente || '—')}</td><td>${esc(x.it.descripcion || '')}</td><td class="num">${fmtCOP(x.valor)}</td>
    <td><select class="ra-asignar" data-i="${i}"><option value="">Asignar…</option>${AREAS_COMERCIALES.map(a => `<option>${a}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>`;
  cont.querySelectorAll('.ra-asignar').forEach(s => s.addEventListener('change', async () => {
    if(!s.value) return;
    const x = l[parseInt(s.dataset.i, 10)];
    const { error } = await sb.from(x.tabla).update({ area_comercial: s.value }).eq('id', x.it.id);
    if(error){ console.error(error); toast('No se pudo asignar el área'); return; }
    x.it.area_comercial = s.value; toast('Área asignada: ' + s.value); pintar();
  }));
}

function pintarUtilizacion(){
  const mes = hasta;
  const porOp = new Map();
  DB.produccion.forEach(r => {
    if(!r.fecha || !r.operario) return;
    const a = +String(r.fecha).slice(0, 4), m = +String(r.fecha).slice(5, 7);
    if(a !== anio || m !== mes) return;
    const k = r.operario.trim(); const o = porOp.get(k) || { h: 0, mo: 0 }; o.h += r.tiempoHr || 0; o.mo += r.valorActividad || 0; porOp.set(k, o);
  });
  const pagadas = horasSemana(anio, mes) * 52 / 12;
  const filas = [...porOp.entries()].filter(([, v]) => v.h >= 5).sort((a, b) => b[1].h - a[1].h);
  const tot = filas.reduce((s, [, v]) => ({ h: s.h + v.h, mo: s.mo + v.mo }), { h: 0, mo: 0 });
  $('ra-util').innerHTML = `<p class="card-hint" style="margin:0 0 6px">${MESES[mes - 1]} ${anio}: jornada de ${horasSemana(anio, mes)} h por semana (Ley 2101) ≈ <b>${fmtNum(pagadas, 0)} h pagadas al mes</b> por persona. Se listan las personas con 5 horas o más registradas en órdenes.</p>
    <table class="detalle-mini-table"><thead><tr><th>Operario</th><th class="num">Horas en órdenes</th><th class="num">Horas pagadas</th><th class="num">Utilización</th><th class="num">Mano de obra registrada</th></tr></thead><tbody>${filas.map(([n, v]) => { const u = v.h / pagadas * 100;
    return `<tr><td>${esc(n)}</td><td class="num">${fmtNum(v.h, 1)}</td><td class="num">${fmtNum(pagadas, 0)}</td><td class="num" style="color:${u >= 70 ? 'var(--good)' : u >= 40 ? MARCA.violet : 'var(--bad)'};font-weight:600">${fmtNum(u, 0)}%</td><td class="num">${fmtCOP(v.mo)}</td></tr>`; }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">Sin horas registradas en este mes</td></tr>'}</tbody>
    ${filas.length ? `<tfoot><tr><th>Total (${filas.length})</th><th class="num">${fmtNum(tot.h, 1)}</th><th class="num">${fmtNum(pagadas * filas.length, 0)}</th><th class="num">${fmtNum(tot.h / (pagadas * filas.length) * 100, 0)}%</th><th class="num">${fmtCOP(tot.mo)}</th></tr></tfoot>` : ''}</table>`;
}

// ---------- plan de costos fijos y parámetros (editables) ----------
function pintarMargenes(){
  const { lineas, fuente, prestado } = planDe(anio);
  const cf = costoFijoMensual(anio);
  $('ra-plan-aviso').innerHTML = prestado
    ? `El año ${anio} no tiene plan propio: se está usando el de ${fuente} (como hacía el Excel). <button type="button" class="btn-secondary" id="ra-copiar" style="margin:0 0 0 8px">Crear el plan ${anio} copiando el de ${fuente}</button>` : '';
  $('ra-copiar')?.addEventListener('click', copiarPlan);
  $('ra-plan').innerHTML = `<table class="detalle-mini-table"><thead><tr><th>Cuenta</th><th>Grupo</th><th>Concepto</th><th class="num">Valor mensual</th><th class="num">% empresa</th><th>Área comercial</th><th>Nota</th><th></th></tr></thead><tbody>${lineas.map(l => `<tr data-id="${l.id}"${l.cuenta_empresa ? '' : ' style="opacity:.55"'}>
    <td><input type="checkbox" class="ra-f" data-c="cuenta_empresa"${l.cuenta_empresa ? ' checked' : ''} title="¿Cuenta como costo de la empresa?"></td>
    <td><select class="ra-f" data-c="grupo">${[...new Set([...GRUPOS, l.grupo])].map(g => `<option${g === l.grupo ? ' selected' : ''}>${esc(g)}</option>`).join('')}</select></td>
    <td><input type="text" class="ra-f" data-c="concepto" value="${esc(l.concepto)}"></td>
    <td class="num"><input type="number" class="ra-f" data-c="valor_mensual" value="${Number(l.valor_mensual)}" min="0" style="width:120px;text-align:right"></td>
    <td class="num"><input type="number" class="ra-f" data-c="pct_empresa" value="${Number(l.pct_empresa)}" min="0" max="100" style="width:70px;text-align:right"></td>
    <td><select class="ra-f" data-c="area_comercial"><option value="">— general —</option>${AREAS_COMERCIALES.map(a => `<option${a === l.area_comercial ? ' selected' : ''}>${a}</option>`).join('')}</select></td>
    <td><input type="text" class="ra-f" data-c="nota" value="${esc(l.nota || '')}"></td>
    <td><button type="button" class="row-btn row-btn-danger" data-borrar="${l.id}">Quitar</button></td></tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--ink-faint)">No hay plan de costos fijos</td></tr>'}</tbody>
    <tfoot><tr><th colspan="3">Costo fijo mensual (solo líneas que cuentan${cf.factor > 1 ? `, +${fmtNum((cf.factor - 1) * 100, 0)}% de imprevistos` : ''})</th><th class="num">${fmtCOP(cf.total)}</th><th colspan="4"></th></tr></tfoot></table>`;
  $('ra-plan').querySelectorAll('.ra-f').forEach(el => el.addEventListener('change', () => guardarLinea(el)));
  $('ra-plan').querySelectorAll('[data-borrar]').forEach(b => b.addEventListener('click', () => borrarLinea(parseInt(b.dataset.borrar, 10))));
  $('ra-margenes').innerHTML = AREAS_COMERCIALES.map(a => `<div class="field" style="max-width:140px"><label>${a}</label><input type="number" class="ra-m" data-area="${esc(a)}" min="0" max="100" step="0.01" value="${margenPct(anio, a)}"></div>`).join('')
    + `<div class="field" style="max-width:150px"><label>Imprevistos ${fuente} (%)</label><input type="number" id="ra-imp" min="0" step="0.5" value="${imprev(fuente)}"></div><div class="field" style="max-width:150px"><label>Meta de margen (%)</label><input type="number" id="ra-meta" min="0" max="100" step="0.5" value="${D.cfg.meta_margen ?? 35}"></div>`;
  $('ra-margenes').querySelectorAll('.ra-m').forEach(el => el.addEventListener('change', async () => {
    const v = parseFloat(el.value); if(isNaN(v) || v < 0 || v > 100){ toast('El margen debe estar entre 0 y 100'); return; }
    const { error } = await sb.from('margen_area_param').upsert({ anio, area: el.dataset.area, margen_pct: v }, { onConflict: 'anio,area' });
    if(error){ console.error(error); toast('No se pudo guardar el margen'); return; }
    const i = D.marg.findIndex(x => x.anio === anio && x.area === el.dataset.area); if(i >= 0) D.marg[i].margen_pct = v; else D.marg.push({ anio, area: el.dataset.area, margen_pct: v });
    toast('Margen guardado'); pintar();
  }));
  const guardarCfg = async (clave, valor, desc) => { const { error } = await sb.from('config_resultado').upsert({ clave, valor, descripcion: desc }, { onConflict: 'clave' }); if(error){ console.error(error); toast('No se pudo guardar'); return; } D.cfg[clave] = valor; toast('Guardado'); pintar(); };
  $('ra-imp')?.addEventListener('change', e => guardarCfg('imprevistos_' + fuente, parseFloat(e.target.value) || 0, `Imprevistos sobre costos fijos ${fuente} (%)`));
  $('ra-meta')?.addEventListener('change', e => guardarCfg('meta_margen', parseFloat(e.target.value) || 0, 'Meta de margen de utilidad (%)'));
}

async function guardarLinea(el){
  const tr = el.closest('tr'), id = parseInt(tr.dataset.id, 10), c = el.dataset.c;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if(c === 'valor_mensual' || c === 'pct_empresa'){ v = parseFloat(v); if(isNaN(v) || v < 0 || (c === 'pct_empresa' && v > 100)){ toast('Valor no válido'); pintarMargenes(); return; } }
  if(c === 'area_comercial' || c === 'nota') v = v || null;
  if(c === 'concepto' && !v){ toast('El concepto no puede quedar vacío'); pintarMargenes(); return; }
  const { data, error } = await sb.from('costos_fijos_plan').update({ [c]: v, actualizado_por: rol(), actualizado_en: new Date().toISOString() }).eq('id', id).select();
  if(error){ console.error(error); toast('No se pudo guardar el cambio'); return; }
  const i = D.plan.findIndex(p => p.id === id); if(i >= 0) D.plan[i] = data[0] || { ...D.plan[i], [c]: v };
  pintar();
}
async function borrarLinea(id){
  const l = D.plan.find(p => p.id === id); if(!l || !confirm(`¿Quitar "${l.concepto}" del plan ${l.anio}? Si solo quieres que no cuente, desmarca la casilla "Cuenta".`)) return;
  const { error } = await sb.from('costos_fijos_plan').delete().eq('id', id);
  if(error){ console.error(error); toast('No se pudo quitar'); return; }
  D.plan = D.plan.filter(p => p.id !== id); toast('Línea quitada'); pintar();
}
async function agregarLinea(){
  const concepto = $('ra-n-concepto').value.trim(), valor = parseFloat($('ra-n-valor').value);
  if(!concepto || isNaN(valor) || valor < 0){ toast('Escribe el concepto y el valor mensual'); return; }
  const { fuente, prestado } = planDe(anio);
  if(prestado){ toast(`Primero crea el plan ${anio} (botón de arriba) para poder agregarle líneas`); return; }
  const fila = { anio, grupo: $('ra-n-grupo').value, concepto, valor_mensual: valor, cuenta_empresa: true, pct_empresa: 100, orden: 900, actualizado_por: rol() };
  const { data, error } = await sb.from('costos_fijos_plan').insert([fila]).select();
  if(error){ console.error(error); toast('No se pudo agregar'); return; }
  D.plan.push(data[0]); $('ra-n-concepto').value = ''; $('ra-n-valor').value = ''; toast('Línea agregada'); pintar();
}
async function copiarPlan(){
  const { fuente, lineas } = planDe(anio);
  const copias = lineas.map(l => ({ anio, grupo: l.grupo, concepto: l.concepto, valor_mensual: l.valor_mensual, cuenta_empresa: l.cuenta_empresa, pct_empresa: l.pct_empresa, area_comercial: l.area_comercial, nota: l.nota, orden: l.orden, actualizado_por: rol() }));
  const { data, error } = await sb.from('costos_fijos_plan').insert(copias).select();
  if(error){ console.error(error); toast('No se pudo crear el plan'); return; }
  D.plan.push(...data);
  if(D.cfg['imprevistos_' + anio] == null) await sb.from('config_resultado').upsert({ clave: 'imprevistos_' + anio, valor: imprev(fuente), descripcion: `Imprevistos sobre costos fijos ${anio} (%)` }, { onConflict: 'clave' }).then(() => { D.cfg['imprevistos_' + anio] = imprev(fuente); });
  toast(`Plan ${anio} creado con ${data.length} líneas (copia del ${fuente})`); pintar();
}

function exportar(){
  const R = calcular();
  exportarExcel(`LitoColor_resultado_areas_comerciales_${anio}.xlsx`, [
    { nombre: 'Resumen por área', filas: [...AREAS_COMERCIALES, 'Sin área'].map(a => ({ 'Área comercial': a, Ventas: Math.round(R.filas[a].ventas), 'Margen asumido (%)': a === 'Sin área' ? '' : margenPct(anio, a), 'Margen de contribución': Math.round(R.filas[a].contrib), 'Costos fijos asignados': reparto === 'ninguno' ? '' : Math.round(R.filas[a].fijos) })).concat([{ 'Área comercial': 'TOTAL', Ventas: Math.round(R.ventas), 'Margen de contribución': Math.round(R.contrib), 'Costos fijos asignados': Math.round(R.fijosTotal) }, { 'Área comercial': 'UTILIDAD NETA', Ventas: Math.round(R.utilidad) }]) },
    { nombre: 'Costos fijos ' + planDe(anio).fuente, filas: planDe(anio).lineas.map(l => ({ Cuenta: l.cuenta_empresa ? 'Sí' : 'No', Grupo: l.grupo, Concepto: l.concepto, 'Valor mensual': Number(l.valor_mensual), '% empresa': Number(l.pct_empresa), 'Área comercial': l.area_comercial || '', Nota: l.nota || '' })) }
  ]);
}

export function renderResultadoAreas(){ if(cargado) pintar(); }

async function abrir(){
  if(!(await cargarDatos())){ toast('No se pudieron leer los datos del resultado por área comercial'); return; }
  cargado = true;
  const anios = [...new Set([...D.vaa.map(r => r.anio), new Date().getFullYear()])].sort((a, b) => b - a);
  if(anio == null) anio = anios.includes(new Date().getFullYear()) ? new Date().getFullYear() : anios[0];
  $('ra-anio').innerHTML = anios.map(a => `<option${a === anio ? ' selected' : ''}>${a}</option>`).join('');
  ajustarMeses(true);
  const gr = $('ra-n-grupo'); if(gr) gr.innerHTML = GRUPOS.map(g => `<option>${g}</option>`).join('');
  pintar();
}
// Por defecto: de enero al último mes con ventas del año elegido.
function ajustarMeses(reiniciar){
  const { m } = ventasPorMes();
  const meses = [...m.values()].filter(o => o.anio === anio).map(o => o.mes);
  if(reiniciar){ desde = 1; hasta = meses.length ? Math.max(...meses) : 12; }
  const opts = sel => MESES.map((n, i) => `<option value="${i + 1}"${i + 1 === sel ? ' selected' : ''}>${n}</option>`).join('');
  $('ra-desde').innerHTML = opts(desde); $('ra-hasta').innerHTML = opts(hasta);
}

export function initResultadoAreas(){
  if(!$('panel-resultado-areas')) return;
  document.querySelector('.tab-btn[data-tab="resultado-areas"]')?.addEventListener('click', () => { if(!cargado) abrir(); else pintar(); });
  $('ra-actualizar').addEventListener('click', abrir);
  $('ra-anio').addEventListener('change', e => { anio = parseInt(e.target.value, 10); ajustarMeses(true); pintar(); });
  $('ra-desde').addEventListener('change', e => { desde = parseInt(e.target.value, 10); if(desde > hasta){ hasta = desde; ajustarMeses(false); } pintar(); });
  $('ra-hasta').addEventListener('change', e => { hasta = parseInt(e.target.value, 10); if(hasta < desde){ desde = hasta; ajustarMeses(false); } pintar(); });
  $('ra-reparto').addEventListener('change', e => { reparto = e.target.value; pintar(); });
  $('ra-exportar').addEventListener('click', () => { if(!cargado){ toast('Espera a que carguen los datos'); return; } exportar(); });
  $('ra-n-agregar').addEventListener('click', agregarLinea);
}
