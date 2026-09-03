// Punto 13 de AjustesERP: sección de control de inventario de materia
// prima. Es de solo lectura — para cargar/ajustar stock, costo unitario o
// mínimos se sigue editando desde Maestros > "Materias primas" o
// "Materiales por área" (donde ya existe el patrón de alta/edición), esta
// pantalla solo junta ambos catálogos en un solo tablero con alertas.
import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { fmtNum, fmtCOP, toast, fechaHoyLocal, wireTableScroll } from './helpers.js';
import { mostrarDetalleOrden } from './ordenes.js';
import { parseCantidadConsumo, listaAreasDisponibles } from './registrar.js';
import { getCurrentUser } from './auth.js';

// Pedido: "cuando se hace el ingreso de material, desde el inventario se
// debe revisar qué órdenes están esperando dicho material" — se cruza
// contra alertas_faltante_material (ver js/ordenes.js, saveOpp), que
// queda viva hasta que se repone el stock (js/maestros.js, materiasCtl).
function ordenesEsperando(materiaPrimaCodigo){
  return DB.alertas_faltante_material.filter(a => a.materia_prima_codigo === materiaPrimaCodigo);
}

// tabla/key identifican de dónde sale cada fila y con qué se actualiza en
// Supabase (mismo criterio que recibos_caja_items: 'materias_primas' usa el
// código como llave, 'insumos_area' usa el id) — lo necesitan tanto el botón
// "Ajustar" de esta pantalla como el conteo de "Inventario físico".
function filasInventario(){
  const filas = [];
  DB.materias_primas.filter(m => m.activo !== false).forEach(m => filas.push({
    tipo: 'Materia prima', tabla: 'materias_primas', key: m.codigo,
    codigo: m.codigo || null, nombre: m.nombre, grupo: m.categoria || '—', unidad: m.unidad || 'pliegos',
    stock: m.stock_actual || 0, minimo: m.stock_minimo || 0, costo: m.costo_unitario != null ? m.costo_unitario : null,
    esperando: ordenesEsperando(m.codigo)
  }));
  DB.insumos_area.filter(m => m.activo !== false).forEach(m => filas.push({
    tipo: 'Insumo de área' + (m.tipo_consumo === 'Indirecto' ? ' (Indirecto)' : ''), tabla: 'insumos_area', key: m.id,
    codigo: null, nombre: m.nombre, grupo: m.area || '—', unidad: m.unidad || 'unidad',
    stock: m.stock_actual || 0, minimo: m.stock_minimo || 0, costo: m.costo_unitario != null ? m.costo_unitario : null,
    esperando: []
  }));
  return filas;
}

// Pedido: filtrar el inventario por producto (nombre) o por código. Al
// buscar, se busca en TODO el catálogo (no solo "en seguimiento") — así
// se puede encontrar un material aunque todavía no tenga stock/mínimo
// configurado, para ver o cargar sus datos.
let filtroInventario = '';
function coincideConFiltro(f){
  if(!filtroInventario) return true;
  const t = filtroInventario.toLowerCase();
  return (f.nombre||'').toLowerCase().includes(t) || (f.codigo||'').toLowerCase().includes(t);
}

export function renderInventario(){
  const tbody = document.querySelector('#tbl-inventario tbody');
  if(!tbody) return;
  const filas = filasInventario();

  // "En seguimiento" = ya se le puso un mínimo o un stock desde Maestros,
  // hay una orden esperándolo, o el stock quedó en negativo (se consumió
  // más de lo que había — se deja así a propósito, ver descontarInventario-
  // YCargarCosto en js/registrar.js: es normal en litografía que el
  // consumo real se registre antes de que llegue la compra). Sin este
  // filtro, los 226 papeles precargados (todos en 0/0 por default)
  // saldrían de entrada como si no hubiera ni una hoja, PERO un negativo
  // nunca se puede perder de vista aunque nunca se le haya puesto mínimo.
  const base = filtroInventario ? filas.filter(coincideConFiltro) : filas;
  const enSeguimiento = filtroInventario ? base : base.filter(f => f.minimo > 0 || f.stock !== 0 || f.esperando.length > 0);
  const negativos = enSeguimiento.filter(f => f.stock < 0);
  const bajoMinimo = enSeguimiento.filter(f => f.stock < 0 || (f.minimo > 0 && f.stock < f.minimo));
  const esperando = enSeguimiento.filter(f => f.esperando.length > 0);
  const valorTotal = enSeguimiento.reduce((s,f) => s + (f.costo ? f.costo * f.stock : 0), 0);

  const cont = document.getElementById('inv-kpis');
  if(cont){
    cont.innerHTML = `
      <div class="kpi"><div class="lbl">Materiales en seguimiento</div><div class="val">${enSeguimiento.length}</div><div class="sub">de ${filas.length} en los catálogos</div></div>
      <div class="kpi"><div class="lbl">Stock en negativo</div><div class="val ${negativos.length ? 'neg' : ''}">${negativos.length}</div><div class="sub">${negativos.length ? 'se consumió más de lo que había — urge comprar' : 'ninguno en negativo'}</div></div>
      <div class="kpi"><div class="lbl">Bajo el mínimo</div><div class="val ${bajoMinimo.length ? 'neg' : ''}">${bajoMinimo.length}</div><div class="sub">${bajoMinimo.length ? 'considera comprar' : 'todo en orden'}</div></div>
      <div class="kpi"><div class="lbl">Con órdenes esperando</div><div class="val ${esperando.length ? 'neg' : ''}">${esperando.length}</div><div class="sub">${esperando.length ? 'repón stock para liberarlas' : 'ninguna orden esperando'}</div></div>
      <div class="kpi"><div class="lbl">Valor estimado en inventario</div><div class="val">${fmtCOP(valorTotal)}</div><div class="sub">stock actual × costo por unidad</div></div>`;
  }

  // Negativo primero (lo más urgente), luego las que tienen órdenes
  // esperando, luego por qué tan lejos están de su mínimo.
  const ordenadas = enSeguimiento.slice().sort((a,b) =>
    (a.stock<0?0:1) - (b.stock<0?0:1) || (b.esperando.length>0) - (a.esperando.length>0) || (a.stock - a.minimo) - (b.stock - b.minimo));
  filasActuales = ordenadas; // para que el botón "Ajustar" encuentre la fila por índice
  tbody.innerHTML = ordenadas.map((f, i) => {
    const negativo = f.stock < 0;
    const bajo = negativo || (f.minimo > 0 && f.stock < f.minimo);
    const esperandoHTML = f.esperando.length
      ? f.esperando.map(a => `<span class="row-btn fila-clicable" data-orden="${a.orden}" style="display:inline-block;margin:1px 3px 1px 0">Orden ${a.orden} (falta ${fmtNum(a.cantidad_faltante,0)} ${a.unidad||''})</span>`).join('')
      : '—';
    const estadoHTML = negativo
      ? '<span class="estado-chip pending">🔴 Stock negativo</span>'
      : (bajo ? '<span class="estado-chip pending">⚠ Bajo mínimo</span>' : '<span class="estado-chip done">✓ OK</span>');
    return `<tr style="${bajo ? 'background:var(--bg-warning,rgba(163,45,45,.06))' : ''}">
      <td>${f.tipo}</td><td>${f.codigo || '—'}</td><td>${f.nombre}</td><td>${f.grupo}</td>
      <td class="num" style="${negativo?'color:var(--bad);font-weight:600':''}">${fmtNum(f.stock,2)} ${f.unidad}</td>
      <td class="num">${fmtNum(f.minimo,2)}</td>
      <td class="num">${f.costo != null ? fmtCOP(f.costo) : '—'}</td>
      <td>${estadoHTML}</td>
      <td>${esperandoHTML}</td>
      <td><button type="button" class="row-btn" data-ajustar-idx="${i}">Ajustar</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="10" style="text-align:center;color:var(--ink-faint)">${filtroInventario ? 'Ningún material coincide con "' + filtroInventario + '"' : 'Todavía no configuraste stock ni mínimo para ningún material — hazlo desde "Materias primas" o "Materiales por área"'}</td></tr>`;

  tbody.querySelectorAll('[data-orden]').forEach(el => {
    el.addEventListener('click', () => irAOrdenYVerDetalleDesdeInventario(parseInt(el.dataset.orden, 10)));
  });
  tbody.querySelectorAll('[data-ajustar-idx]').forEach(el => {
    el.addEventListener('click', () => abrirModalAjuste(filasActuales[parseInt(el.dataset.ajustarIdx, 10)]));
  });

  refrescarMovimientosInventario();
}
let filasActuales = []; // última tanda de filasInventario() renderizada en tbl-inventario

// Cambia a la pestaña de Órdenes y abre el detalle completo — mismo
// patrón que usa dashboard.js (irAOrdenYVerDetalle) para sus tablas.
function irAOrdenYVerDetalleDesdeInventario(orden){
  const btnTab = document.querySelector('.tab-btn[data-tab="ordenes"]');
  if(!btnTab) return;
  btnTab.click();
  setTimeout(() => mostrarDetalleOrden(orden), 50);
}

// ---------- Movimientos de inventario (Kardex: entradas y salidas) ----------
// Pedido: una sola tabla con Fecha/Código/Artículo/Entra/Sale/Valor unitario/
// Valor total, y al hacer click en una fila un modal con el detalle — para
// una compra (proveedor) y para un consumo (orden + trabajo) por separado.
//
// Las ENTRADAS salen de recibos_caja_items (cada línea de una compra
// importada que quedó ligada a un material real del inventario — ver
// guardarRecibo en js/recibos.js) cruzadas con recibos_caja (fecha,
// proveedor). No están precargadas en DB (store.js solo trae los últimos
// 100 recibos, para no cargar de más al arrancar), así que se piden aparte
// y se guardan en caché acá — se invalida cada vez que una compra se
// guarda, edita o borra (ver invalidarEntradasInventario, llamada desde
// js/recibos.js).
//
// Las SALIDAS salen de DB.produccion (ya está completo en memoria): cada
// registro con un consumo numérico de materia prima es una salida. El
// costo real ya quedó guardado en costos_movimientos como "Consumo
// automático…" ligado a produccion_id (ver descontarInventarioYCargarCosto
// en js/registrar.js) — se reusa ese valor en vez de recalcularlo con el
// costo_unitario ACTUAL del material, que puede haber cambiado desde
// entonces.
let entradasCache = null; // null = todavía no se cargó del servidor
let cargandoEntradas = false;
let movimientosFiltrados = []; // última tanda renderizada, para que el click del modal encuentre el objeto por índice

export function invalidarEntradasInventario(){
  entradasCache = null;
}

function nombreDeMaterial(tabla, key){
  if(tabla === 'materias_primas') return DB.materias_primas.find(m => m.codigo === key)?.nombre || null;
  if(tabla === 'insumos_area') return DB.insumos_area.find(m => String(m.id) === key)?.nombre || null;
  return null;
}

async function cargarEntradasInventario(){
  const [itemsRes, recibosRes] = await Promise.all([
    sb.from('recibos_caja_items')
      .select('recibo_id,codigo,descripcion,cantidad,valor_neto_unitario,material_tabla,material_key')
      .not('material_tabla', 'is', null).not('material_key', 'is', null).gt('cantidad', 0),
    sb.from('recibos_caja').select('id,fecha,tercero,numero_recibo')
  ]);
  if(itemsRes.error) throw itemsRes.error;
  if(recibosRes.error) throw recibosRes.error;
  const recibosPorId = new Map((recibosRes.data || []).map(r => [r.id, r]));
  return (itemsRes.data || []).map(it => {
    const recibo = recibosPorId.get(it.recibo_id);
    const codigo = it.material_tabla === 'materias_primas' ? it.material_key : (it.codigo || null);
    return {
      tipo: 'entrada',
      fecha: recibo ? recibo.fecha : null,
      codigo,
      nombre: nombreDeMaterial(it.material_tabla, it.material_key) || it.descripcion || '(sin descripción)',
      cantidad: it.cantidad || 0,
      valorUnitario: it.valor_neto_unitario ?? null,
      valorTotal: it.valor_neto_unitario != null ? it.valor_neto_unitario * (it.cantidad || 0) : null,
      proveedor: recibo ? recibo.tercero : null,
      numeroRecibo: recibo ? recibo.numero_recibo : null
    };
  });
}

// Solo cuenta como salida el consumo escrito como NÚMERO (lo único que de
// verdad descuenta del inventario — ver unidadNumericaDelMaterial en
// registrar.js); un consumo de texto libre nunca tocó el stock.
function salidasDeInventario(){
  const salidas = [];
  DB.produccion.forEach(r => {
    if(!r.materiaPrima) return;
    const cantidad = parseFloat(parseCantidadConsumo(r.consumoMP));
    if(!cantidad || cantidad <= 0) return;
    const valorTotal = DB.costos_movimientos
      .filter(m => m.produccion_id === r.id && (m.comentario || '').startsWith('Consumo automático'))
      .reduce((s, m) => s + (m.valor || 0), 0);
    const matPrima = DB.materias_primas.find(m => m.nombre === r.materiaPrima);
    // "Directo" = el costo de este consumo queda ligado a la orden (sale
    // en "Materiales consumidos" del Detalle de la orden). Una materia
    // prima SIEMPRE es directa — es el papel/insumo que la orden consume.
    // Un insumo puede marcarse "Indirecto" en Maestros > Materiales por
    // área (ej. grasa de mantenimiento): ahí el costo NO se le carga a la
    // orden aunque el operario lo haya registrado mientras trabajaba en
    // una — ver descontarInventarioYCargarCosto en registrar.js.
    const insumo = !matPrima ? DB.insumos_area.find(m => m.nombre === r.materiaPrima) : null;
    const esIndirecto = !!insumo && insumo.tipo_consumo === 'Indirecto';
    salidas.push({
      tipo: 'salida', fecha: r.fecha, codigo: matPrima ? matPrima.codigo || null : null,
      nombre: r.materiaPrima, cantidad,
      valorUnitario: valorTotal > 0 ? valorTotal / cantidad : null,
      valorTotal: valorTotal > 0 ? valorTotal : null,
      directo: !esIndirecto, orden: r.orden, trabajo: r.trabajo, area: r.area, actividad: r.actividad
    });
  });
  return salidas;
}

// Los ajustes (botón "Ajustar" de la tabla de arriba, o una línea de un
// conteo de "Inventario físico") ya están completos en memoria
// (DB.inventario_ajustes se carga entero al arrancar) — no hace falta
// pedirlos aparte como las entradas. Se muestran como entrada o salida
// según el signo de la diferencia que quedó guardada.
function ajustesComoMovimientos(){
  return DB.inventario_ajustes.map(a => ({
    tipo: (a.cantidad || 0) >= 0 ? 'entrada' : 'salida', esAjuste: true, tipoAjuste: a.tipo,
    fecha: a.fecha, codigo: a.codigo, nombre: a.nombre,
    cantidad: Math.abs(a.cantidad || 0),
    valorUnitario: a.costo_unitario ?? null,
    valorTotal: a.valor != null ? Math.abs(a.valor) : null,
    motivo: a.motivo, area: a.area, usuario: a.usuario, stockAnterior: a.stock_anterior, stockNuevo: a.stock_nuevo
  }));
}

function renderMovimientosInventarioTabla(){
  const tbody = document.querySelector('#tbl-inv-movimientos tbody');
  if(!tbody) return;
  const todos = [...(entradasCache || []), ...salidasDeInventario(), ...ajustesComoMovimientos()]
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  movimientosFiltrados = filtroInventario ? todos.filter(coincideConFiltro) : todos;

  tbody.innerHTML = movimientosFiltrados.map((m, i) => `<tr class="fila-clicable" data-mov-idx="${i}">
      <td>${(m.fecha || '').slice(0, 10) || '—'}</td>
      <td>${m.codigo || '—'}</td>
      <td>${m.nombre || '—'}</td>
      <td class="num">${m.tipo === 'entrada' ? fmtNum(m.cantidad, 2) : ''}</td>
      <td class="num">${m.tipo === 'salida' ? fmtNum(m.cantidad, 2) : ''}</td>
      <td class="num">${m.valorUnitario != null ? fmtCOP(m.valorUnitario) : '—'}</td>
      <td class="num">${m.valorTotal != null ? fmtCOP(m.valorTotal) : '—'}</td>
    </tr>`).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--ink-faint)">${
      filtroInventario ? 'Ningún movimiento coincide con "' + filtroInventario + '"' : (entradasCache === null ? 'Cargando movimientos…' : 'Todavía no hay movimientos de inventario registrados')
    }</td></tr>`;

  tbody.querySelectorAll('[data-mov-idx]').forEach(tr => {
    tr.addEventListener('click', () => abrirModalMovimiento(movimientosFiltrados[parseInt(tr.dataset.movIdx, 10)]));
  });
}

// Refresca la tabla de movimientos: las salidas siempre están al día (ya
// están completas en memoria), las entradas se piden al servidor solo la
// primera vez (o después de invalidarEntradasInventario) — mientras tanto
// se muestra igual con lo que haya en caché, y se vuelve a pintar cuando
// llegan.
function refrescarMovimientosInventario(){
  renderMovimientosInventarioTabla();
  if(entradasCache !== null || cargandoEntradas) return;
  cargandoEntradas = true;
  cargarEntradasInventario()
    .then(datos => { entradasCache = datos; })
    .catch(err => { console.error('No se pudieron cargar las entradas de inventario (compras):', err); entradasCache = []; })
    .finally(() => { cargandoEntradas = false; renderMovimientosInventarioTabla(); });
}

function abrirModalMovimiento(m){
  if(!m) return;
  const titulo = m.esAjuste
    ? (m.tipoAjuste === 'fisico' ? '📋 Ajuste por inventario físico' : '🔧 Ajuste de inventario')
    : (m.tipo === 'entrada' ? '⬇ Entrada de inventario' : '⬆ Salida de inventario');
  document.getElementById('inv-mov-modal-titulo').textContent = titulo;
  document.getElementById('inv-mov-modal-articulo').innerHTML = `<b>${m.codigo ? m.codigo + ' — ' : ''}${m.nombre || '—'}</b>`;
  let filas;
  if(m.esAjuste){
    filas = [
      ['Fecha', (m.fecha || '').slice(0, 10) || '—'],
      ['Motivo', m.motivo || '—'],
      ...(m.area ? [['Área / centro de costo', m.area]] : []),
      ['Responsable', m.usuario || '—'],
      ['Stock anterior', fmtNum(m.stockAnterior, 2)],
      ['Stock nuevo', fmtNum(m.stockNuevo, 2)],
      [m.tipo === 'entrada' ? 'Cantidad ajustada (entrada)' : 'Cantidad ajustada (salida)', fmtNum(m.cantidad, 2)],
      ['Valor unitario', m.valorUnitario != null ? fmtCOP(m.valorUnitario) : '—'],
      ['Valor total', m.valorTotal != null ? fmtCOP(m.valorTotal) : '—']
    ];
  } else if(m.tipo === 'entrada'){
    filas = [
      ['Fecha', (m.fecha || '').slice(0, 10) || '—'],
      ['Proveedor', m.proveedor || '—'],
      ['Cantidad', fmtNum(m.cantidad, 2)],
      ['Valor unitario', m.valorUnitario != null ? fmtCOP(m.valorUnitario) : '—'],
      ['Valor total', m.valorTotal != null ? fmtCOP(m.valorTotal) : '—']
    ];
  } else {
    filas = [
      ['Fecha', (m.fecha || '').slice(0, 10) || '—'],
      ['Tipo de consumo', m.directo ? 'Directo (el costo se carga a la orden)' : `Indirecto (gasto de planta, no se carga a ninguna orden — ${m.area || 'área'}${m.actividad ? ' / ' + m.actividad : ''})`],
      ['Orden de producción', m.orden != null ? m.orden : '—'],
      ['Trabajo', m.trabajo || '—'],
      ['Cantidad', fmtNum(m.cantidad, 2)],
      ['Valor unitario', m.valorUnitario != null ? fmtCOP(m.valorUnitario) : '—'],
      ['Valor total', m.valorTotal != null ? fmtCOP(m.valorTotal) : '—']
    ];
  }
  document.getElementById('inv-mov-modal-detalle').innerHTML =
    filas.map(([k, v]) => `<div class="reg-running-row"><span>${k}</span><b>${v}</b></div>`).join('');
  document.getElementById('inv-mov-modal').style.display = 'flex';
}

function cerrarModalMovimiento(){
  document.getElementById('inv-mov-modal').style.display = 'none';
}

function wireModalMovimiento(){
  const modal = document.getElementById('inv-mov-modal');
  const btnCerrar = document.getElementById('inv-mov-modal-cerrar');
  if(btnCerrar) btnCerrar.addEventListener('click', cerrarModalMovimiento);
  if(modal) modal.addEventListener('click', e => { if(e.target === modal) cerrarModalMovimiento(); });
}

// ---------- Ajustes de inventario (puntual y conteo físico) ----------
// Un solo camino para los dos: el botón "Ajustar" de la tabla de arriba
// (una fila a la vez, con modal) y el conteo de "Inventario físico" (varias
// filas de una — ver más abajo) terminan los dos acá. Deja guardado el
// nuevo stock en el material Y una fila de auditoría en inventario_ajustes
// (motivo, quién, cuánto cambió) — antes, corregir el stock en Maestros no
// dejaba ningún rastro.
async function guardarAjusteMaterial({ tabla, key, codigo, nombre, stockAnterior, stockNuevo, costoUnitario, motivo, tipo, fecha, area }){
  const cantidad = stockNuevo - stockAnterior;
  if(cantidad === 0) return null; // nada que ajustar
  const eqCol = tabla === 'materias_primas' ? 'codigo' : 'id';
  const { error: errStock } = await sb.from(tabla).update({ stock_actual: stockNuevo }).eq(eqCol, key);
  if(errStock) throw errStock;
  const mat = tabla === 'materias_primas'
    ? DB.materias_primas.find(m => m.codigo === key)
    : DB.insumos_area.find(m => m.id === key);
  if(mat) mat.stock_actual = stockNuevo;

  const row = {
    fecha: fecha || fechaHoyLocal(), material_tabla: tabla, material_key: String(key), codigo: codigo || null, nombre,
    tipo: tipo || 'ajuste', stock_anterior: stockAnterior, stock_nuevo: stockNuevo, cantidad,
    costo_unitario: costoUnitario ?? null, valor: costoUnitario != null ? cantidad * costoUnitario : null,
    motivo, area: area || null, usuario: getCurrentUser() ? getCurrentUser().nombre : null
  };
  const { data, error } = await sb.from('inventario_ajustes').insert([row]).select();
  if(error) throw error;
  DB.inventario_ajustes.unshift(data[0]);
  return data[0];
}

let filaAjusteActual = null;
function actualizarDiferenciaAjuste(){
  const nuevo = parseFloat(document.getElementById('inv-ajuste-nuevo-stock').value);
  const dif = document.getElementById('inv-ajuste-diferencia');
  if(!filaAjusteActual || isNaN(nuevo)){ dif.value = ''; return; }
  const d = nuevo - filaAjusteActual.stock;
  dif.value = (d > 0 ? '+' : '') + fmtNum(d, 2) + ' ' + (filaAjusteActual.unidad || '');
}

function abrirModalAjuste(f){
  if(!f) return;
  filaAjusteActual = f;
  document.getElementById('inv-ajuste-modal-articulo').innerHTML = `<b>${f.codigo ? f.codigo + ' — ' : ''}${f.nombre}</b>`;
  document.getElementById('inv-ajuste-modal-stock').textContent = `Stock actual en el sistema: ${fmtNum(f.stock, 2)} ${f.unidad || ''}`;
  document.getElementById('inv-ajuste-nuevo-stock').value = '';
  document.getElementById('inv-ajuste-diferencia').value = '';
  document.getElementById('inv-ajuste-motivo').value = '';
  document.getElementById('inv-ajuste-nota').value = '';
  document.getElementById('inv-ajuste-nota-wrap').style.display = 'none';
  const areaSel = document.getElementById('inv-ajuste-area');
  areaSel.innerHTML = '<option value="">— Elige un área —</option>' + listaAreasDisponibles().map(a => `<option value="${a}">${a}</option>`).join('');
  document.getElementById('inv-ajuste-area-wrap').style.display = 'none';
  document.getElementById('inv-ajuste-modal').style.display = 'flex';
  document.getElementById('inv-ajuste-nuevo-stock').focus();
}

function cerrarModalAjuste(){
  document.getElementById('inv-ajuste-modal').style.display = 'none';
  filaAjusteActual = null;
}

async function guardarAjusteDesdeModal(){
  const f = filaAjusteActual;
  if(!f) return;
  const nuevoStock = parseFloat(document.getElementById('inv-ajuste-nuevo-stock').value);
  const motivoSel = document.getElementById('inv-ajuste-motivo').value;
  const nota = document.getElementById('inv-ajuste-nota').value.trim();
  const esIndirecto = motivoSel === 'Consumo indirecto';
  const area = document.getElementById('inv-ajuste-area').value;
  if(isNaN(nuevoStock)){ toast('Escribe el nuevo stock (el conteo real)'); document.getElementById('inv-ajuste-nuevo-stock').focus(); return; }
  if(!motivoSel){ toast('Elige un motivo para el ajuste'); document.getElementById('inv-ajuste-motivo').focus(); return; }
  if(esIndirecto && !area){ toast('Elige el área / centro de costo de este consumo indirecto'); document.getElementById('inv-ajuste-area').focus(); return; }
  if(nuevoStock === f.stock){ toast('El nuevo stock es igual al actual — no hay nada que ajustar'); return; }
  const motivo = nota ? motivoSel + ' — ' + nota : motivoSel;

  const btn = document.getElementById('inv-ajuste-guardar');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try{
    await guardarAjusteMaterial({
      tabla: f.tabla, key: f.key, codigo: f.codigo, nombre: f.nombre,
      stockAnterior: f.stock, stockNuevo: nuevoStock, costoUnitario: f.costo, motivo, tipo: 'ajuste',
      area: esIndirecto ? area : null
    });
    toast('Ajuste guardado — inventario actualizado');
    cerrarModalAjuste();
    renderInventario();
  }catch(err){
    console.error(err);
    toast('Error al guardar el ajuste — revisa la consola');
  }finally{
    btn.disabled = false; btn.textContent = 'Guardar ajuste';
  }
}

function wireModalAjuste(){
  document.getElementById('inv-ajuste-nuevo-stock').addEventListener('input', actualizarDiferenciaAjuste);
  document.getElementById('inv-ajuste-motivo').addEventListener('change', e => {
    document.getElementById('inv-ajuste-nota-wrap').style.display = e.target.value ? '' : 'none';
    document.getElementById('inv-ajuste-area-wrap').style.display = e.target.value === 'Consumo indirecto' ? '' : 'none';
  });
  document.getElementById('inv-ajuste-cancelar').addEventListener('click', cerrarModalAjuste);
  document.getElementById('inv-ajuste-guardar').addEventListener('click', guardarAjusteDesdeModal);
  const modal = document.getElementById('inv-ajuste-modal');
  modal.addEventListener('click', e => { if(e.target === modal) cerrarModalAjuste(); });
}

// ---------- Inventario físico (conteo completo) ----------
// Mismo mecanismo que "Ajustar" (guardarAjusteMaterial), pero para varias
// filas de una — cada fila con un "Conteo físico" distinto al stock del
// sistema genera su propio ajuste (tipo 'fisico'), una por una en orden
// (no en paralelo, para no perder ninguna si algo falla a mitad de camino
// y poder avisar exactamente cuál quedó pendiente).
let filasFisicoActuales = [];

function abrirPanelFisico(){
  // Arranca del catálogo completo (no solo "en seguimiento") respetando el
  // filtro de búsqueda vigente — así se puede acotar el conteo a una parte
  // del catálogo escribiendo en "Buscar por producto o código" antes de
  // iniciar.
  const todas = filasInventario();
  filasFisicoActuales = filtroInventario ? todas.filter(coincideConFiltro) : todas;
  filasFisicoActuales.sort((a,b) => a.nombre.localeCompare(b.nombre));

  document.getElementById('inv-fisico-fecha').value = fechaHoyLocal();
  document.getElementById('inv-fisico-responsable').value = getCurrentUser() ? getCurrentUser().nombre : '';
  const tbody = document.querySelector('#tbl-inv-fisico tbody');
  tbody.innerHTML = filasFisicoActuales.map((f, i) => `<tr data-fisico-idx="${i}">
      <td>${f.codigo || '—'}</td><td>${f.nombre}</td><td>${f.grupo}</td>
      <td class="num">${fmtNum(f.stock, 2)} ${f.unidad || ''}</td>
      <td class="num"><input type="number" class="num inv-fisico-conteo" step="0.01" style="width:110px" data-fisico-idx="${i}"></td>
      <td class="num inv-fisico-dif" data-fisico-idx="${i}">—</td>
    </tr>`).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Ningún material coincide con "${filtroInventario}"</td></tr>`;

  tbody.querySelectorAll('.inv-fisico-conteo').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = parseInt(inp.dataset.fisicoIdx, 10);
      const f = filasFisicoActuales[i];
      const celdaDif = tbody.querySelector(`.inv-fisico-dif[data-fisico-idx="${i}"]`);
      const val = parseFloat(inp.value);
      if(isNaN(val)){ celdaDif.textContent = '—'; return; }
      const d = val - f.stock;
      celdaDif.textContent = (d > 0 ? '+' : '') + fmtNum(d, 2);
      celdaDif.style.color = d === 0 ? '' : (d > 0 ? 'var(--good)' : 'var(--bad)');
    });
  });

  document.getElementById('inv-fisico-hint').textContent = `${filasFisicoActuales.length} material(es) para contar`;
  document.getElementById('inv-fisico-panel').style.display = '';
  document.getElementById('inv-fisico-iniciar').style.display = 'none';
}

function cerrarPanelFisico(){
  document.getElementById('inv-fisico-panel').style.display = 'none';
  document.getElementById('inv-fisico-iniciar').style.display = '';
  filasFisicoActuales = [];
}

async function guardarConteoFisico(){
  const fecha = document.getElementById('inv-fisico-fecha').value || fechaHoyLocal();
  const responsable = document.getElementById('inv-fisico-responsable').value.trim() || null;
  const tbody = document.querySelector('#tbl-inv-fisico tbody');
  const inputs = Array.from(tbody.querySelectorAll('.inv-fisico-conteo'));
  const pendientes = inputs
    .map(inp => ({ idx: parseInt(inp.dataset.fisicoIdx, 10), valor: parseFloat(inp.value) }))
    .filter(x => !isNaN(x.valor) && x.valor !== filasFisicoActuales[x.idx].stock);

  if(!pendientes.length){ toast('No escribiste ningún conteo distinto al stock del sistema — nada para guardar'); return; }

  const btn = document.getElementById('inv-fisico-guardar');
  btn.disabled = true;
  let guardados = 0;
  const fallidos = [];
  for(const p of pendientes){
    const f = filasFisicoActuales[p.idx];
    btn.textContent = `Guardando ${guardados + 1}/${pendientes.length}…`;
    try{
      await guardarAjusteMaterial({
        tabla: f.tabla, key: f.key, codigo: f.codigo, nombre: f.nombre,
        stockAnterior: f.stock, stockNuevo: p.valor, costoUnitario: f.costo,
        motivo: 'Inventario físico' + (responsable ? ' — ' + responsable : ''), tipo: 'fisico', fecha
      });
      guardados++;
    }catch(err){
      console.error('No se pudo guardar el ajuste de "' + f.nombre + '":', err);
      fallidos.push(f.nombre);
    }
  }
  btn.disabled = false; btn.textContent = 'Guardar conteo';

  toast(`Conteo guardado: ${guardados} material(es) ajustado(s)` + (fallidos.length ? ` · ⚠️ no se pudo con: ${fallidos.join(', ')} — revisa la consola` : ''), fallidos.length ? 7000 : undefined);
  if(!fallidos.length) cerrarPanelFisico();
  renderInventario();
}

function wirePanelFisico(){
  document.getElementById('inv-fisico-iniciar').addEventListener('click', abrirPanelFisico);
  document.getElementById('inv-fisico-cancelar').addEventListener('click', cerrarPanelFisico);
  document.getElementById('inv-fisico-guardar').addEventListener('click', guardarConteoFisico);
}

export function initInventario(){
  renderInventario();
  wireModalMovimiento();
  wireModalAjuste();
  wirePanelFisico();
  wireTableScroll('tbl-inventario', 'inv-ir-inicio', 'inv-ir-final');
  wireTableScroll('tbl-inv-fisico', 'inv-fisico-ir-inicio', 'inv-fisico-ir-final');
  wireTableScroll('tbl-inv-movimientos', 'inv-mov-ir-inicio', 'inv-mov-ir-final');
  const buscar = document.getElementById('inv-buscar');
  if(buscar){
    buscar.addEventListener('input', () => {
      filtroInventario = buscar.value.trim();
      renderInventario();
    });
  }
}
