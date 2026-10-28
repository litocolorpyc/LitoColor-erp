import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { getCurrentUser } from './auth.js';
import { toast, fmtNum, etiquetaOrden, parseOrden, exportarExcel, fechaHoyLocal, MARCA } from './helpers.js';
import { estadoOrden } from './ordenes.js';

// Producto terminado y en proceso (propuesta E del análisis del procedimiento
// PR-PROD-DAÑ-01, pasos 8.1 y 8.2):
//  1) Cumplimiento de pedidos: compara la CANTIDAD DEL PEDIDO (campo de la orden)
//     con lo despachado en las remisiones y lo que hay en bodega; avisa cuando una
//     orden terminada se entregó incompleta o con exceso.
//  2) Inventario de producto: en proceso, terminado, sobrante, en cuarentena,
//     despachado y chatarra, con la disposición del producto no conforme
//     (reproceso, liberar bajo concesión, chatarra, devolver, vender como segunda).

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ESTADOS = ['En proceso', 'Terminado', 'Sobrante', 'Cuarentena', 'Despachado', 'Chatarra'];
const DISPOSICIONES = ['Pendiente', 'Reproceso', 'Liberar bajo concesión', 'Chatarra', 'Devolver', 'Vender como segunda'];
// Al resolver una cuarentena, la disposición decide en qué queda el producto.
const DESTINO = { 'Reproceso': 'En proceso', 'Liberar bajo concesión': 'Terminado', 'Chatarra': 'Chatarra', 'Devolver': 'Despachado', 'Vender como segunda': 'Terminado' };
const COLOR_ESTADO = { 'En proceso': MARCA.sky, 'Terminado': MARCA.blue, 'Sobrante': MARCA.violet, 'Cuarentena': MARCA.magenta, 'Despachado': MARCA.slate, 'Chatarra': MARCA.raspberry };
let editando = null;

export async function cargarInventarioProducto(){
  const { data, error } = await sb.from('inventario_producto').select('*').order('creado_en', { ascending: false });
  if(!error) DB.inventario_producto = data || [];
  else if(!DB.inventario_producto) DB.inventario_producto = [];
}
const inv = () => DB.inventario_producto || [];

// ---------- cumplimiento de pedidos ----------
function despachadoPorOrden(){
  const m = new Map();
  (DB.remision_items || []).forEach(it => { if(it.orden != null) m.set(it.orden, (m.get(it.orden) || 0) + (Number(it.cantidad) || 0)); });
  return m;
}
function bodegaPorOrden(){
  const m = new Map();
  inv().filter(x => x.orden != null && (x.estado === 'Terminado' || x.estado === 'Sobrante')).forEach(x => m.set(x.orden, (m.get(x.orden) || 0) + Number(x.cantidad)));
  return m;
}

export function cumplimiento(o, desp, bod){
  const pedido = o.cantidad_pedido != null ? Number(o.cantidad_pedido) : null;
  const despachado = (desp || despachadoPorOrden()).get(o.orden) || 0;
  const bodega = (bod || bodegaPorOrden()).get(o.orden) || 0;
  let estado;
  if(pedido == null) estado = 'Sin pedido definido';
  else if(despachado > pedido + 0.0001) estado = 'Despachó de más';
  else if(despachado >= pedido - 0.0001) estado = 'Completo';
  else if(despachado > 0) estado = 'Parcial';
  else estado = bodega > 0 ? 'En bodega' : 'Sin despachar';
  return { pedido, despachado, bodega, pendiente: pedido == null ? null : Math.max(0, pedido - despachado), sobrante: pedido == null ? 0 : Math.max(0, despachado + bodega - pedido), estado };
}

// Órdenes ya terminadas (o cerradas) cuya entrega quedó por debajo del pedido: alimenta las Alertas.
export function pedidosConEntregaIncompleta(){
  const desp = despachadoPorOrden(), bod = bodegaPorOrden();
  return DB.opp_ordenes.filter(o => o.estado !== 'Cancelada' && o.cantidad_pedido != null).map(o => ({ o, c: cumplimiento(o, desp, bod) }))
    .filter(({ o, c }) => ['Completada', 'Cerrada'].includes(estadoOrden(o).label) && c.despachado < c.pedido - 0.0001);
}

const CHIP = { 'Completo': MARCA.blue, 'Parcial': MARCA.violet, 'En bodega': MARCA.sky, 'Sin despachar': MARCA.slate, 'Despachó de más': MARCA.magenta, 'Sin pedido definido': MARCA.slate };

function pintarCumplimiento(){
  const cont = $('ipt-cump-tabla'); if(!cont) return;
  const q = ($('ipt-cump-q').value || '').trim().toLowerCase(), f = $('ipt-cump-f').value;
  const desp = despachadoPorOrden(), bod = bodegaPorOrden();
  let filas = DB.opp_ordenes.filter(o => o.estado !== 'Cancelada').map(o => ({ o, c: cumplimiento(o, desp, bod), est: estadoOrden(o).label }));
  if(q) filas = filas.filter(({ o }) => etiquetaOrden(o.orden).toLowerCase().includes(q) || (o.cliente || '').toLowerCase().includes(q) || (o.producto || '').toLowerCase().includes(q));
  const sinPedido = filas.filter(x => x.c.pedido == null).length;
  if(f === 'sin') filas = filas.filter(x => x.c.pedido == null);
  else {
    filas = filas.filter(x => x.c.pedido != null);
    if(f === 'incompletos') filas = filas.filter(x => x.c.despachado < x.c.pedido - 0.0001 && ['Completada', 'Cerrada'].includes(x.est));
    else if(f === 'parciales') filas = filas.filter(x => x.c.estado === 'Parcial');
    else if(f === 'exceso') filas = filas.filter(x => x.c.sobrante > 0);
  }
  filas.sort((a, b) => b.o.orden - a.o.orden);
  $('ipt-cump-hint').textContent = `${sinPedido} orden(es) sin cantidad de pedido definida — defínela al crear o editar la orden (campo "Cantidad del pedido"), o aquí mismo en el filtro "Sin pedido definido".`;
  const unidad = o => o.unidad_pedido || 'unid.';
  cont.innerHTML = `<table class="detalle-mini-table"><thead><tr><th>Orden</th><th>Cliente</th><th>Producto</th><th>Estado de la orden</th><th class="num">Pedido</th><th class="num">En bodega</th><th class="num">Despachado</th><th class="num">Pendiente</th><th class="num">Sobrante</th><th>Cumplimiento</th></tr></thead><tbody>${filas.slice(0, 300).map(({ o, c, est }) => {
    const pedidoCelda = c.pedido == null
      ? `<span style="display:inline-flex;gap:4px"><input type="number" min="0" step="any" class="ipt-ped-inp" data-orden="${o.orden}" style="width:80px" placeholder="cant."><button type="button" class="row-btn" data-ped-guardar="${o.orden}">Guardar</button></span>`
      : `${fmtNum(c.pedido, 0)} <span class="card-hint">${esc(unidad(o))}</span>`;
    return `<tr><td><b>${etiquetaOrden(o.orden)}</b></td><td>${esc(o.cliente || '—')}</td><td>${esc(o.producto || '—')}</td><td>${est}</td><td class="num">${pedidoCelda}</td>
      <td class="num">${fmtNum(c.bodega, 0)}</td><td class="num">${fmtNum(c.despachado, 0)}</td><td class="num">${c.pendiente == null ? '—' : fmtNum(c.pendiente, 0)}</td><td class="num">${c.sobrante ? fmtNum(c.sobrante, 0) : '—'}</td>
      <td><span style="color:${CHIP[c.estado]};font-weight:600">${c.estado}</span></td></tr>`; }).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--ink-faint)">Sin órdenes en este filtro</td></tr>'}</tbody></table>`;
  cont.querySelectorAll('[data-ped-guardar]').forEach(b => b.addEventListener('click', async () => {
    const orden = parseInt(b.dataset.pedGuardar, 10), v = parseFloat(cont.querySelector(`.ipt-ped-inp[data-orden="${orden}"]`).value);
    if(!(v > 0)){ toast('Escribe la cantidad del pedido (mayor que 0)'); return; }
    const { error } = await sb.from('opp_ordenes').update({ cantidad_pedido: v, unidad_pedido: 'unid.' }).eq('orden', orden);
    if(error){ console.error(error); toast('No se pudo guardar la cantidad del pedido'); return; }
    const o = DB.opp_ordenes.find(x => x.orden === orden); if(o){ o.cantidad_pedido = v; o.unidad_pedido = 'unid.'; }
    toast('Cantidad del pedido guardada'); render();
  }));
}

// ---------- inventario de producto ----------
const casosParaVincular = () => (DB.reproceso_casos || []).map(c => ({ clave: c.clave, texto: `${c.numero || c.clave} · ${c.clave.startsWith('o') ? 'OP ' + etiquetaOrden(parseInt(c.clave.slice(1), 10)) : 'sin OP'}` }));

function limpiarForm(){
  editando = null;
  ['ipt-orden', 'ipt-sub', 'ipt-desc', 'ipt-cant', 'ipt-ubic', 'ipt-nota'].forEach(id => { $(id).value = ''; });
  $('ipt-unidad').value = 'unid.'; $('ipt-estado').value = 'Terminado'; $('ipt-disp').value = 'Pendiente'; $('ipt-caso').value = '';
  $('ipt-form-modo').textContent = 'Registrar producto'; $('ipt-cancelar').style.display = 'none'; $('ipt-disp-wrap').style.display = 'none';
}

async function guardar(){
  const orden = $('ipt-orden').value.trim() ? parseOrden($('ipt-orden').value) : null;
  if($('ipt-orden').value.trim() && orden == null){ toast('N° de orden no válido'); return; }
  const o = orden != null ? DB.opp_ordenes.find(x => x.orden === orden) : null;
  const desc = $('ipt-desc').value.trim() || (o && (o.producto || '')) || '';
  const cant = parseFloat($('ipt-cant').value);
  if(!desc){ toast('Escribe qué producto es (o elige una orden)'); return; }
  if(!(cant >= 0) || isNaN(cant)){ toast('Escribe la cantidad'); return; }
  const estado = $('ipt-estado').value;
  if(estado === 'Cuarentena' && !$('ipt-nota').value.trim() && !$('ipt-caso').value){ toast('Para poner producto en cuarentena escribe el motivo en la nota o vincula el caso'); return; }
  const u = getCurrentUser();
  const fila = {
    orden, suborden: $('ipt-sub').value ? parseInt($('ipt-sub').value, 10) : null, descripcion: desc, cliente: o ? o.cliente : null,
    cantidad: cant, unidad: $('ipt-unidad').value.trim() || 'unid.', estado,
    disposicion: estado === 'Cuarentena' ? $('ipt-disp').value : null, ubicacion: $('ipt-ubic').value.trim() || null,
    caso_clave: $('ipt-caso').value || null, nota: $('ipt-nota').value.trim() || null,
    actualizado_por: u ? u.nombre : null, actualizado_en: new Date().toISOString()
  };
  const btn = $('ipt-guardar'); btn.disabled = true;
  try{
    if(editando){
      const { data, error } = await sb.from('inventario_producto').update(fila).eq('id', editando).select();
      if(error) throw error;
      const i = DB.inventario_producto.findIndex(x => x.id === editando); if(i >= 0) DB.inventario_producto[i] = data[0];
      toast('Registro actualizado');
    } else {
      const { data, error } = await sb.from('inventario_producto').insert([{ ...fila, creado_por: u ? u.nombre : null }]).select();
      if(error) throw error;
      DB.inventario_producto.unshift(data[0]);
      toast(estado === 'Cuarentena' ? 'Producto puesto en cuarentena' : 'Producto registrado');
    }
    limpiarForm(); render();
  }catch(err){ console.error(err); toast('No se pudo guardar — revisa la consola'); }
  finally{ btn.disabled = false; }
}

function pintarInventario(){
  const cont = $('ipt-inv-tabla'); if(!cont) return;
  const q = ($('ipt-inv-q').value || '').trim().toLowerCase(), f = $('ipt-inv-f').value;
  const todos = inv();
  const resumen = ESTADOS.map(e => { const l = todos.filter(x => x.estado === e); return { e, n: l.length, c: l.reduce((s, x) => s + Number(x.cantidad), 0) }; });
  $('ipt-kpis').innerHTML = resumen.filter(r => r.e !== 'Despachado' && r.e !== 'Chatarra').map(r => `<div class="kpi"><div class="lbl">${r.e}</div><div class="val" style="color:${COLOR_ESTADO[r.e]}">${fmtNum(r.c, 0)}</div><div class="sub">${r.n} registro(s)</div></div>`).join('')
    + `<div class="kpi"><div class="lbl">Entregas incompletas</div><div class="val" style="color:${pedidosConEntregaIncompleta().length ? 'var(--bad)' : 'var(--good)'}">${pedidosConEntregaIncompleta().length}</div><div class="sub">órdenes terminadas con menos de lo pedido</div></div>`;
  let filas = todos.filter(x => !f || x.estado === f);
  if(q) filas = filas.filter(x => `${x.orden != null ? etiquetaOrden(x.orden) : ''} ${x.descripcion} ${x.cliente || ''} ${x.ubicacion || ''} ${x.nota || ''}`.toLowerCase().includes(q));
  cont.innerHTML = `<table class="detalle-mini-table"><thead><tr><th>Fecha</th><th>Orden</th><th>Cliente</th><th>Producto</th><th class="num">Cantidad</th><th>Estado</th><th>Disposición</th><th>Ubicación</th><th>Caso</th><th>Nota</th><th></th></tr></thead><tbody>${filas.map(x => {
    const caso = (DB.reproceso_casos || []).find(c => c.clave === x.caso_clave);
    return `<tr${x.estado === 'Cuarentena' ? ' style="background:rgba(184,26,132,.07)"' : ''}>
      <td>${String(x.creado_en || '').slice(0, 10)}</td><td>${x.orden != null ? etiquetaOrden(x.orden) + (x.suborden ? '-' + x.suborden : '') : '—'}</td><td>${esc(x.cliente || '—')}</td><td>${esc(x.descripcion)}</td>
      <td class="num">${fmtNum(x.cantidad, 0)} <span class="card-hint">${esc(x.unidad || '')}</span></td><td><b style="color:${COLOR_ESTADO[x.estado]}">${x.estado}</b></td>
      <td>${x.estado === 'Cuarentena' ? `<select class="ipt-resolver" data-id="${x.id}"><option value="">${esc(x.disposicion || 'Pendiente')} — resolver…</option>${DISPOSICIONES.filter(d => d !== 'Pendiente').map(d => `<option>${d}</option>`).join('')}</select>` : esc(x.disposicion || '—')}</td>
      <td>${esc(x.ubicacion || '—')}</td><td>${caso ? esc(caso.numero || caso.clave) : '—'}</td><td>${esc(x.nota || '')}</td>
      <td style="white-space:nowrap"><button type="button" class="row-btn" data-ipt-editar="${x.id}">Editar</button>${x.estado !== 'Despachado' && x.estado !== 'Chatarra' ? `<button type="button" class="row-btn" data-ipt-despachar="${x.id}">Despachado</button>` : ''}<button type="button" class="row-btn row-btn-danger" data-ipt-borrar="${x.id}">Borrar</button></td></tr>`; }).join('') || '<tr><td colspan="11" style="text-align:center;color:var(--ink-faint)">Todavía no hay producto registrado</td></tr>'}</tbody></table>`;

  cont.querySelectorAll('[data-ipt-editar]').forEach(b => b.addEventListener('click', () => {
    const x = inv().find(r => r.id === parseInt(b.dataset.iptEditar, 10)); if(!x) return;
    editando = x.id;
    $('ipt-orden').value = x.orden != null ? etiquetaOrden(x.orden) : ''; $('ipt-sub').value = x.suborden ?? ''; $('ipt-desc').value = x.descripcion; $('ipt-cant').value = x.cantidad;
    $('ipt-unidad').value = x.unidad || 'unid.'; $('ipt-estado').value = x.estado; $('ipt-disp').value = x.disposicion || 'Pendiente'; $('ipt-ubic').value = x.ubicacion || '';
    $('ipt-caso').value = x.caso_clave || ''; $('ipt-nota').value = x.nota || '';
    $('ipt-form-modo').textContent = 'Editando un registro'; $('ipt-cancelar').style.display = ''; $('ipt-disp-wrap').style.display = x.estado === 'Cuarentena' ? '' : 'none';
    $('ipt-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  cont.querySelectorAll('[data-ipt-despachar]').forEach(b => b.addEventListener('click', () => cambiar(parseInt(b.dataset.iptDespachar, 10), { estado: 'Despachado', disposicion: null }, 'Marcado como despachado')));
  cont.querySelectorAll('[data-ipt-borrar]').forEach(b => b.addEventListener('click', async () => {
    const x = inv().find(r => r.id === parseInt(b.dataset.iptBorrar, 10));
    if(!x || !confirm(`¿Borrar el registro de "${x.descripcion}"? No se puede deshacer.`)) return;
    const { error } = await sb.from('inventario_producto').delete().eq('id', x.id);
    if(error){ console.error(error); toast('No se pudo borrar'); return; }
    DB.inventario_producto = DB.inventario_producto.filter(r => r.id !== x.id); toast('Registro borrado'); render();
  }));
  cont.querySelectorAll('.ipt-resolver').forEach(s => s.addEventListener('change', () => {
    if(!s.value) return;
    const x = inv().find(r => r.id === parseInt(s.dataset.id, 10));
    cambiar(x.id, { estado: DESTINO[s.value], disposicion: s.value, nota: `${x.nota ? x.nota + ' · ' : ''}Cuarentena resuelta: ${s.value} (${fechaHoyLocal()})` }, `Cuarentena resuelta: ${s.value}`);
  }));
}

async function cambiar(id, cambios, mensaje){
  const u = getCurrentUser();
  const { data, error } = await sb.from('inventario_producto').update({ ...cambios, actualizado_por: u ? u.nombre : null, actualizado_en: new Date().toISOString() }).eq('id', id).select();
  if(error){ console.error(error); toast('No se pudo actualizar'); return; }
  const i = DB.inventario_producto.findIndex(r => r.id === id); if(i >= 0) DB.inventario_producto[i] = data[0];
  toast(mensaje); render();
}

function exportar(){
  const desp = despachadoPorOrden(), bod = bodegaPorOrden();
  exportarExcel('LitoColor_producto_terminado.xlsx', [
    { nombre: 'Cumplimiento de pedidos', filas: DB.opp_ordenes.filter(o => o.estado !== 'Cancelada').map(o => { const c = cumplimiento(o, desp, bod); return { Orden: etiquetaOrden(o.orden), Cliente: o.cliente, Producto: o.producto, 'Estado de la orden': estadoOrden(o).label, Pedido: c.pedido ?? '', Unidad: o.unidad_pedido || '', 'En bodega': c.bodega, Despachado: c.despachado, Pendiente: c.pendiente ?? '', Sobrante: c.sobrante, Cumplimiento: c.estado }; }) },
    { nombre: 'Inventario de producto', filas: inv().map(x => ({ Fecha: String(x.creado_en || '').slice(0, 10), Orden: x.orden != null ? etiquetaOrden(x.orden) : '', Cliente: x.cliente, Producto: x.descripcion, Cantidad: x.cantidad, Unidad: x.unidad, Estado: x.estado, Disposición: x.disposicion || '', Ubicación: x.ubicacion || '', Caso: x.caso_clave || '', Nota: x.nota || '' })) }
  ]);
}

function render(){
  if(!$('ipt-cump-tabla')) return;
  pintarCumplimiento(); pintarInventario();
}
export function renderProductoTerminado(){ render(); }

export async function initProductoTerminado(){
  if(!$('panel-producto-terminado')) return;
  $('ipt-estado').innerHTML = ESTADOS.map(e => `<option>${e}</option>`).join('');
  $('ipt-disp').innerHTML = DISPOSICIONES.map(e => `<option>${e}</option>`).join('');
  $('ipt-inv-f').innerHTML = '<option value="">Todos los estados</option>' + ESTADOS.map(e => `<option>${e}</option>`).join('');
  $('ipt-estado').addEventListener('change', () => { $('ipt-disp-wrap').style.display = $('ipt-estado').value === 'Cuarentena' ? '' : 'none'; });
  $('ipt-orden').addEventListener('change', () => { const o = DB.opp_ordenes.find(x => x.orden === parseOrden($('ipt-orden').value)); if(o && !$('ipt-desc').value) $('ipt-desc').value = o.producto || ''; });
  $('ipt-guardar').addEventListener('click', guardar);
  $('ipt-cancelar').addEventListener('click', limpiarForm);
  ['ipt-cump-q', 'ipt-cump-f', 'ipt-inv-q', 'ipt-inv-f'].forEach(id => $(id).addEventListener(id.endsWith('-q') ? 'input' : 'change', render));
  $('ipt-exportar').addEventListener('click', exportar);
  document.querySelector('.tab-btn[data-tab="producto-terminado"]')?.addEventListener('click', async () => {
    $('ipt-caso').innerHTML = '<option value="">— ninguno —</option>' + casosParaVincular().map(c => `<option value="${esc(c.clave)}">${esc(c.texto)}</option>`).join('');
    await cargarInventarioProducto(); render();
  });
  limpiarForm();
  await cargarInventarioProducto();
  render();
}
