import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { fmtNum, rangoFechas, toast, etiquetaOrden, imprimirInforme } from './helpers.js';
import { parseCantidadConsumo } from './registrar.js';

// Pedido 21oct26: informes por rango de fechas sobre las órdenes (listar OP,
// por cliente, consumo de un material, laminadas, argolladas) y los
// "parámetros de piso" (unidades por hora, presupuestado vs. real, por área).
// Todo es de solo lectura sobre datos ya cargados en memoria; el único dato
// que se guarda es el estándar por área (tabla parametros_piso).

const $ = id => document.getElementById(id);
const enRango = (f, d, h) => !!f && f.slice(0,10) >= d && f.slice(0,10) <= h;
const ordenesEnRango = (d, h) => DB.opp_ordenes.filter(o => enRango(o.fecha, d, h));
const clienteDe = orden => (DB.opp_ordenes.find(o => o.orden === orden) || {}).cliente || '';
const esLaminada = p => !!p.laminado || (Array.isArray(p.procesos_requeridos) && p.procesos_requeridos.includes('Plastificado'));
const esArgollada = p => /argoll/i.test(p.otros_acabados || '') ||
  DB.produccion.some(r => r.orden === p.orden && (r.suborden === p.suborden || r.op === p.op) && /argoll/i.test(`${r.actividad || ''} ${r.subproceso || ''}`));
// Áreas cuya producción se mide en pliegos; el resto, en unidades.
const AREA_PLIEGOS = /litograf|corte|guillot|plastif|troquel/i;

let estandares = {}; // area -> unidades por hora
let ultimo = null;   // último resultado consultado (para imprimir)

async function cargarEstandares(){
  const { data, error } = await sb.from('parametros_piso').select('*');
  estandares = {};
  if(error) return false;
  (data || []).forEach(r => { estandares[r.area] = Number(r.unidades_por_hora); });
  return true;
}

const COL = (key, label, num) => ({ key, label, num });
const nPiezas = orden => String(DB.opp_piezas.filter(p => p.orden === orden).length);

function repListarOP(d, h){
  const filas = ordenesEnRango(d, h).sort((a,b) => (a.fecha||'').localeCompare(b.fecha||'')).map(o => ({
    orden: etiquetaOrden(o.orden), fecha: (o.fecha||'').slice(0,10), cliente: o.cliente || '—', producto: o.producto || '—', piezas: nPiezas(o.orden)
  }));
  return { titulo: 'Órdenes de producción por rango de fechas', filas,
    columnas: [COL('orden','Orden'), COL('fecha','Fecha'), COL('cliente','Cliente'), COL('producto','Producto'), COL('piezas','Piezas',1)] };
}

function repPorCliente(d, h){
  const cli = $('iop-cliente').value;
  const filas = ordenesEnRango(d, h).filter(o => !cli || o.cliente === cli)
    .sort((a,b) => (a.cliente||'').localeCompare(b.cliente||'') || (a.fecha||'').localeCompare(b.fecha||''))
    .map(o => ({ cliente: o.cliente || '—', orden: etiquetaOrden(o.orden), fecha: (o.fecha||'').slice(0,10), producto: o.producto || '—', piezas: nPiezas(o.orden) }));
  return { titulo: 'Órdenes por cliente', extra: cli ? `Cliente: ${cli}` : 'Todos los clientes', filas,
    columnas: [COL('cliente','Cliente'), COL('orden','Orden'), COL('fecha','Fecha'), COL('producto','Producto'), COL('piezas','Piezas',1)] };
}

function repMaterial(d, h){
  const mat = $('iop-material').value;
  if(!mat) return { error: 'Elige el material o insumo' };
  const porOrden = new Map();
  DB.produccion.filter(r => r.materiaPrima === mat && r.orden != null && enRango(r.fecha, d, h)).forEach(r => {
    const n = parseFloat(parseCantidadConsumo(r.consumoMP));
    const a = porOrden.get(r.orden) || { cant: 0, regs: 0 };
    a.cant += isNaN(n) ? 0 : n; a.regs++;
    porOrden.set(r.orden, a);
  });
  let total = 0;
  const filas = Array.from(porOrden.entries()).sort((a,b) => b[1].cant - a[1].cant).map(([orden, a]) => {
    total += a.cant;
    return { orden: etiquetaOrden(orden), cliente: clienteDe(orden) || '—', cant: fmtNum(a.cant, 2), regs: String(a.regs) };
  });
  return { titulo: `Órdenes que consumen: ${mat}`, extra: `Total consumido: ${fmtNum(total,2)}`, filas,
    columnas: [COL('orden','Orden'), COL('cliente','Cliente'), COL('cant','Cantidad consumida',1), COL('regs','Registros',1)] };
}

function repPorProceso(d, h, filtro, titulo, area){
  const filas = [];
  let total = 0;
  ordenesEnRango(d, h).sort((a,b) => (a.fecha||'').localeCompare(b.fecha||'')).forEach(o => {
    DB.opp_piezas.filter(p => p.orden === o.orden && filtro(p)).sort((a,b) => a.suborden - b.suborden).forEach(p => {
      total += Number(p.cantidad) || 0;
      filas.push({ orden: etiquetaOrden(o.orden), cliente: o.cliente || '—', pieza: p.pieza || ('Pieza ' + p.suborden), op: p.op || '',
        detalle: area === 'Plastificado' ? [p.laminado, p.laminado_lados ? p.laminado_lados + ' lado(s)' : ''].filter(Boolean).join(' · ') : (p.otros_acabados || ''),
        cant: p.cantidad != null ? fmtNum(p.cantidad, 0) : '—', area });
    });
  });
  return { titulo, extra: `Cantidad total: ${fmtNum(total,0)}`, filas,
    columnas: [COL('orden','Orden'), COL('cliente','Cliente'), COL('pieza','Pieza'), COL('op','OP'), COL('detalle','Detalle'), COL('cant','Cantidad',1), COL('area','Área')] };
}

// Real = cantidad / horas de los registros del rango; presupuestado = lo
// programado en la orden contra el estándar de unidades/hora del área.
function repParametrosPiso(d, h){
  const grupos = new Map(); // "orden|area" -> acumulado
  DB.produccion.filter(r => r.orden != null && r.area && enRango(r.fecha, d, h)).forEach(r => {
    const k = r.orden + '|' + r.area;
    const g = grupos.get(k) || { orden: r.orden, area: r.area, horas: 0, cant: 0 };
    g.horas += Number(r.tiempoHr) || 0; g.cant += Number(r.cantidad) || 0;
    grupos.set(k, g);
  });
  const filas = [];
  Array.from(grupos.values()).sort((a,b) => a.area.localeCompare(b.area) || a.orden - b.orden).forEach(g => {
    if(g.horas <= 0 || g.cant <= 0) return;
    const prog = DB.opp_piezas.filter(p => p.orden === g.orden)
      .reduce((s,p) => s + (AREA_PLIEGOS.test(g.area) ? (Number(p.pliegos) || 0) : (Number(p.cantidad) || 0)), 0);
    const est = estandares[g.area];
    const real = g.cant / g.horas;
    filas.push({ area: g.area, orden: etiquetaOrden(g.orden), cliente: clienteDe(g.orden) || '—',
      prog: prog ? fmtNum(prog,0) : '—', cant: fmtNum(g.cant,0), horas: fmtNum(g.horas,1),
      hpres: est && prog ? fmtNum(prog / est, 1) : '—', est: est ? fmtNum(est,0) : '—', real: fmtNum(real,0),
      desv: est ? fmtNum((real/est - 1)*100,0) + '%' : '—' });
  });
  return { titulo: 'Parámetros de piso: presupuestado vs. real (unidades por hora)', filas, esPiso: true,
    extra: Object.keys(estandares).length ? 'Presupuestado = estándar por área' : 'Aún no hay estándares por área: defínelos abajo para ver el presupuestado',
    columnas: [COL('area','Área'), COL('orden','Orden'), COL('cliente','Cliente'), COL('prog','Programado',1), COL('cant','Real hecho',1),
      COL('horas','Horas reales',1), COL('hpres','Horas presup.',1), COL('est','Presup. u/h',1), COL('real','Real u/h',1), COL('desv','Real vs presup.',1)] };
}

function renderEstandares(res){
  const cont = $('iop-estandares');
  if(!res || !res.esPiso){ cont.style.display = 'none'; return; }
  const areas = Array.from(new Set([...DB.areas.map(a => a.nombre), ...Object.keys(estandares)].filter(Boolean)));
  cont.style.display = '';
  cont.querySelector('.iop-est-grid').innerHTML = areas.map(a =>
    `<label style="font-weight:normal;display:flex;gap:6px;align-items:center">${a}
      <input type="number" min="0" step="any" class="iop-est-inp" data-area="${a}" value="${estandares[a] || ''}" style="width:90px"> u/h</label>`).join('');
}

async function guardarEstandares(){
  const filas = Array.from(document.querySelectorAll('.iop-est-inp'))
    .map(i => ({ area: i.dataset.area, v: parseFloat(i.value) })).filter(x => x.v > 0)
    .map(x => ({ area: x.area, unidades_por_hora: x.v, actualizado_en: new Date().toISOString() }));
  if(!filas.length){ toast('Escribe al menos un estándar'); return; }
  const { error } = await sb.from('parametros_piso').upsert(filas);
  if(error){ toast('No se pudieron guardar los estándares (¿falta crear la tabla parametros_piso?)'); return; }
  await cargarEstandares();
  consultar();
  toast('Estándares guardados');
}

function consultar(){
  const d = $('iop-desde').value, h = $('iop-hasta').value, tipo = $('iop-tipo').value;
  const hint = $('iop-hint');
  if(!d || !h){ hint.textContent = 'Elige Desde y Hasta'; return; }
  const mapa = {
    ops: () => repListarOP(d, h), cliente: () => repPorCliente(d, h), material: () => repMaterial(d, h),
    laminadas: () => repPorProceso(d, h, esLaminada, 'Órdenes laminadas', 'Plastificado'),
    argolladas: () => repPorProceso(d, h, esArgollada, 'Órdenes argolladas', 'Terminado'),
    piso: () => repParametrosPiso(d, h)
  };
  const res = mapa[tipo]();
  if(res.error){ hint.textContent = res.error; return; }
  ultimo = { ...res, subtitulo: `Del ${d} al ${h}${res.extra ? ' · ' + res.extra : ''}` };
  hint.textContent = `${res.filas.length} fila(s) · ${ultimo.subtitulo}`;
  $('iop-titulo').textContent = res.titulo;
  $('tbl-iop').querySelector('thead').innerHTML = '<tr>' + res.columnas.map(c => `<th${c.num?' class="num"':''}>${c.label}</th>`).join('') + '</tr>';
  $('tbl-iop').querySelector('tbody').innerHTML = res.filas.length
    ? res.filas.map(f => '<tr>' + res.columnas.map(c => `<td${c.num?' class="num"':''}>${f[c.key] ?? ''}</td>`).join('') + '</tr>').join('')
    : `<tr><td colspan="${res.columnas.length}" style="text-align:center;color:var(--ink-faint)">Sin resultados en ese rango</td></tr>`;
  renderEstandares(res);
}

function imprimir(){
  if(!ultimo || !ultimo.filas.length){ toast('Primero haz clic en "Consultar" (con resultados) antes de imprimir'); return; }
  imprimirInforme({ titulo: ultimo.titulo, subtitulo: ultimo.subtitulo,
    secciones: [{ titulo: ultimo.titulo, columnas: ultimo.columnas, filas: ultimo.filas }] });
}

function actualizarFiltros(){
  const t = $('iop-tipo').value;
  $('iop-f-cliente').style.display = t === 'cliente' ? '' : 'none';
  $('iop-f-material').style.display = t === 'material' ? '' : 'none';
}

export function renderInformesOP(){
  if(!$('iop-cliente')) return;
  const clientes = Array.from(new Set(DB.opp_ordenes.map(o => o.cliente).filter(Boolean))).sort();
  $('iop-cliente').innerHTML = '<option value="">Todos</option>' + clientes.map(c => `<option>${c}</option>`).join('');
  const mats = [...DB.materias_primas.map(m => m.nombre), ...DB.insumos_area.map(m => m.nombre)].filter(Boolean);
  $('iop-material').innerHTML = '<option value="">Selecciona…</option>' + Array.from(new Set(mats)).sort().map(n => `<option>${n}</option>`).join('');
}

export function initInformesOP(){
  if(!$('iop-consultar')) return;
  const { desde, hasta } = rangoFechas('mes');
  $('iop-desde').value = desde; $('iop-hasta').value = hasta;
  $('iop-tipo').addEventListener('change', actualizarFiltros);
  $('iop-consultar').addEventListener('click', consultar);
  $('iop-imprimir').addEventListener('click', imprimir);
  $('iop-est-guardar').addEventListener('click', guardarEstandares);
  actualizarFiltros();
  renderInformesOP();
  cargarEstandares();
}
