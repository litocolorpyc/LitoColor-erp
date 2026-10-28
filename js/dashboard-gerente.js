import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { fmtCOP, fmtNum, MARCA, deltaBadge, exportarExcel, toast } from './helpers.js';

// Resumen gerencial (Fase 5): replica los 4 gráficos del Excel "Datos Importantes
// Litocolor" de Julián y sus tablas, con datos que SOLO puede leer el Gerente
// (las tablas tienen lectura restringida en la base; ver la migración
// 20261028151000). Reglas de diseño: barras una al lado de la otra (no
// apiladas) y colores de la marca. Después del último mes cargado del Excel,
// los meses nuevos salen de las facturas y remisiones del aplicativo.

const $ = id => document.getElementById(id);
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const AREAS = ['Litografía', 'Servicio', 'Digital', 'Gran formato', 'Tercero'];
const COLOR_AREA = { 'Litografía': MARCA.blue, 'Servicio': MARCA.violet, 'Digital': MARCA.sky, 'Gran formato': MARCA.magenta, 'Tercero': MARCA.navy };
const TIPOS_COMPRA = ['Papel', 'Planchas', 'Troqueles', 'Polietileno'];
const COLOR_COMPRA = { 'Papel': MARCA.blue, 'Planchas': MARCA.sky, 'Troqueles': MARCA.violet, 'Polietileno': MARCA.magenta };
// De más reciente a más antiguo: el año más nuevo siempre en magenta, los anteriores en azules cada vez más claros.
const PALETA_ANIOS = [MARCA.magenta, MARCA.navy, MARCA.blue, MARCA.sky, MARCA.violet, MARCA.raspberry, MARCA.coral, MARCA.orange, MARCA.slate, '#5F5D92'];

let D = { vm: [], va: [], vc: [], cm: [] };
let cargado = false;
let aniosVisibles = new Set();
let anioClientes = null;
const charts = {};

const fM = v => v == null || isNaN(v) ? '—' : '$' + fmtNum(v / 1e6, 1) + ' M';
const fCOPm = v => fmtCOP(v);
const pct = (a, b) => (b > 0 ? (a / b - 1) * 100 : null);
const fPct = v => v == null ? '—' : (v > 0 ? '+' : '') + fmtNum(v, 0) + '%';

function makeChart(id, config){
  const el = $(id); if(!el || typeof Chart === 'undefined') return;
  if(charts[id]) charts[id].destroy();
  charts[id] = new Chart(el, config);
}
const ejes = (extra = {}) => ({
  x: { grid: { display: false }, ticks: { font: { size: 10 } } },
  y: { grid: { color: 'rgba(150,150,150,.15)' }, ticks: { font: { size: 10 }, callback: v => '$' + fmtNum(v / 1e6, 0) + ' M' }, ...extra }
});
const tooltipCOP = { callbacks: { label: c => `${c.dataset.label}: ${fmtCOP(c.parsed.y ?? c.parsed.x)}` } };

// ---------- datos ----------
async function cargarDatos(){
  const tablas = ['ventas_mensual', 'ventas_area_mensual', 'ventas_cliente_anual', 'compras_mensual'];
  const res = await Promise.all(tablas.map(t => sb.from(t).select('*').limit(5000)));
  if(res.some(r => r.error)){ console.error(res.map(r => r.error).filter(Boolean)); return false; }
  [D.vm, D.va, D.vc, D.cm] = res.map(r => r.data || []);
  return true;
}

// Meses posteriores al último cargado del Excel: salen del aplicativo.
function ventasMensualCompleta(){
  const base = D.vm.map(r => ({ anio: r.anio, mes: r.mes, facturas: +r.facturas, remisiones: +r.remisiones, total: +r.total }));
  if(!base.length) return base;
  const ult = Math.max(...base.map(r => r.anio * 12 + r.mes));
  const erp = new Map();
  const suma = (fecha, campo, valor) => {
    const a = +fecha.slice(0, 4), m = +fecha.slice(5, 7);
    if(a * 12 + m <= ult) return;
    const k = a + '-' + m;
    if(!erp.has(k)) erp.set(k, { anio: a, mes: m, facturas: 0, remisiones: 0, total: 0, erp: true });
    erp.get(k)[campo] += +valor || 0;
  };
  DB.facturas_venta.forEach(f => f.fecha && suma(String(f.fecha), 'facturas', f.total_bruto));
  DB.remisiones.forEach(r => r.fecha && suma(String(r.fecha), 'remisiones', r.total));
  erp.forEach(r => { r.total = r.facturas + r.remisiones; });
  return [...base, ...erp.values()].sort((a, b) => a.anio - b.anio || a.mes - b.mes);
}

// ---------- cálculos ----------
function calc(vm){
  const porAnio = {}; // anio -> [12 meses] total
  vm.forEach(r => { (porAnio[r.anio] ||= Array(12).fill(null))[r.mes - 1] = r.total; });
  const anios = Object.keys(porAnio).map(Number).sort((a, b) => a - b);
  const ultimo = vm[vm.length - 1];
  const sumaAnio = a => porAnio[a].reduce((s, v) => s + (v || 0), 0);
  const sumaHasta = (a, m) => porAnio[a].slice(0, m).reduce((s, v) => s + (v || 0), 0);
  // promedio de los últimos 3 años con dato de cada mes (mismo criterio del Excel)
  const prom3 = Array.from({ length: 12 }, (_, i) => {
    const vals = anios.filter(a => porAnio[a][i]).slice(-3).map(a => porAnio[a][i]);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  });
  return { porAnio, anios, ultimo, sumaAnio, sumaHasta, prom3 };
}
function tendencia(serie){
  const pts = serie.map((y, i) => [i, y]).filter(p => p[1] != null);
  const n = pts.length; if(n < 2) return serie.map(() => null);
  const sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0);
  const sxy = pts.reduce((s, p) => s + p[0] * p[1], 0), sxx = pts.reduce((s, p) => s + p[0] * p[0], 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
  return serie.map((_, i) => a + b * i);
}
const colorAnio = (a, seleccion) => PALETA_ANIOS[(seleccion.length - 1 - seleccion.indexOf(a)) % PALETA_ANIOS.length];

// ---------- piezas de la pantalla ----------
function kpis(c, vm){
  const { porAnio, anios, ultimo, sumaHasta, sumaAnio } = c;
  const a = ultimo.anio, m = ultimo.mes;
  const mesActual = ultimo.total, mesAntes = porAnio[a - 1] ? porAnio[a - 1][m - 1] : null;
  const acum = sumaHasta(a, m), acumAntes = porAnio[a - 1] ? sumaHasta(a - 1, m) : null;
  const hoy = new Date(); const diaDelAnio = a === hoy.getFullYear() ? Math.floor((hoy - new Date(a, 0, 0)) / 86400000) : 365;
  const diasHasta = Math.min(diaDelAnio, Math.round((new Date(a, m, 0) - new Date(a, 0, 0)) / 86400000));
  let mejor = { total: 0 };
  vm.forEach(r => { if(r.total > mejor.total) mejor = r; });
  const clientesAnio = D.vc.filter(r => r.anio === a).sort((x, y) => y.valor - x.valor);
  const totClientes = clientesAnio.reduce((s, r) => s + +r.valor, 0);
  const tarjeta = (l, v, s) => `<div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`;
  $('dg-kpis').innerHTML = [
    tarjeta(`Ventas de ${MESES_LARGO[m - 1].toLowerCase()} ${a}`, `${fM(mesActual)} ${deltaBadge(mesActual, mesAntes)}`, `vs. ${MESES_LARGO[m - 1].toLowerCase()} ${a - 1}: ${fM(mesAntes)}${ultimo.erp ? ' · desde el aplicativo' : ''}`),
    tarjeta(`Acumulado ${a} (ene–${MESES[m - 1].toLowerCase()})`, `${fM(acum)} ${deltaBadge(acum, acumAntes)}`, `mismo periodo ${a - 1}: ${fM(acumAntes)}`),
    tarjeta('Promedio mensual del año', fM(acum / m), `venta diaria ≈ ${fM(acum / diasHasta)}`),
    tarjeta('Mejor mes histórico', fM(mejor.total), `${MESES_LARGO[(mejor.mes || 1) - 1]} ${mejor.anio}`),
    tarjeta(`Mejor cliente ${a}`, clientesAnio[0] ? clientesAnio[0].cliente : '—', clientesAnio[0] ? `${fM(+clientesAnio[0].valor)} · ${fmtNum(+clientesAnio[0].valor / totClientes * 100, 0)}% de las ventas` : '')
  ].join('');
  $('dg-hint').textContent = `Histórico del Excel de Julián hasta ${MESES_LARGO[Math.max(...D.vm.filter(r => r.anio === Math.max(...D.vm.map(x => x.anio))).map(r => r.mes)) - 1].toLowerCase()} de ${Math.max(...D.vm.map(r => r.anio))}` +
    `${vm.some(r => r.erp) ? ' · meses siguientes tomados de las facturas y remisiones del aplicativo' : ''}. Ventas = facturas antes de IVA + remisiones (por su valor total).`;
}

function graficoAnioContraAnio(c){
  const { porAnio, anios } = c;
  const chips = $('dg-chips');
  if(!aniosVisibles.size) anios.slice(-4).forEach(a => aniosVisibles.add(a));
  chips.innerHTML = anios.slice().reverse().map(a => `<button type="button" class="preset-btn${aniosVisibles.has(a) ? ' active' : ''}" data-anio="${a}">${a}</button>`).join('');
  chips.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const a = +b.dataset.anio; aniosVisibles.has(a) ? aniosVisibles.delete(a) : aniosVisibles.add(a);
    if(!aniosVisibles.size) aniosVisibles.add(a);
    graficoAnioContraAnio(c);
  }));
  const sel = anios.filter(a => aniosVisibles.has(a));
  makeChart('dg-ch-anios', { type: 'bar', data: { labels: MESES, datasets: sel.map(a => ({ label: String(a), data: porAnio[a], backgroundColor: colorAnio(a, sel) })) },
    options: { responsive: true, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: tooltipCOP }, scales: ejes() } });
}

function graficoCrecimiento(c){
  const { anios, sumaAnio, ultimo } = c;
  const tot = anios.map(a => sumaAnio(a));
  const labels = anios.map(a => a === ultimo.anio && ultimo.mes < 12 ? `${a} (a ${MESES[ultimo.mes - 1].toLowerCase()})` : String(a));
  makeChart('dg-ch-crec', { type: 'line', data: { labels, datasets: [{ label: 'Ventas del año', data: tot, borderColor: MARCA.magenta, backgroundColor: MARCA.magenta, pointRadius: 4, tension: 0 }] },
    options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => {
      const i = ctx.dataIndex, g = i > 0 ? pct(tot[i], tot[i - 1]) : null;
      return `${fmtCOP(tot[i])}${g != null ? '  (' + fPct(g) + ' vs. año anterior)' : ''}`; } } } }, scales: ejes() } });
  $('dg-crec-tabla').innerHTML = `<table class="detalle-mini-table"><thead><tr><th>Año</th>${anios.map(a => `<th class="num">${a}</th>`).join('')}</tr></thead><tbody>
    <tr><td>Ventas</td>${tot.map(v => `<td class="num">${fM(v)}</td>`).join('')}</tr>
    <tr><td>Crecimiento</td>${tot.map((v, i) => { const g = i ? pct(v, tot[i - 1]) : null; return `<td class="num" style="color:${g == null ? 'inherit' : g >= 0 ? 'var(--blue)' : 'var(--bad)'};font-weight:600">${fPct(g)}</td>`; }).join('')}</tr></tbody></table>`;
}

function graficoComportamiento(c){
  const { porAnio, prom3, ultimo } = c;
  const tend = tendencia(prom3);
  makeChart('dg-ch-comport', { type: 'line', data: { labels: MESES, datasets: [
    { label: 'Promedio de los últimos 3 años', data: prom3, borderColor: MARCA.blue, backgroundColor: MARCA.blue, pointRadius: 3, tension: 0 },
    { label: 'Tendencia', data: tend, borderColor: MARCA.slate, borderDash: [6, 5], pointRadius: 0 },
    { label: `Este año (${ultimo.anio})`, data: porAnio[ultimo.anio], borderColor: MARCA.magenta, backgroundColor: MARCA.magenta, pointRadius: 3, tension: 0 }
  ] }, options: { responsive: true, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: tooltipCOP }, scales: ejes() } });
}

function graficoAreas(){
  const anios = [...new Set(D.va.map(r => r.anio))].sort();
  const val = (a, ar) => D.va.filter(r => r.anio === a && r.area === ar).reduce((s, r) => s + +r.valor, 0);
  makeChart('dg-ch-areas', { type: 'line', data: { labels: anios.map(String), datasets: AREAS.map(ar => ({ label: ar, data: anios.map(a => val(a, ar)), borderColor: COLOR_AREA[ar], backgroundColor: COLOR_AREA[ar], pointRadius: 3, tension: 0 })) },
    options: { responsive: true, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: tooltipCOP }, scales: ejes() } });
  const totA = a => AREAS.reduce((s, ar) => s + val(a, ar), 0);
  $('dg-areas-tabla').innerHTML = `<table class="detalle-mini-table"><thead><tr><th>Área</th>${anios.map(a => `<th class="num">${a}</th>`).join('')}<th class="num">% último año</th></tr></thead><tbody>${AREAS.map(ar => {
    const ult = anios[anios.length - 1];
    return `<tr><td>${ar}</td>${anios.map(a => `<td class="num">${fM(val(a, ar))}</td>`).join('')}<td class="num">${fmtNum(totA(ult) ? val(ult, ar) / totA(ult) * 100 : 0, 0)}%</td></tr>`; }).join('')}</tbody></table>`;
}

function tablaCrecimientoMes(c){
  const { porAnio, anios } = c;
  const cols = anios.filter(a => porAnio[a - 1]);
  const celda = (a, i) => {
    const act = porAnio[a][i], ant = porAnio[a - 1][i];
    const g = act != null && ant > 0 ? (act / ant - 1) * 100 : null;
    if(g == null) return '<td class="num">—</td>';
    const alfa = Math.min(.65, Math.abs(g) / 100 * .5 + .08);
    const bg = g >= 0 ? `rgba(73,159,212,${alfa})` : `rgba(200,33,105,${alfa})`;
    return `<td class="num" style="background:${bg}">${fPct(g)}</td>`;
  };
  $('dg-crec-mes').innerHTML = `<table class="detalle-mini-table"><thead><tr><th>Mes</th>${cols.map(a => `<th class="num">${a - 1}–${a}</th>`).join('')}</tr></thead><tbody>
    ${MESES_LARGO.map((m, i) => `<tr><td>${m}</td>${cols.map(a => celda(a, i)).join('')}</tr>`).join('')}</tbody></table>`;
}

function tablaAnioEnCurso(vm, c){
  const a = c.ultimo.anio;
  const filas = vm.filter(r => r.anio === a);
  let acum = 0;
  const html = filas.map(r => { acum += r.total; return `<tr><td>${MESES_LARGO[r.mes - 1]}${r.erp ? ' <span class="card-hint">(aplicativo)</span>' : ''}</td><td class="num">${fCOPm(r.remisiones)}</td><td class="num">${fCOPm(r.facturas)}</td><td class="num"><b>${fCOPm(r.total)}</b></td><td class="num">${fCOPm(acum)}</td><td class="num">${r.total ? fmtNum(r.remisiones / r.total * 100, 0) + '%' : '—'}</td></tr>`; }).join('');
  const rem = filas.reduce((s, r) => s + r.remisiones, 0), fac = filas.reduce((s, r) => s + r.facturas, 0);
  $('dg-anio-actual').innerHTML = `<h3 style="margin:0 0 8px">Ventas ${a}: remisiones y facturas</h3><div class="table-wrap"><table class="detalle-mini-table"><thead><tr><th>Mes</th><th class="num">Remisiones</th><th class="num">Facturas</th><th class="num">Total mes</th><th class="num">Acumulado</th><th class="num">% remisiones</th></tr></thead><tbody>${html}</tbody>
    <tfoot><tr><th>Total</th><th class="num">${fCOPm(rem)}</th><th class="num">${fCOPm(fac)}</th><th class="num">${fCOPm(rem + fac)}</th><th></th><th class="num">${rem + fac ? fmtNum(rem / (rem + fac) * 100, 0) + '%' : '—'}</th></tr></tfoot></table></div>`;
}

function graficoFacturasRemisiones(vm){
  const por = {};
  vm.forEach(r => { (por[r.anio] ||= { f: 0, r: 0 }); por[r.anio].f += r.facturas; por[r.anio].r += r.remisiones; });
  const anios = Object.keys(por).map(Number).filter(a => por[a].r > 0).sort();
  makeChart('dg-ch-fr', { type: 'bar', data: { labels: anios.map(String), datasets: [
    { label: 'Facturas', data: anios.map(a => por[a].f), backgroundColor: MARCA.blue },
    { label: 'Remisiones', data: anios.map(a => por[a].r), backgroundColor: MARCA.magenta }] },
    options: { responsive: true, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: tooltipCOP }, scales: ejes() } });
}

function graficoCompras(vm){
  const anios = [...new Set(D.cm.map(r => r.anio))].sort();
  const val = (a, t) => D.cm.filter(r => r.anio === a && r.tipo === t).reduce((s, r) => s + +r.subtotal, 0);
  makeChart('dg-ch-compras', { type: 'bar', data: { labels: anios.map(String), datasets: TIPOS_COMPRA.map(t => ({ label: t, data: anios.map(a => val(a, t)), backgroundColor: COLOR_COMPRA[t] })) },
    options: { responsive: true, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: tooltipCOP }, scales: ejes() } });
  const ventasAnio = a => vm.filter(r => r.anio === a).reduce((s, r) => s + r.total, 0);
  $('dg-compras-tabla').innerHTML = `<table class="detalle-mini-table"><thead><tr><th>Año</th>${anios.map(a => `<th class="num">${a}</th>`).join('')}</tr></thead><tbody>
    <tr><td>Compras (papel, planchas, troqueles, polietileno)</td>${anios.map(a => `<td class="num">${fM(TIPOS_COMPRA.reduce((s, t) => s + val(a, t), 0))}</td>`).join('')}</tr>
    <tr><td>Compras como % de las ventas</td>${anios.map(a => { const v = ventasAnio(a); const cc = TIPOS_COMPRA.reduce((s, t) => s + val(a, t), 0); return `<td class="num">${v ? fmtNum(cc / v * 100, 0) + '%' : '—'}</td>`; }).join('')}</tr></tbody></table>`;
}

function clientes(){
  const anios = [...new Set(D.vc.map(r => r.anio))].sort();
  if(!anioClientes) anioClientes = anios[anios.length - 1];
  const sel = $('dg-cli-anio');
  sel.innerHTML = anios.slice().reverse().map(a => `<option${a === anioClientes ? ' selected' : ''}>${a}</option>`).join('');
  sel.onchange = () => { anioClientes = +sel.value; clientes(); };
  const lista = D.vc.filter(r => r.anio === anioClientes).sort((x, y) => y.valor - x.valor);
  const total = lista.reduce((s, r) => s + +r.valor, 0);
  const top = lista.slice(0, 10);
  makeChart('dg-ch-cli', { type: 'bar', data: { labels: top.map(r => r.cliente), datasets: [{ label: 'Ventas', data: top.map(r => +r.valor), backgroundColor: MARCA.blue }] },
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmtCOP(c.parsed.x)} · ${fmtNum(c.parsed.x / total * 100, 1)}%` } } },
      scales: { x: { grid: { color: 'rgba(150,150,150,.15)' }, ticks: { font: { size: 10 }, callback: v => '$' + fmtNum(v / 1e6, 0) + ' M' } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } } } });
  $('dg-cli-tabla').innerHTML = `<table class="detalle-mini-table"><thead><tr><th>#</th><th>Cliente</th><th class="num">Ventas ${anioClientes}</th><th class="num">% del total</th></tr></thead><tbody>${top.map((r, i) =>
    `<tr><td>${i + 1}</td><td>${r.cliente}</td><td class="num">${fCOPm(+r.valor)}</td><td class="num">${fmtNum(+r.valor / total * 100, 1)}%</td></tr>`).join('')}</tbody>
    <tfoot><tr><th></th><th>${lista.length} clientes · Total</th><th class="num">${fCOPm(total)}</th><th></th></tr></tfoot></table>`;
}

function exportar(){
  const vm = ventasMensualCompleta();
  exportarExcel('LitoColor_ventas_historico.xlsx', [
    { nombre: 'Ventas por mes', filas: vm.map(r => ({ Año: r.anio, Mes: MESES_LARGO[r.mes - 1], Facturas: Math.round(r.facturas), Remisiones: Math.round(r.remisiones), 'Total mes': Math.round(r.total), Fuente: r.erp ? 'Aplicativo' : 'Excel de Julián' })) },
    { nombre: 'Ventas por área', filas: D.va.map(r => ({ Año: r.anio, Mes: MESES_LARGO[r.mes - 1], Área: r.area, Ventas: Math.round(r.valor) })) },
    { nombre: 'Ventas por cliente', filas: D.vc.map(r => ({ Año: r.anio, Cliente: r.cliente, Ventas: Math.round(r.valor) })) },
    { nombre: 'Compras de materiales', filas: D.cm.map(r => ({ Año: r.anio, Mes: MESES_LARGO[r.mes - 1], Tipo: r.tipo, 'Subtotal (antes de IVA)': Math.round(r.subtotal), Unidades: r.unidades })) }
  ]);
}

// ---------- pantalla ----------
export function renderDashboardGerente(){
  if(!cargado) return;
  if(!D.vm.length){
    $('dg-kpis').innerHTML = '<div class="kpi" style="grid-column:1/-1"><div class="lbl">Sin datos</div><div class="sub">Esta información solo la puede ver el Gerente con su propio usuario, o todavía no se ha cargado.</div></div>';
    ['dg-contenido'].forEach(id => $(id) && ($(id).style.display = 'none'));
    return;
  }
  $('dg-contenido').style.display = '';
  const vm = ventasMensualCompleta(), c = calc(vm);
  kpis(c, vm); graficoAnioContraAnio(c); graficoCrecimiento(c); graficoComportamiento(c); graficoAreas();
  tablaCrecimientoMes(c); tablaAnioEnCurso(vm, c); graficoFacturasRemisiones(vm); graficoCompras(vm); clientes();
}

async function abrir(){
  const ok = await cargarDatos();
  if(!ok){ toast('No se pudieron leer los datos del resumen gerencial'); return; }
  cargado = true;
  renderDashboardGerente();
}

export function initDashboardGerente(){
  if(!$('panel-dashboard-gerente')) return;
  document.querySelector('.tab-btn[data-tab="dashboard-gerente"]')?.addEventListener('click', () => { if(!cargado) abrir(); else renderDashboardGerente(); });
  $('dg-actualizar')?.addEventListener('click', abrir);
  $('dg-exportar')?.addEventListener('click', () => { if(!cargado){ toast('Espera a que carguen los datos'); return; } exportar(); });
}
