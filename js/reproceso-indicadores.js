import { DB } from './store.js';
import { fmtCOP, fmtNum, MARCA, exportarExcel, imprimirInforme, toast } from './helpers.js';
import { agruparReprocesosPorOP, movimientosPorProduccion } from './reproceso-costos.js';
import { evidenciasDe } from './evidencias.js';

// Indicadores del procedimiento de manejo de daños (sección 10 de PR-PROD-DAÑ-01),
// con meta y semáforo, por mes. Se dibujan en dos lugares: la pestaña Reprocesos
// (prefijo "rep-ind") y el tablero Gerencial (prefijo "ger-ind").
//
//  1. Tasa de daños        = casos de daño ÷ órdenes trabajadas del mes        meta ≤ 3 %
//  2. Costo de daños / ventas = costo de los daños ÷ ventas del mes            meta ≤ 1 %
//  3. Tiempo de cierre     = días desde el primer proceso hasta el cierre      meta ≤ 10 días
//  4. % con causa raíz     = casos con causa raíz definida ÷ casos             meta ≥ 95 %
//  5. Recurrencia          = casos repetidos (mismo motivo y área, 90 días) ÷ casos   meta ≤ 5 %
//  6. % expedientes completos = casos cerrados con todo el expediente ÷ cerrados      meta ≥ 98 %
// Un caso cuenta en el mes en que se detecta (su primer proceso). Los "casos" son los
// reprocesos (uno por OP) más los daños de maquinaria e infraestructura.
// Las ventas del mes son las facturas (antes de IVA) y remisiones registradas en el
// aplicativo; si un mes no tiene ventas cargadas, el costo sobre ventas sale "—".

export const METAS = { tasa: 3, costoVentas: 1, cierre: 10, causa: 95, recurrencia: 5, expediente: 98 };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const ym = f => String(f || '').slice(0, 7);
const dias = (a, b) => Math.round((new Date(String(b).slice(0, 10)) - new Date(String(a).slice(0, 10))) / 86400000);
const lleno = v => v != null && String(v).trim() !== '';
const pct = (n, d) => d > 0 ? n / d * 100 : null;

function casosDe(){
  const grupos = agruparReprocesosPorOP(DB.produccion.filter(r => r.reproceso === 'Si'), movimientosPorProduccion());
  const casos = grupos.map(g => {
    const c = (DB.reproceso_casos || []).find(x => x.clave === g.key) || {};
    return { tipo: 'Reproceso', clave: g.key, inicio: g.fechaIni.slice(0, 10), costo: g.costos.total, motivo: g.motivo, origen: g.areaOrigen, caso: c };
  });
  (DB.danos_equipos || []).forEach(d => casos.push({
    tipo: 'Equipo', clave: 'd' + d.id, inicio: String(d.fecha).slice(0, 10), costo: Number(d.costo) || 0, motivo: d.tipo, origen: d.area || d.maquina || null,
    caso: { estado: d.estado, fecha_cierre: d.fecha_cierre, causa_raiz: d.causa_raiz, accion_correctiva: d.accion_correctiva, severidad: d.severidad, clasificacion: d.tipo, lecciones: 'n/a', causa_tipo: 'n/a' }
  }));
  return casos;
}

function completo(c){
  const k = c.caso || {};
  const base = lleno(k.severidad) && lleno(k.clasificacion) && lleno(k.causa_raiz) && lleno(k.accion_correctiva) && lleno(k.lecciones) && lleno(k.causa_tipo);
  return base && evidenciasDe(c.clave).length > 0;
}

export function calcularIndicadores(nMeses){
  const hoy = new Date();
  const meses = [];
  for(let i = nMeses - 1; i >= 0; i--){ const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1); meses.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
  const casos = casosDe();
  const ordenesMes = {}; DB.produccion.forEach(r => { if(r.orden != null && r.fecha){ (ordenesMes[ym(r.fecha)] ||= new Set()).add(r.orden); } });
  const ventasMes = {};
  DB.facturas_venta.forEach(f => { if(f.fecha) ventasMes[ym(f.fecha)] = (ventasMes[ym(f.fecha)] || 0) + (Number(f.total_bruto) || 0); });
  DB.remisiones.forEach(r => { if(r.fecha) ventasMes[ym(r.fecha)] = (ventasMes[ym(r.fecha)] || 0) + (Number(r.total) || 0); });
  const esRepetido = c => c.motivo && c.origen && casos.some(o => o !== c && o.motivo === c.motivo && o.origen === c.origen && o.inicio < c.inicio && dias(o.inicio, c.inicio) <= 90);

  return meses.map(m => {
    const delMes = casos.filter(c => ym(c.inicio) === m);
    const reprocesos = delMes.filter(c => c.tipo === 'Reproceso').length, equipos = delMes.filter(c => c.tipo === 'Equipo').length;
    const ops = ordenesMes[m] ? ordenesMes[m].size : 0;
    const costo = delMes.reduce((s, c) => s + c.costo, 0);
    const ventas = ventasMes[m] || 0;
    const cerrados = casos.filter(c => c.caso.estado === 'Cerrado' && c.caso.fecha_cierre && ym(c.caso.fecha_cierre) === m);
    const tCierre = cerrados.length ? cerrados.reduce((s, c) => s + dias(c.inicio, c.caso.fecha_cierre), 0) / cerrados.length : null;
    return {
      mes: m, etiqueta: MESES[+m.slice(5) - 1] + ' ' + m.slice(2, 4),
      ops, reprocesos, equipos, casos: delMes.length,
      tasa: ops ? pct(delMes.length, ops) : null,
      costo, ventas, costoVentas: ventas ? pct(costo, ventas) : null,
      cierres: cerrados.length, tCierre,
      causa: delMes.length ? pct(delMes.filter(c => lleno(c.caso.causa_raiz)).length, delMes.length) : null,
      recurrencia: delMes.length ? pct(delMes.filter(esRepetido).length, delMes.length) : null,
      expediente: cerrados.length ? pct(cerrados.filter(completo).length, cerrados.length) : null
    };
  });
}

// Semáforo: verde si cumple la meta; violeta si está cerca; frambuesa si está lejos.
function nivel(clave, v){
  if(v == null) return 'nd';
  const m = METAS[clave];
  if(['tasa', 'costoVentas', 'cierre', 'recurrencia'].includes(clave)) return v <= m ? 'ok' : v <= m * 1.5 ? 'cerca' : 'lejos';
  return v >= m ? 'ok' : v >= m - 15 ? 'cerca' : 'lejos';
}
const COLOR = { ok: 'var(--good)', cerca: MARCA.violet, lejos: 'var(--bad)', nd: 'var(--ink-faint)' };
const punto = n => `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${COLOR[n]};margin-right:5px"></span>`;
const f1 = v => v == null ? '—' : fmtNum(v, 1);

const DEFS = [
  ['tasa', 'Tasa de daños', v => f1(v) + '%', '≤ 3%', 'casos de daño ÷ órdenes trabajadas'],
  ['costoVentas', 'Costo de daños sobre ventas', v => f1(v) + '%', '≤ 1%', 'costo de los daños ÷ ventas del mes'],
  ['cierre', 'Tiempo promedio de cierre', v => f1(v) + ' d', '≤ 10 días', 'del primer proceso al cierre'],
  ['causa', 'Casos con causa raíz', v => fmtNum(v, 0) + '%', '≥ 95%', 'casos con causa raíz ÷ casos'],
  ['recurrencia', 'Recurrencia', v => f1(v) + '%', '≤ 5%', 'mismo motivo y área en 90 días'],
  ['expediente', 'Expedientes completos', v => fmtNum(v, 0) + '%', '≥ 98%', 'cerrados con todo el expediente']
];
const charts = {};

function pintar(prefix){
  const cont = $(prefix + '-kpis'); if(!cont) return;
  const n = parseInt($(prefix + '-meses')?.value || '6', 10);
  const filas = calcularIndicadores(n);
  const actual = filas[filas.length - 1];
  // KPIs: el último mes que tenga dato de cada indicador (así no salen en blanco los de cierre/expediente).
  const ultimoDato = k => { for(let i = filas.length - 1; i >= 0; i--) if(filas[i][k] != null) return filas[i]; return null; };
  cont.innerHTML = DEFS.map(([k, tit, fmt, meta, def]) => {
    const f = k === 'cierre' ? ultimoDato('tCierre') : ultimoDato(k);
    const v = f ? (k === 'cierre' ? f.tCierre : f[k]) : null, nv = nivel(k, v);
    return `<div class="kpi" title="${esc(def)}"><div class="lbl">${tit}</div><div class="val" style="color:${COLOR[nv]}">${v == null ? '—' : fmt(v)}</div><div class="sub">${punto(nv)}meta ${meta}${f ? ' · ' + f.etiqueta : ''}</div></div>`;
  }).join('');

  const th = ['Mes', 'Órdenes', 'Casos', 'Tasa de daños', 'Costo de daños', 'Ventas', 'Costo / ventas', 'Cierres', 'Días de cierre', 'Con causa raíz', 'Recurrencia', 'Expediente completo'];
  const celda = (k, v, fmt) => `<td class="num" style="color:${COLOR[nivel(k, v)]};font-weight:600">${v == null ? '—' : fmt(v)}</td>`;
  $(prefix + '-tabla').innerHTML = `<table class="detalle-mini-table"><thead><tr>${th.map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${filas.map(f => `<tr>
    <td>${f.etiqueta}</td><td class="num">${f.ops}</td><td class="num" title="${f.reprocesos} reproceso(s) · ${f.equipos} daño(s) de equipos">${f.casos}</td>
    ${celda('tasa', f.tasa, v => f1(v) + '%')}<td class="num">${fmtCOP(f.costo)}</td><td class="num">${f.ventas ? fmtCOP(f.ventas) : '—'}</td>${celda('costoVentas', f.costoVentas, v => f1(v) + '%')}
    <td class="num">${f.cierres}</td>${celda('cierre', f.tCierre, v => f1(v))}${celda('causa', f.causa, v => fmtNum(v, 0) + '%')}${celda('recurrencia', f.recurrencia, v => f1(v) + '%')}${celda('expediente', f.expediente, v => fmtNum(v, 0) + '%')}</tr>`).join('')}</tbody></table>`;

  const el = $(prefix + '-chart');
  if(el && typeof Chart !== 'undefined'){
    if(charts[prefix]) charts[prefix].destroy();
    charts[prefix] = new Chart(el, { type: 'bar', data: { labels: filas.map(f => f.etiqueta), datasets: [
      { label: 'Tasa de daños (%)', data: filas.map(f => f.tasa), backgroundColor: MARCA.blue },
      { label: 'Costo de daños sobre ventas (%)', data: filas.map(f => f.costoVentas), backgroundColor: MARCA.magenta },
      { type: 'line', label: 'Meta tasa (3%)', data: filas.map(() => METAS.tasa), borderColor: MARCA.blue, borderDash: [6, 5], pointRadius: 0, borderWidth: 2 },
      { type: 'line', label: 'Meta costo (1%)', data: filas.map(() => METAS.costoVentas), borderColor: MARCA.magenta, borderDash: [6, 5], pointRadius: 0, borderWidth: 2 }
    ] }, options: { responsive: true, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${f1(c.parsed.y)}%` } } },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { beginAtZero: true, grid: { color: 'rgba(150,150,150,.15)' }, ticks: { font: { size: 10 }, callback: v => v + '%' } } } } });
  }
  return filas;
}

export function renderIndicadoresReprocesos(){
  ['rep-ind', 'ger-ind'].forEach(p => { if($(p + '-kpis')) pintar(p); });
}

function filasParaExcel(f){
  return f.map(x => ({ Mes: x.mes, 'Órdenes trabajadas': x.ops, 'Casos de daño': x.casos, 'Reprocesos': x.reprocesos, 'Daños de equipos': x.equipos,
    'Tasa de daños (%)': x.tasa == null ? '' : +x.tasa.toFixed(2), 'Costo de daños': Math.round(x.costo), 'Ventas': Math.round(x.ventas),
    'Costo / ventas (%)': x.costoVentas == null ? '' : +x.costoVentas.toFixed(2), 'Cierres': x.cierres, 'Días promedio de cierre': x.tCierre == null ? '' : +x.tCierre.toFixed(1),
    'Con causa raíz (%)': x.causa == null ? '' : +x.causa.toFixed(0), 'Recurrencia (%)': x.recurrencia == null ? '' : +x.recurrencia.toFixed(1), 'Expediente completo (%)': x.expediente == null ? '' : +x.expediente.toFixed(0) }));
}

export function initIndicadoresReprocesos(){
  ['rep-ind', 'ger-ind'].forEach(p => {
    if(!$(p + '-kpis')) return;
    $(p + '-meses')?.addEventListener('change', () => pintar(p));
    $(p + '-excel')?.addEventListener('click', () => exportarExcel('LitoColor_indicadores_reprocesos.xlsx', [{ nombre: 'Indicadores', filas: filasParaExcel(calcularIndicadores(parseInt($(p + '-meses').value, 10))) }]));
    $(p + '-imprimir')?.addEventListener('click', () => {
      const f = calcularIndicadores(parseInt($(p + '-meses').value, 10));
      imprimirInforme({ titulo: 'Indicadores del manejo de daños en producción', subtitulo: 'Procedimiento PR-PROD-DAÑ-01 · metas: tasa ≤ 3% · costo/ventas ≤ 1% · cierre ≤ 10 días · causa raíz ≥ 95% · recurrencia ≤ 5% · expedientes ≥ 98%',
        secciones: [{ titulo: 'Por mes', columnas: [{ key: 'mes', label: 'Mes' }, { key: 'ops', label: 'Órdenes', num: true }, { key: 'casos', label: 'Casos', num: true }, { key: 'tasa', label: 'Tasa de daños', num: true }, { key: 'costo', label: 'Costo de daños', num: true }, { key: 'cv', label: 'Costo / ventas', num: true }, { key: 'tc', label: 'Días de cierre', num: true }, { key: 'cr', label: 'Con causa raíz', num: true }, { key: 'rec', label: 'Recurrencia', num: true }, { key: 'exp', label: 'Expediente completo', num: true }],
          filas: f.map(x => ({ mes: x.etiqueta, ops: x.ops, casos: x.casos, tasa: x.tasa == null ? '—' : f1(x.tasa) + '%', costo: fmtCOP(x.costo), cv: x.costoVentas == null ? '—' : f1(x.costoVentas) + '%', tc: f1(x.tCierre), cr: x.causa == null ? '—' : fmtNum(x.causa, 0) + '%', rec: x.recurrencia == null ? '—' : f1(x.recurrencia) + '%', exp: x.expediente == null ? '—' : fmtNum(x.expediente, 0) + '%' })) }] });
    });
    pintar(p);
  });
}
