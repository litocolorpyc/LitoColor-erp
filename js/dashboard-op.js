// Dashboard OP (pedido nov-2026, Excel "Dashboard OP"): una fila por orden con
// costo presupuestado, mano de obra, otros costos, margen y estado; al hacer
// clic se despliega suborden por suborden. Es de solo lectura.
//  · Margen = costo presupuestado − mano de obra − otros costos.
//  · Mano de obra: valor de los registros de producción de la orden.
//  · Otros costos: todos los costos registrados con esa orden (consumos de
//    material, planchas, compras, terceros…).
import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { fmtCOP, fmtNum, etiquetaOrden, imprimirInforme, toast, MARCA } from './helpers.js';
import { estadoOrden, estadoBadgeHTML, nombreOrden, mostrarDetalleOrden } from './ordenes.js';
import { inductoresDePieza } from './inductores.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = v => Number(v) || 0;
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const nombreMes = k => k ? `${MESES[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}` : 'Sin fecha';

const CATEGORIAS = ['Planchas', 'Papel y cartón', 'Polipropileno', 'Colbón y pegantes', 'Argolla', 'Terceros', 'Otros'];
function categoriaDeCosto(m){
  const concepto = (DB.costos_conceptos.find(c => c.id === m.concepto_id) || {}).nombre || '';
  const t = `${m.comentario || ''} ${concepto}`.toLowerCase();
  if(/plancha/.test(t)) return 'Planchas';
  if(/argoll/.test(t)) return 'Argolla';
  if(/colb[oó]n|pegante/.test(t)) return 'Colbón y pegantes';
  if(/polipropileno/.test(t)) return 'Polipropileno';
  if(/\buv\b|barniz|encaratul|troquel|impresi[oó]n externa|tercer|maquila/.test(t)) return 'Terceros';
  if(/\b(cote|propalcote|bond|cartulina|cart[oó]n|papel|kraft|opalina|adhesivo|earth)\b/.test(t)) return 'Papel y cartón';
  return 'Otros';
}
const detalleDeCosto = m => (m.comentario || '').replace(/^Compra\s*No\.?\s*\S+\s*—\s*/i, '').replace(/^Consumo automático(\s*\(recalculado\))?\s*—\s*/i, '').trim()
  || (DB.costos_conceptos.find(c => c.id === m.concepto_id) || {}).nombre || 'Costo';

let presPiezas = [];      // presupuesto por suborden (tabla presupuesto_pieza)
let filasVisibles = [];
let abierta = null;       // orden desplegada

async function cargarPresupuestoPiezas(){
  const { data, error } = await sb.from('presupuesto_pieza').select('*');
  if(error){ console.error('No se pudo leer el presupuesto por suborden:', error); return; }
  presPiezas = data || [];
}

function totalPresupuesto(orden){
  const p = DB.presupuesto_orden.find(x => x.orden === orden);
  if(!p) return null;
  const t = p.total_costo != null ? num(p.total_costo) : num(p.costo) + num(p.imprevistos);
  return t > 0 ? t : null;
}

function calcularFilas(){
  const mo = new Map(), otros = new Map();
  DB.produccion.forEach(r => { if(r.orden != null) mo.set(r.orden, (mo.get(r.orden) || 0) + num(r.valorActividad)); });
  DB.costos_movimientos.forEach(m => { if(m.orden != null) otros.set(m.orden, (otros.get(m.orden) || 0) + num(m.valor)); });
  return DB.opp_ordenes.map(o => {
    const pres = totalPresupuesto(o.orden), m = mo.get(o.orden) || 0, ot = otros.get(o.orden) || 0;
    return { o, orden: o.orden, nombre: nombreOrden(o), mes: (o.fecha || '').slice(0, 7), pres, mo: m, otros: ot,
      margen: pres != null ? pres - m - ot : null, estado: estadoOrden(o) };
  });
}

function filtrar(){
  const q = $('dop-buscar').value.trim().toLowerCase(), mes = $('dop-mes').value, est = $('dop-estado').value;
  return calcularFilas().filter(f =>
    (!mes || f.mes === mes) && (!est || f.estado.label === est) &&
    (!q || f.nombre.toLowerCase().includes(q) || String(f.orden).includes(q))
  ).sort((a, b) => b.orden - a.orden);
}

// Totales: el margen solo suma las órdenes que tienen presupuesto, para no
// restarle al total el costo de órdenes que no tienen con qué compararse.
function sumar(filas){
  return filas.reduce((s, f) => ({ n: s.n + 1, conPres: s.conPres + (f.pres != null ? 1 : 0), pres: s.pres + (f.pres || 0),
    mo: s.mo + f.mo, otros: s.otros + f.otros, margen: s.margen + (f.margen || 0) }), { n: 0, conPres: 0, pres: 0, mo: 0, otros: 0, margen: 0 });
}
const margenHTML = v => v == null ? '<span class="card-hint">sin presupuesto</span>' : `<span style="color:${v >= 0 ? 'var(--good)' : 'var(--bad)'};font-weight:600">${fmtCOP(v)}</span>`;

function poblarFiltros(){
  const sel = $('dop-mes'), previo = sel.value;
  const meses = [...new Set(DB.opp_ordenes.map(o => (o.fecha || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  sel.innerHTML = '<option value="">Todos los meses</option>' + meses.map(m => `<option value="${m}">${nombreMes(m)}</option>`).join('');
  if(meses.includes(previo)) sel.value = previo;
}

export function renderDashboardOP(){
  if(!$('panel-dashboard-op')) return;
  poblarFiltros();
  const filas = filtrar();
  filasVisibles = filas;
  const t = sumar(filas);
  const kp = (l, v, s) => `<div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`;
  $('dop-kpis').innerHTML = [
    kp('Órdenes', t.n, `${t.conPres} con presupuesto`),
    kp('Costo presupuestado', fmtCOP(t.pres), 'suma de las órdenes con presupuesto'),
    kp('Costo mano de obra', fmtCOP(t.mo), 'según registros de producción'),
    kp('Otros costos', fmtCOP(t.otros), 'materiales, planchas, compras, terceros'),
    kp('Margen', margenHTML(t.conPres ? t.margen : null), 'presupuestado − real, solo órdenes con presupuesto')
  ].join('');

  $('tbl-dop').querySelector('tbody').innerHTML = filas.map(f => `<tr class="fila-clicable" data-orden="${f.orden}">
      <td>${abierta === f.orden ? '▾' : '▸'} <b>${esc(f.nombre)}</b></td>
      <td class="num">${f.pres != null ? fmtCOP(f.pres) : '—'}</td><td class="num">${fmtCOP(f.mo)}</td><td class="num">${fmtCOP(f.otros)}</td>
      <td class="num">${margenHTML(f.margen)}</td><td>${estadoBadgeHTML(f.estado)}</td></tr>`).join('')
    || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Ninguna orden coincide con los filtros</td></tr>';
  $('tbl-dop').querySelectorAll('tbody tr[data-orden]').forEach(tr => tr.addEventListener('click', () => {
    const o = parseInt(tr.dataset.orden, 10);
    abierta = abierta === o ? null : o;
    renderDashboardOP();
    if(abierta != null) $('dop-despliegue-card').scrollIntoView({ behavior: 'smooth' });
  }));

  pintarMeses();
  pintarDespliegue();
}

// Resumen mes a mes (según la fecha de la orden), con los filtros de estado y búsqueda.
function pintarMeses(){
  const q = $('dop-buscar').value.trim().toLowerCase(), est = $('dop-estado').value;
  const base = calcularFilas().filter(f => (!est || f.estado.label === est) && (!q || f.nombre.toLowerCase().includes(q) || String(f.orden).includes(q)));
  const meses = [...new Set(base.map(f => f.mes))].sort().reverse();
  const fila = (nombre, s, th) => { const c = th ? 'th' : 'td'; return `<${c}>${nombre}</${c}><${c} class="num">${s.n}</${c}><${c} class="num">${s.conPres}</${c}><${c} class="num">${fmtCOP(s.pres)}</${c}><${c} class="num">${fmtCOP(s.mo)}</${c}><${c} class="num">${fmtCOP(s.otros)}</${c}><${c} class="num">${margenHTML(s.conPres ? s.margen : null)}</${c}>`; };
  $('tbl-dop-meses').querySelector('tbody').innerHTML = meses.map(m => `<tr class="fila-clicable" data-mes="${m}">${fila(nombreMes(m), sumar(base.filter(f => f.mes === m)))}</tr>`).join('')
    || '<tr><td colspan="7" style="text-align:center;color:var(--ink-faint)">Sin datos</td></tr>';
  $('tbl-dop-meses').querySelector('tfoot').innerHTML = meses.length ? `<tr>${fila('Total', sumar(base), true)}</tr>` : '';
  $('tbl-dop-meses').querySelectorAll('[data-mes]').forEach(tr => tr.addEventListener('click', () => { $('dop-mes').value = tr.dataset.mes; abierta = null; renderDashboardOP(); }));
}

// ---------- despliegue de una orden ----------
function calcularDespliegue(orden){
  const piezas = DB.opp_piezas.filter(p => p.orden === orden).sort((a, b) => a.suborden - b.suborden);
  const columnas = piezas.map(p => ({ key: p.suborden, pieza: p, titulo: `${etiquetaOrden(orden)}-${p.suborden}`, sub: p.pieza || 'Pieza', cantidad: p.cantidad }));
  const claves = new Set(columnas.map(c => c.key));
  const clave = s => claves.has(s) ? s : 'general';
  const registros = DB.produccion.filter(r => r.orden === orden);
  const costos = DB.costos_movimientos.filter(m => m.orden === orden);
  if(registros.some(r => clave(r.suborden) === 'general') || costos.some(m => clave(m.suborden) === 'general'))
    columnas.push({ key: 'general', pieza: null, titulo: 'General', sub: 'sin suborden asignada' });

  const otros = {}, mo = {}, horas = {};
  const mas = (obj, fila, col, v) => { obj[fila] = obj[fila] || {}; obj[fila][col] = (obj[fila][col] || 0) + v; obj[fila].total = (obj[fila].total || 0) + v; };
  const lineas = costos.map(m => ({ col: clave(m.suborden), cat: categoriaDeCosto(m), detalle: detalleDeCosto(m), valor: num(m.valor), fecha: (m.fecha || '').slice(0, 10) }));
  lineas.forEach(l => mas(otros, l.cat, l.col, l.valor));
  registros.forEach(r => { const a = r.area || 'General'; mas(mo, a, clave(r.suborden), num(r.valorActividad)); mas(horas, a, clave(r.suborden), num(r.tiempoHr)); });
  const ordenArea = new Map(DB.areas.map(a => [a.nombre, a.orden ?? 999]));
  const areas = Object.keys(mo).sort((a, b) => (ordenArea.get(a) ?? 999) - (ordenArea.get(b) ?? 999) || a.localeCompare(b));
  const cats = CATEGORIAS.filter(c => otros[c]);
  const total = (obj, filas, col) => filas.reduce((s, f) => s + (obj[f][col] || 0), 0);
  const pres = new Map(presPiezas.filter(x => x.orden === orden).map(x => [x.suborden, x]));
  return { orden, piezas, columnas, otros, mo, horas, areas, cats, total, lineas, pres, registros };
}

function pintarDespliegue(){
  const card = $('dop-despliegue-card');
  const o = abierta != null ? DB.opp_ordenes.find(x => x.orden === abierta) : null;
  card.style.display = o ? '' : 'none';
  if(!o) return;
  const D = calcularDespliegue(o.orden);
  const cols = ['total', ...D.columnas.map(c => c.key)];
  $('dop-despliegue-titulo').textContent = nombreOrden(o);

  const cab = `<tr><th>Concepto</th><th class="num">OP ${etiquetaOrden(o.orden)}<div class="card-hint">total</div></th>${D.columnas.map(c => `<th class="num">${c.titulo}<div class="card-hint">${esc(c.sub)}${c.cantidad ? ' · ' + fmtNum(c.cantidad, 0) + ' uds' : ''}</div></th>`).join('')}</tr>`;
  const celdas = (f, tag = 'td') => cols.map(c => `<${tag} class="num">${f(c)}</${tag}>`).join('');
  const seccion = t => `<tr><th colspan="${cols.length + 1}" style="background:var(--bg-soft,#EEF3F9)">${t}</th></tr>`;
  const plata = v => v ? fmtCOP(v) : '—';
  const totOtros = c => D.total(D.otros, D.cats, c), totMO = c => D.total(D.mo, D.areas, c), real = c => totOtros(c) + totMO(c);
  const presDe = c => c === 'total' ? totalPresupuesto(o.orden) : (D.pres.get(c) ? num(D.pres.get(c).total_costo) : null);

  const cuerpo = [
    seccion('Otros costos'),
    ...D.cats.map(cat => `<tr><td>${cat}</td>${celdas(c => plata(D.otros[cat][c]))}</tr>`),
    `<tr><th>Total otros costos</th>${celdas(c => plata(totOtros(c)), 'th')}</tr>`,
    seccion('Costo mano de obra'),
    ...D.areas.map(a => `<tr><td>${esc(a)}</td>${celdas(c => D.mo[a][c] || D.horas[a][c] ? `${fmtCOP(D.mo[a][c] || 0)}<div class="card-hint">${fmtNum(D.horas[a][c] || 0, 2)} h</div>` : '—')}</tr>`),
    `<tr><th>Total mano de obra</th>${celdas(c => plata(totMO(c)), 'th')}</tr>`,
    seccion('Resultado'),
    `<tr><th>Costo real</th>${celdas(c => fmtCOP(real(c)), 'th')}</tr>`,
    `<tr><td>Costo presupuestado</td>${celdas(c => presDe(c) ? fmtCOP(presDe(c)) : '—')}</tr>`,
    `<tr><th>Margen (presupuestado − real)</th>${celdas(c => presDe(c) ? margenHTML(presDe(c) - real(c)) : '—', 'th')}</tr>`
  ].join('');
  $('tbl-dop-despliegue').innerHTML = `<thead>${cab}</thead><tbody>${cuerpo}</tbody>`;

  // presupuesto por ítem (el que trae el Excel de la orden)
  const items = [...new Set([...D.pres.values()].flatMap(p => (p.items || []).map(i => i.item)))];
  const valorItem = (c, item) => {
    const sumaDe = p => (p.items || []).filter(i => i.item === item).reduce((s, i) => s + num(i.valor), 0);
    return c === 'total' ? [...D.pres.values()].reduce((s, p) => s + sumaDe(p), 0) : (D.pres.get(c) ? sumaDe(D.pres.get(c)) : 0);
  };
  const sumaCampo = (c, campo) => c === 'total' ? [...D.pres.values()].reduce((s, p) => s + num(p[campo]), 0) : (D.pres.get(c) ? num(D.pres.get(c)[campo]) : 0);
  $('tbl-dop-presupuesto').innerHTML = items.length || D.pres.size
    ? `<thead>${cab}</thead><tbody>${items.map(i => `<tr><td>${esc(i)}</td>${celdas(c => plata(valorItem(c, i)))}</tr>`).join('')}
        ${[['Costo', 'costo'], ['Imprevistos', 'imprevistos'], ['Total costo presupuestado', 'total_costo'], ['Precio de venta antes de IVA', 'precio_venta_antes_iva']].map(([l, k]) => `<tr><th>${l}</th>${celdas(c => plata(sumaCampo(c, k)), 'th')}</tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="card-hint">Esta orden no tiene el presupuesto separado por suborden. Se carga solo al crear la orden con "Importar desde Excel".</td></tr></tbody>';

  // inductores
  const ind = D.piezas.flatMap(p => inductoresDePieza(p, D.registros).map(i => ({ p, ...i })));
  $('tbl-dop-inductores').querySelector('tbody').innerHTML = ind.map(i => `<tr>
      <td>${etiquetaOrden(o.orden)}-${i.p.suborden}</td><td>${esc(i.p.pieza || 'Pieza')}</td><td>${i.nombre}</td>
      <td class="num">${fmtNum(i.programado, i.dec)}</td><td class="num">${i.real == null ? '—' : fmtNum(i.real, i.dec)}</td>
      <td class="num">${i.real != null && i.programado ? fmtNum(i.real / i.programado * 100, 0) + '%' : '—'}</td>
      <td class="num">${i.reportado ? fmtNum(i.reportado, 0) : '—'}</td><td class="card-hint">${i.aviso}</td></tr>`).join('')
    || '<tr><td colspan="8" style="text-align:center;color:var(--ink-faint)">Ninguna suborden tiene inductores (faltan tamaños programados, medidas o tintas)</td></tr>';

  const nombreCol = new Map(D.columnas.map(c => [c.key, c.key === 'general' ? 'General' : `${c.titulo} ${c.sub}`]));
  const orden = new Map(D.columnas.map((c, i) => [c.key, i]));
  $('tbl-dop-lineas').querySelector('tbody').innerHTML = D.lineas.slice()
    .sort((a, b) => orden.get(a.col) - orden.get(b.col) || CATEGORIAS.indexOf(a.cat) - CATEGORIAS.indexOf(b.cat))
    .map(l => `<tr><td>${esc(nombreCol.get(l.col))}</td><td>${l.cat}</td><td>${esc(l.detalle)}</td><td>${l.fecha}</td><td class="num">${fmtCOP(l.valor)}</td></tr>`).join('')
    || '<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">Sin otros costos registrados</td></tr>';
}

function imprimirLista(){
  if(!filasVisibles.length){ toast('No hay órdenes para imprimir'); return; }
  const t = sumar(filasVisibles);
  imprimirInforme({ titulo: 'Dashboard OP', subtitulo: `${t.n} orden(es) · presupuestado ${fmtCOP(t.pres)} · mano de obra ${fmtCOP(t.mo)} · otros costos ${fmtCOP(t.otros)}`,
    secciones: [{ titulo: 'Costos por orden', columnas: [{ key: 'nombre', label: 'Orden' }, { key: 'pres', label: 'Costo presupuestado', num: true }, { key: 'mo', label: 'Costo mano de obra', num: true }, { key: 'otros', label: 'Otros costos', num: true }, { key: 'margen', label: 'Margen', num: true }, { key: 'estado', label: 'Estado' }],
      filas: filasVisibles.map(f => ({ nombre: esc(f.nombre), pres: f.pres != null ? fmtCOP(f.pres) : '—', mo: fmtCOP(f.mo), otros: fmtCOP(f.otros), margen: f.margen != null ? fmtCOP(f.margen) : '—', estado: `${f.estado.label}${f.estado.pct != null ? ' (' + f.estado.pct + '%)' : ''}` })) }] });
}

export function initDashboardOP(){
  if(!$('panel-dashboard-op')) return;
  const abrir = async () => { await cargarPresupuestoPiezas(); renderDashboardOP(); };
  document.querySelector('.tab-btn[data-tab="dashboard-op"]')?.addEventListener('click', abrir);
  ['dop-mes', 'dop-estado'].forEach(id => $(id).addEventListener('change', () => { abierta = null; renderDashboardOP(); }));
  $('dop-buscar').addEventListener('input', () => { abierta = null; renderDashboardOP(); });
  $('dop-imprimir').addEventListener('click', imprimirLista);
  $('dop-abrir-orden').addEventListener('click', () => {
    const orden = abierta;
    if(orden == null) return;
    document.querySelector('.tab-btn[data-tab="ordenes"]')?.click();
    setTimeout(() => mostrarDetalleOrden(orden), 50);
  });
  $('dop-cerrar').addEventListener('click', () => { abierta = null; renderDashboardOP(); });
  abrir();
}
