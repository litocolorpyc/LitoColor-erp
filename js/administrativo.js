import { DB } from './store.js';
import { fmtCOP, fmtNum, rangoFechas, toast, imprimirInforme, exportarExcel } from './helpers.js';

// Panel "Administrativo" (reunión 27oct26 con Liliana): agrupa lo que se usa
// a diario en administración — facturación, ventas por cliente, compras por
// proveedor y compras de materia prima por rango de fechas — sin tener que
// navegar el tablero Gerencial, que está pensado para Julián. Es de solo
// lectura sobre datos ya cargados en memoria. Los informes salen de la
// propuesta "Administrativo ERP LITOCOLOR.xlsx"; Liliana define el detalle
// final en la revisión de la semana siguiente.

const $ = id => document.getElementById(id);
const enRango = (f, d, h) => !!f && String(f).slice(0,10) >= d && String(f).slice(0,10) <= h;
const COL = (key, label, num) => ({ key, label, num });

let ultimo = null; // último informe consultado (para imprimir / exportar)

function conceptoDe(m){
  return DB.costos_conceptos.find(c => c.id === m.concepto_id) || {};
}

// Facturas de venta (neto = antes de IVA cuando el dato existe) y remisiones
// del rango, unificadas. `incluir`: 'todo' | 'facturas' | 'remisiones'.
function documentosVenta(d, h, incluir){
  const filas = [];
  if(incluir !== 'remisiones'){
    DB.facturas_venta.filter(f => enRango(f.fecha, d, h)).forEach(f => filas.push({
      doc: 'Factura', numero: f.numero_factura, fecha: String(f.fecha).slice(0,10), cliente: f.cliente || '—',
      bruto: Number(f.total_bruto) || 0, iva: Number(f.iva) || 0, total: Number(f.valor_total) || 0
    }));
  }
  if(incluir !== 'facturas'){
    DB.remisiones.filter(r => enRango(r.fecha, d, h)).forEach(r => filas.push({
      doc: 'Remisión', numero: r.numero, fecha: String(r.fecha).slice(0,10), cliente: r.cliente || '—',
      bruto: Number(r.total) || 0, iva: 0, total: Number(r.total) || 0
    }));
  }
  return filas.sort((a,b) => b.fecha.localeCompare(a.fecha));
}

function movimientosCompra(d, h){
  return DB.costos_movimientos.filter(m => enRango(m.fecha, d, h));
}

function repFacturacion(d, h){
  const incluir = $('adm-docs').value;
  const docs = documentosVenta(d, h, incluir);
  const totalBruto = docs.reduce((s,x) => s + x.bruto, 0), totalIva = docs.reduce((s,x) => s + x.iva, 0), total = docs.reduce((s,x) => s + x.total, 0);
  return { titulo: 'Facturación por rango de fechas',
    extra: `${docs.length} documento(s) · Subtotal ${fmtCOP(totalBruto)} · IVA ${fmtCOP(totalIva)} · Total ${fmtCOP(total)}`,
    columnas: [COL('doc','Documento'), COL('numero','N°'), COL('fecha','Fecha'), COL('cliente','Cliente'), COL('bruto','Subtotal',1), COL('iva','IVA',1), COL('total','Total',1)],
    filas: docs, valores: docs, formato: ['bruto','iva','total'] };
}

function repVentasCliente(d, h){
  const docs = documentosVenta(d, h, $('adm-docs').value);
  const mapa = new Map();
  docs.forEach(x => {
    const a = mapa.get(x.cliente) || { cliente: x.cliente, docs: 0, bruto: 0, total: 0 };
    a.docs++; a.bruto += x.bruto; a.total += x.total; mapa.set(x.cliente, a);
  });
  const lista = Array.from(mapa.values()).sort((a,b) => b.total - a.total);
  const gran = lista.reduce((s,x) => s + x.total, 0);
  const filas = lista.map(x => ({ ...x, pct: gran ? x.total / gran * 100 : 0 }));
  return { titulo: 'Ventas por cliente', extra: `${lista.length} cliente(s) · Total ${fmtCOP(gran)}`,
    columnas: [COL('cliente','Cliente'), COL('docs','Documentos',1), COL('bruto','Subtotal',1), COL('total','Total',1), COL('pct','% del total',1)],
    filas, formato: ['bruto','total'], pct: ['pct'] };
}

function repComprasProveedor(d, h){
  const mapa = new Map();
  movimientosCompra(d, h).forEach(m => {
    const prov = (m.proveedor || '').trim() || 'Sin proveedor registrado';
    const a = mapa.get(prov) || { proveedor: prov, movs: 0, total: 0 };
    a.movs++; a.total += Number(m.valor) || 0; mapa.set(prov, a);
  });
  const lista = Array.from(mapa.values()).sort((a,b) => b.total - a.total);
  const gran = lista.reduce((s,x) => s + x.total, 0);
  const filas = lista.map(x => ({ ...x, pct: gran ? x.total / gran * 100 : 0 }));
  return { titulo: 'Compras por proveedor', extra: `${lista.length} proveedor(es) · Total ${fmtCOP(gran)} (valor de costo registrado, sin IVA)`,
    columnas: [COL('proveedor','Proveedor'), COL('movs','Movimientos',1), COL('total','Total',1), COL('pct','% del total',1)],
    filas, formato: ['total'], pct: ['pct'] };
}

function repComprasMateriaPrima(d, h){
  const filas = movimientosCompra(d, h)
    .map(m => ({ m, c: conceptoDe(m) }))
    .filter(x => /materia prima|insumo/i.test(x.c.categoria || '') || /materia prima|insumo/i.test(x.c.nombre || ''))
    .sort((a,b) => String(b.m.fecha).localeCompare(String(a.m.fecha)))
    .map(({ m, c }) => ({ fecha: String(m.fecha).slice(0,10), concepto: c.nombre || '—', proveedor: m.proveedor || '—',
      orden: m.orden != null ? m.orden : '—', comentario: m.comentario || '', valor: Number(m.valor) || 0 }));
  const total = filas.reduce((s,x) => s + x.valor, 0);
  return { titulo: 'Costos de compras de materias primas e insumos', extra: `${filas.length} movimiento(s) · Total ${fmtCOP(total)}`,
    columnas: [COL('fecha','Fecha'), COL('concepto','Concepto'), COL('proveedor','Proveedor'), COL('orden','OP'), COL('comentario','Comentario'), COL('valor','Valor',1)],
    filas, formato: ['valor'] };
}

function formatearFila(res, f){
  const out = { ...f };
  (res.formato || []).forEach(k => { out[k] = fmtCOP(f[k]); });
  (res.pct || []).forEach(k => { out[k] = fmtNum(f[k], 1) + '%'; });
  return out;
}

function pintarKPIs(d, h){
  const fact = documentosVenta(d, h, 'facturas').reduce((s,x) => s + x.bruto, 0);
  const rem = documentosVenta(d, h, 'remisiones').reduce((s,x) => s + x.total, 0);
  const comprasMP = repComprasMateriaPrima(d, h).filas.reduce((s,x) => s + x.valor, 0);
  const costos = movimientosCompra(d, h).reduce((s,m) => s + (Number(m.valor) || 0), 0);
  $('adm-kpis').innerHTML = [
    ['Facturado (antes de IVA)', fmtCOP(fact), 'facturas de venta del rango'],
    ['Remisionado', fmtCOP(rem), 'remisiones del rango'],
    ['Compras de materia prima e insumos', fmtCOP(comprasMP), 'costos registrados'],
    ['Total costos registrados', fmtCOP(costos), 'todos los conceptos']
  ].map(([l, v, s]) => `<div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`).join('');
}

function consultar(){
  const d = $('adm-desde').value, h = $('adm-hasta').value, tipo = $('adm-tipo').value;
  const hint = $('adm-hint');
  if(!d || !h){ hint.textContent = 'Elige Desde y Hasta'; return; }
  if(d > h){ hint.textContent = '"Desde" no puede ser posterior a "Hasta"'; return; }
  const res = { facturacion: repFacturacion, clientes: repVentasCliente, proveedores: repComprasProveedor, materiaprima: repComprasMateriaPrima }[tipo](d, h);
  ultimo = { ...res, subtitulo: `Del ${d} al ${h} · ${res.extra}` };
  pintarKPIs(d, h);
  hint.textContent = `${res.filas.length} fila(s) · ${ultimo.subtitulo}`;
  $('adm-titulo').textContent = res.titulo;
  $('adm-f-docs').style.display = (tipo === 'facturacion' || tipo === 'clientes') ? '' : 'none';
  $('tbl-adm').querySelector('thead').innerHTML = '<tr>' + res.columnas.map(c => `<th${c.num ? ' class="num"' : ''}>${c.label}</th>`).join('') + '</tr>';
  $('tbl-adm').querySelector('tbody').innerHTML = res.filas.length
    ? res.filas.map(f => { const x = formatearFila(res, f); return '<tr>' + res.columnas.map(c => `<td${c.num ? ' class="num"' : ''}>${x[c.key] ?? ''}</td>`).join('') + '</tr>'; }).join('')
    : `<tr><td colspan="${res.columnas.length}" style="text-align:center;color:var(--ink-faint)">Sin resultados en ese rango</td></tr>`;
}

function imprimir(){
  if(!ultimo || !ultimo.filas.length){ toast('Primero haz clic en "Consultar" (con resultados) antes de imprimir'); return; }
  imprimirInforme({ titulo: ultimo.titulo, subtitulo: ultimo.subtitulo,
    secciones: [{ titulo: ultimo.titulo, columnas: ultimo.columnas, filas: ultimo.filas.map(f => formatearFila(ultimo, f)) }] });
}

function exportar(){
  if(!ultimo || !ultimo.filas.length){ toast('Primero haz clic en "Consultar" (con resultados) antes de exportar'); return; }
  const filas = ultimo.filas.map(f => { const o = {}; ultimo.columnas.forEach(c => { o[c.label] = f[c.key] ?? ''; }); return o; });
  exportarExcel('LitoColor_' + ultimo.titulo.replace(/[^\wáéíóúñÁÉÍÓÚÑ]+/g, '_') + '.xlsx', [{ nombre: ultimo.titulo.slice(0, 30), filas }]);
}

// Los botones de "Operación" saltan a la pestaña correspondiente.
function irA(tab){
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if(btn) btn.click();
}

export function renderAdministrativo(){
  if(!$('adm-consultar') || !ultimo) return;
  consultar(); // refresca con los datos recién cargados
}

export function initAdministrativo(){
  if(!$('adm-consultar')) return;
  const { desde, hasta } = rangoFechas('mes');
  $('adm-desde').value = desde; $('adm-hasta').value = hasta;
  $('adm-consultar').addEventListener('click', consultar);
  $('adm-tipo').addEventListener('change', consultar);
  $('adm-docs').addEventListener('change', consultar);
  $('adm-imprimir').addEventListener('click', imprimir);
  $('adm-exportar').addEventListener('click', exportar);
  document.querySelectorAll('[data-adm-ir]').forEach(b => b.addEventListener('click', () => irA(b.dataset.admIr)));
  consultar();
}
