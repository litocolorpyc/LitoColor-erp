import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast, fmtCOP, fmtNum, fechaHoyLocal, imprimirInforme, exportarExcel, agregarBotonExcelVentana } from './helpers.js';
import { getCurrentUser } from './auth.js';
import { renderGerencial } from './dashboard.js';
import { renderOppRecent } from './ordenes.js';

// "Remisión" (pedido explícito 17sep26): documento de despacho real —
// cliente elegido de un desplegable que filtra mientras se escribe,
// órdenes del cliente para marcar cuáles se despachan, ítems editables
// (se llenan solos con las piezas de esas órdenes), numeración automática
// (ver Maestros > Documentos, tabla consecutivos_documentos + la función
// siguiente_consecutivo en Supabase) y listado imprimible con
// ver/editar/eliminar. Reemplaza, como documento, al campo de texto libre
// "numero_remision" que ya existe en el cierre de la actividad "Remisión y
// Despacho" (js/registrar.js) — ese campo se deja tal cual, sin tocar, para
// no arriesgar el flujo que cierra la orden; esta pantalla es independiente.

function normalizarTexto(s){
  return String(s||'').toLowerCase().trim().replace(/\s+/g,' ');
}

// ---------- estado del formulario ----------
let clienteActual = null;      // fila de DB.clientes, o null si se escribió a mano
let ordenesSeleccionadas = new Set();
let itemsActuales = [];
let remisionEditandoId = null;

function mostrarCrearCard(){
  document.getElementById('rem-crear-card').style.display = '';
}
function ocultarCrearCard(){
  document.getElementById('rem-crear-card').style.display = 'none';
}

function limpiarFormularioRemision(){
  clienteActual = null;
  ordenesSeleccionadas = new Set();
  itemsActuales = [];
  remisionEditandoId = null;
  document.getElementById('rem-cliente-input').value = '';
  document.getElementById('rem-nit').value = '';
  document.getElementById('rem-telefono').value = '';
  document.getElementById('rem-direccion').value = '';
  document.getElementById('rem-observaciones').value = '';
  document.getElementById('rem-fecha').value = fechaHoyLocal();
  renderOrdenesDelCliente('');
  document.getElementById('rem-guardar').textContent = 'Revisar y guardar';
  const aviso = document.getElementById('rem-editando-aviso');
  if(aviso) aviso.style.display = 'none';
  actualizarNumeroPreview();
  renderTablaItemsRemision();
  actualizarTotalRemision();
}

// Muestra en el campo "N° de remisión" cuál sería el próximo número, según
// el maestro de Documentos — es solo una SUGERENCIA editable: la usuaria
// puede escribirle encima el número que corresponda (ej. el del talonario
// físico de remisiones, que no siempre calza con el consecutivo del
// sistema — pedido explícito 21sep26). Si al guardar el campo quedó igual
// a esta sugerencia, se reserva por la función SQL siguiente_consecutivo
// (atómico, para que dos personas guardando a la vez no se lleven el mismo
// número); si se escribió un número distinto, se usa tal cual y el
// consecutivo automático no avanza (ver guardarRemision).
export function actualizarNumeroPreview(){
  const el = document.getElementById('rem-numero');
  if(!el) return; // esta pestaña no existe para este rol/página
  if(remisionEditandoId != null) return; // en edición ya se puso el número real
  const doc = DB.consecutivos_documentos.find(d => d.tipo === 'remision');
  el.value = doc ? doc.siguiente_numero : '';
  el.placeholder = 'se asigna al guardar';
}

function numeroConPrefijo(numero){
  return 'RM ' + numero;
}

// ---------- desplegable de cliente (filtra mientras se escribe) ----------
function renderDropdownClientes(query){
  const cont = document.getElementById('rem-cliente-dropdown');
  const q = normalizarTexto(query);
  const coincidencias = q
    ? DB.clientes.filter(c => c.activo !== false && normalizarTexto(c.nombre).includes(q)).slice(0, 8)
    : DB.clientes.filter(c => c.activo !== false).slice(0, 8);
  if(!coincidencias.length){
    cont.innerHTML = '<div class="ac-empty">Sin clientes que coincidan — puedes seguir escribiendo el nombre a mano</div>';
  } else {
    cont.innerHTML = coincidencias.map((c,i) => `<div class="ac-item" data-i="${i}">${c.nombre}${c.ciudad?` <span style="opacity:.6">· ${c.ciudad}</span>`:''}</div>`).join('');
  }
  cont.style.display = 'block';
  cont.querySelectorAll('.ac-item').forEach(el => {
    el.addEventListener('mousedown', e => {
      e.preventDefault();
      const c = coincidencias[parseInt(el.dataset.i,10)];
      seleccionarCliente(c);
    });
  });
}

function ocultarDropdownClientes(){
  document.getElementById('rem-cliente-dropdown').style.display = 'none';
}

function seleccionarCliente(cliente){
  clienteActual = cliente;
  document.getElementById('rem-cliente-input').value = cliente.nombre;
  document.getElementById('rem-nit').value = cliente.nit || '';
  document.getElementById('rem-telefono').value = cliente.telefono || '';
  document.getElementById('rem-direccion').value = cliente.direccion || '';
  ocultarDropdownClientes();
  renderOrdenesDelCliente(cliente.nombre);
}

// ---------- órdenes del cliente elegido ----------
// Número(s) de remisión en que ya aparece cada orden — sin contar la
// remisión que se está editando ahora mismo (sus órdenes deben seguir
// saliendo marcadas).
function remisionesPorOrden(){
  const mapa = new Map();
  DB.remision_ordenes.forEach(ro => {
    if(remisionEditandoId != null && ro.remision_id === remisionEditandoId) return;
    const r = DB.remisiones.find(x => x.id === ro.remision_id);
    if(!r) return;
    if(!mapa.has(ro.orden)) mapa.set(ro.orden, []);
    mapa.get(ro.orden).push(numeroConPrefijo(r.numero));
  });
  return mapa;
}

// Por defecto solo las órdenes PENDIENTES de remisión (pedido 22sep26:
// antes salían todas las del cliente, incluso las ya despachadas). La
// casilla "Mostrar también…" deja ver las ya remitidas, para entregas
// parciales de una misma orden.
function ordenesDelCliente(nombreCliente){
  const texto = normalizarTexto(nombreCliente);
  if(!texto) return [];
  const verRemitidas = document.getElementById('rem-mostrar-remitidas')?.checked;
  const remitidas = remisionesPorOrden();
  return DB.opp_ordenes
    .filter(o => o.estado !== 'Cancelada' && normalizarTexto(o.cliente) === texto)
    .filter(o => verRemitidas || !remitidas.has(o.orden) || ordenesSeleccionadas.has(o.orden))
    .map(o => ({ ...o, remisionesPrevias: remitidas.get(o.orden) || [] }))
    .sort((a,b) => b.orden - a.orden);
}

function renderOrdenesDelCliente(nombreCliente){
  const hint = document.getElementById('rem-ordenes-hint');
  const wrap = document.getElementById('rem-ordenes-wrap');
  const tbody = document.querySelector('#tbl-rem-ordenes-cliente tbody');
  const ordenes = ordenesDelCliente(nombreCliente);
  if(!ordenes.length){
    wrap.style.display = 'none';
    hint.style.display = '';
    hint.textContent = nombreCliente
      ? 'Este cliente no tiene órdenes pendientes de remisión — puedes agregar líneas manuales abajo igual, o marcar "Mostrar también…" para ver las ya remitidas.'
      : 'Elige un cliente arriba para ver sus órdenes.';
    return;
  }
  hint.style.display = 'none';
  wrap.style.display = '';
  tbody.innerHTML = ordenes.map(o => `<tr data-orden="${o.orden}">
    <td><input type="checkbox" class="rem-orden-check" value="${o.orden}" ${ordenesSeleccionadas.has(o.orden)?'checked':''}></td>
    <td><b>${o.orden}</b></td>
    <td>${o.producto || '(sin producto)'}</td>
    <td>${o.fecha ? o.fecha.slice(0,10) : ''}</td>
    <td>${o.remisionesPrevias.length ? `<span class="estado-chip done">ya en ${o.remisionesPrevias.join(', ')}</span>` : '<span class="estado-chip pending">pendiente</span>'}</td>
  </tr>`).join('');
  tbody.querySelectorAll('tr').forEach(tr => {
    const chk = tr.querySelector('.rem-orden-check');
    const disparar = () => { chk.checked = !chk.checked; toggleOrdenSeleccionada(parseInt(chk.value,10), chk.checked); };
    // clic en cualquier parte de la fila marca/desmarca — clic directo en el
    // checkbox no debe disparar dos veces (uno del propio checkbox, otro de
    // la fila), por eso la fila ignora clics que ya vinieron del checkbox.
    tr.addEventListener('click', e => { if(e.target !== chk) disparar(); });
    chk.addEventListener('change', () => toggleOrdenSeleccionada(parseInt(chk.value,10), chk.checked));
  });
}

// Un ítem por ORDEN completa (no por sub-pieza/componente interno como
// "Bolsillo" o "Cuartilla 1 x2" — eso es detalle de fabricación, no algo
// que tenga sentido mostrarle al cliente en la remisión). La descripción
// sale de opp_ordenes.producto; la cantidad, de la primera pieza (la
// principal) de esa orden. El valor sale del "Precio venta antes de IVA"
// que se haya cargado en la pestaña Presupuesto de esa orden
// (presupuesto_orden), si existe — pedido explícito 17sep26.
function toggleOrdenSeleccionada(orden, marcada){
  if(marcada){
    ordenesSeleccionadas.add(orden);
    const o = DB.opp_ordenes.find(x => x.orden === orden);
    const piezas = DB.opp_piezas.filter(p => p.orden === orden).sort((a,b)=>(a.suborden||0)-(b.suborden||0));
    const cantidad = piezas.length ? (piezas[0].cantidad || 0) : 0;
    const pres = DB.presupuesto_orden.find(p => p.orden === orden);
    let valorTotal = 0, valorUnitario = 0;
    if(pres && pres.precio_venta_antes_iva){
      valorTotal = pres.precio_venta_antes_iva;
      valorUnitario = cantidad ? Math.round(valorTotal / cantidad) : valorTotal;
    }
    itemsActuales.push({
      orden, descripcion: (o && o.producto) || ('Orden ' + orden),
      cantidad, unidad: '', valor_unitario: valorUnitario, valor_total: valorTotal
    });
    if(!pres || !pres.precio_venta_antes_iva) toast('La orden ' + orden + ' no tiene precio de venta registrado en Presupuesto — complétalo a mano');
  } else {
    ordenesSeleccionadas.delete(orden);
    itemsActuales = itemsActuales.filter(it => it.orden !== orden);
  }
  renderTablaItemsRemision();
  actualizarTotalRemision();
}

// ---------- tabla de ítems (editable) ----------
function renderTablaItemsRemision(){
  const tbody = document.querySelector('#tbl-rem-items tbody');
  tbody.innerHTML = itemsActuales.map((it,i) => `<tr data-i="${i}">
    <td><input type="text" class="rem-it-desc" value="${(it.descripcion||'').replace(/"/g,'&quot;')}" style="width:100%;min-width:200px"></td>
    <td><input type="number" class="rem-it-cant num" value="${it.cantidad||0}" style="width:80px"></td>
    <td><input type="text" class="rem-it-unidad" value="${it.unidad||''}" placeholder="ej. Hojas" style="width:80px"></td>
    <td><input type="number" class="rem-it-unit num" value="${it.valor_unitario||0}" style="width:110px"></td>
    <td><input type="number" class="rem-it-total num" value="${it.valor_total||0}" style="width:120px"></td>
    <td><button type="button" class="row-btn row-btn-danger rem-it-del">✕</button></td>
  </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Sin líneas todavía — marca una orden arriba o agrega una línea manual</td></tr>';

  tbody.querySelectorAll('tr').forEach(tr => {
    const i = parseInt(tr.dataset.i, 10);
    if(isNaN(i)) return;
    // Ojo: los campos de cantidad/valor unitario NO deben volver a dibujar
    // toda la tabla en cada tecla — eso destruye el <input> y le quita el
    // foco a mitad de la escritura, dejando solo la primera tecla puesta
    // (bug reportado 17sep26: no dejaba cambiar 1000 por 500). Solo se
    // actualiza la celda de "Valor total" de ESTA fila a mano.
    tr.querySelector('.rem-it-desc').addEventListener('input', e => itemsActuales[i].descripcion = e.target.value);
    tr.querySelector('.rem-it-cant').addEventListener('input', e => {
      itemsActuales[i].cantidad = parseFloat(e.target.value)||0;
      itemsActuales[i].valor_total = itemsActuales[i].cantidad * (itemsActuales[i].valor_unitario||0);
      tr.querySelector('.rem-it-total').value = itemsActuales[i].valor_total;
      actualizarTotalRemision();
    });
    tr.querySelector('.rem-it-unidad').addEventListener('input', e => itemsActuales[i].unidad = e.target.value);
    tr.querySelector('.rem-it-unit').addEventListener('input', e => {
      itemsActuales[i].valor_unitario = parseFloat(e.target.value)||0;
      itemsActuales[i].valor_total = itemsActuales[i].cantidad * itemsActuales[i].valor_unitario;
      tr.querySelector('.rem-it-total').value = itemsActuales[i].valor_total;
      actualizarTotalRemision();
    });
    tr.querySelector('.rem-it-total').addEventListener('input', e => {
      itemsActuales[i].valor_total = parseFloat(e.target.value)||0;
      actualizarTotalRemision();
    });
    tr.querySelector('.rem-it-del').addEventListener('click', () => {
      itemsActuales.splice(i,1);
      renderTablaItemsRemision(); actualizarTotalRemision();
    });
  });
}

function actualizarTotalRemision(){
  const hint = document.getElementById('rem-total-hint');
  const total = itemsActuales.reduce((s,it)=>s+(it.valor_total||0),0);
  hint.textContent = 'Total: ' + fmtCOP(total) + ' · ' + itemsActuales.length + ' línea(s)';
}

// ---------- guardar ----------
async function guardarRemision(){
  const clienteTexto = document.getElementById('rem-cliente-input').value.trim();
  if(!clienteTexto){ toast('Elige o escribe un cliente'); return; }
  if(!itemsActuales.length){ toast('Agrega al menos una línea antes de guardar'); return; }

  const total = itemsActuales.reduce((s,it)=>s+(it.valor_total||0),0);

  // El N° de remisión (campo "RM ___") se puede escribir a mano — pedido
  // explícito 21sep26, porque el talonario físico de remisiones no
  // siempre calza con el consecutivo automático del sistema. Si la
  // usuaria dejó el valor que se sugería (el siguiente consecutivo), se
  // sigue reservando por la función SQL atómica de siempre; si escribió
  // otro número, se usa tal cual y el consecutivo automático NO avanza
  // (para no "quemar" un número que nadie va a usar).
  const numeroTexto = document.getElementById('rem-numero').value.trim();
  const numeroManual = numeroTexto ? parseInt(numeroTexto, 10) : null;
  if(numeroTexto && (isNaN(numeroManual) || numeroManual <= 0)){
    toast('El N° de remisión debe ser un número entero positivo'); return;
  }
  const docConsecutivo = DB.consecutivos_documentos.find(d => d.tipo === 'remision');
  const numeroSugerido = docConsecutivo ? docConsecutivo.siguiente_numero : null;
  const esNumeroManual = remisionEditandoId == null && numeroManual != null && numeroManual !== numeroSugerido;

  const confirmado = confirm(
    `Total de la remisión: ${fmtCOP(total)} · ${itemsActuales.length} línea(s)\n\n` +
    `Aceptar = guardar la remisión · Cancelar = seguir modificando`
  );
  if(!confirmado) return;

  const btn = document.getElementById('rem-guardar');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try{
    const camposRemision = {
      cliente: clienteTexto,
      nit: document.getElementById('rem-nit').value.trim() || null,
      telefono: document.getElementById('rem-telefono').value.trim() || null,
      direccion: document.getElementById('rem-direccion').value.trim() || null,
      observaciones: document.getElementById('rem-observaciones').value.trim() || null,
      fecha: document.getElementById('rem-fecha').value || fechaHoyLocal(),
      total,
      actualizado_en: new Date().toISOString()
    };

    let remisionId, remisionGuardada;
    if(remisionEditandoId != null){
      remisionId = remisionEditandoId;
      if(numeroManual != null) camposRemision.numero = numeroManual;
      const { data, error } = await sb.from('remisiones').update(camposRemision).eq('id', remisionId).select();
      if(error) throw error;
      remisionGuardada = data[0];
      const { error: errDelIt } = await sb.from('remision_items').delete().eq('remision_id', remisionId);
      if(errDelIt) throw errDelIt;
      const { error: errDelOrd } = await sb.from('remision_ordenes').delete().eq('remision_id', remisionId);
      if(errDelOrd) throw errDelOrd;
    } else {
      const user = getCurrentUser();
      if(esNumeroManual){
        camposRemision.numero = numeroManual;
      } else {
        const { data: numeroData, error: errNumero } = await sb.rpc('siguiente_consecutivo', { p_tipo: 'remision' });
        if(errNumero) throw errNumero;
        camposRemision.numero = numeroData;
      }
      camposRemision.creado_por = user ? user.nombre : null;
      const { data, error } = await sb.from('remisiones').insert([camposRemision]).select();
      if(error) throw error;
      remisionGuardada = data[0];
      remisionId = remisionGuardada.id;
    }

    const payloadItems = itemsActuales.map(it => ({
      remision_id: remisionId, orden: it.orden || null, descripcion: it.descripcion || null,
      cantidad: it.cantidad || null, unidad: it.unidad || null,
      valor_unitario: it.valor_unitario || 0, valor_total: it.valor_total || 0
    }));
    const { data: itemsGuardados, error: errItems } = await sb.from('remision_items').insert(payloadItems).select();
    if(errItems) throw errItems;

    const payloadOrdenes = [...ordenesSeleccionadas].map(orden => ({ remision_id: remisionId, orden }));
    let ordenesGuardadas = [];
    if(payloadOrdenes.length){
      const { data, error: errOrd } = await sb.from('remision_ordenes').insert(payloadOrdenes).select();
      if(errOrd) throw errOrd;
      ordenesGuardadas = data;
    }

    // sincroniza el caché en memoria
    if(remisionEditandoId != null){
      const idx = DB.remisiones.findIndex(r => r.id === remisionId);
      if(idx >= 0) DB.remisiones[idx] = remisionGuardada;
      DB.remision_items = DB.remision_items.filter(it => it.remision_id !== remisionId);
      DB.remision_ordenes = DB.remision_ordenes.filter(o => o.remision_id !== remisionId);
    } else {
      DB.remisiones.unshift(remisionGuardada);
      // El consecutivo automático solo avanza si el número vino del RPC —
      // si se escribió a mano, ese "hueco" del consecutivo se deja intacto
      // para que se siga sugiriendo hasta que en verdad se use.
      if(!esNumeroManual){
        const doc = DB.consecutivos_documentos.find(d => d.tipo === 'remision');
        if(doc) doc.siguiente_numero = camposRemision.numero + 1;
      }
    }
    DB.remision_items.push(...(itemsGuardados||[]));
    DB.remision_ordenes.push(...(ordenesGuardadas||[]));

    toast('Remisión ' + numeroConPrefijo(remisionGuardada.numero) + (remisionEditandoId!=null ? ' actualizada' : ' guardada'));
    const numeroFinal = remisionGuardada.numero;
    const idFinal = remisionId;
    limpiarFormularioRemision();
    ocultarCrearCard();
    renderListadoRemisiones();
    renderInformeRemisiones();
    // El ingreso de estos ítems (si tienen orden asociada) ya afecta
    // Gerencial y el detalle de esa orden — refresca ambos para que no
    // haga falta recargar la página (mismo criterio que guardarFacturaVenta
    // en ventas.js).
    renderGerencial();
    renderOppRecent();

    if(confirm(`Remisión ${numeroConPrefijo(numeroFinal)} guardada. ¿Deseas imprimirla ahora?`)){
      imprimirRemision(idFinal);
    }
  }catch(err){
    console.error(err);
    if(err && err.code === '23505'){
      toast('Ya existe una remisión con ese número — escribe otro');
    } else {
      toast('Error al guardar la remisión — revisa la consola');
    }
  }finally{
    btn.disabled = false; btn.textContent = 'Revisar y guardar';
  }
}

// ---------- editar ----------
function editarRemision(id){
  const r = DB.remisiones.find(x => x.id === id);
  if(!r) return;
  remisionEditandoId = id;
  clienteActual = DB.clientes.find(c => normalizarTexto(c.nombre) === normalizarTexto(r.cliente)) || null;
  document.getElementById('rem-cliente-input').value = r.cliente || '';
  document.getElementById('rem-nit').value = r.nit || '';
  document.getElementById('rem-telefono').value = r.telefono || '';
  document.getElementById('rem-direccion').value = r.direccion || '';
  document.getElementById('rem-observaciones').value = r.observaciones || '';
  document.getElementById('rem-fecha').value = (r.fecha||'').slice(0,10) || fechaHoyLocal();
  document.getElementById('rem-numero').value = r.numero;

  ordenesSeleccionadas = new Set(DB.remision_ordenes.filter(o => o.remision_id === id).map(o => o.orden));
  itemsActuales = DB.remision_items.filter(it => it.remision_id === id)
    .map(it => ({ orden: it.orden, descripcion: it.descripcion, cantidad: it.cantidad, unidad: it.unidad, valor_unitario: it.valor_unitario, valor_total: it.valor_total }));

  renderOrdenesDelCliente(r.cliente);
  renderTablaItemsRemision();
  actualizarTotalRemision();

  document.getElementById('rem-guardar').textContent = 'Guardar cambios';
  const aviso = document.getElementById('rem-editando-aviso');
  aviso.style.display = '';
  aviso.textContent = `Editando la remisión ${numeroConPrefijo(r.numero)} (${r.cliente || ''}) — el número también se puede corregir. "Cancelar" cierra sin guardar cambios.`;
  mostrarCrearCard();
  document.getElementById('rem-crear-card').scrollIntoView({ behavior:'smooth', block:'start' });
}

// ---------- eliminar ----------
async function eliminarRemision(id){
  const r = DB.remisiones.find(x => x.id === id);
  if(!r) return;
  if(!confirm(`¿Eliminar la remisión ${numeroConPrefijo(r.numero)} (${r.cliente || 'sin cliente'})?\n\nNo se puede deshacer.`)) return;
  try{
    const { error: errIt } = await sb.from('remision_items').delete().eq('remision_id', id);
    if(errIt) throw errIt;
    const { error: errOrd } = await sb.from('remision_ordenes').delete().eq('remision_id', id);
    if(errOrd) throw errOrd;
    const { error: errDel } = await sb.from('remisiones').delete().eq('id', id);
    if(errDel) throw errDel;
    DB.remisiones = DB.remisiones.filter(x => x.id !== id);
    DB.remision_items = DB.remision_items.filter(x => x.remision_id !== id);
    DB.remision_ordenes = DB.remision_ordenes.filter(x => x.remision_id !== id);
    if(remisionEditandoId === id){ limpiarFormularioRemision(); ocultarCrearCard(); }
    renderListadoRemisiones();
    renderInformeRemisiones();
    renderGerencial();
    renderOppRecent();
    toast('Remisión eliminada');
  }catch(err){
    console.error(err);
    toast('Error al eliminar la remisión — revisa la consola');
  }
}

// ---------- ver detalle ----------
function mostrarDetalleRemision(id){
  const r = DB.remisiones.find(x => x.id === id);
  if(!r) return;
  const items = DB.remision_items.filter(it => it.remision_id === id);
  document.getElementById('rem-detalle-titulo').textContent = 'Remisión ' + numeroConPrefijo(r.numero);
  document.getElementById('rem-detalle-cabecera').textContent = [
    r.fecha ? 'Fecha: ' + r.fecha.slice(0,10) : null,
    r.cliente ? 'Cliente: ' + r.cliente : null,
    r.nit ? 'NIT: ' + r.nit : null
  ].filter(Boolean).join(' · ');
  document.querySelector('#tbl-rem-detalle tbody').innerHTML = items.map(it => `<tr>
    <td>${it.descripcion || '—'}</td>
    <td class="num">${it.cantidad != null ? fmtNum(it.cantidad,2) + (it.unidad?' '+it.unidad:'') : '—'}</td>
    <td class="num">${fmtCOP(it.valor_unitario||0)}</td>
    <td class="num">${fmtCOP(it.valor_total||0)}</td>
  </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-faint)">Sin líneas</td></tr>';
  document.getElementById('rem-detalle-total').textContent = 'Total: ' + fmtCOP(r.total||0);
  document.getElementById('rem-detalle-modal').dataset.remisionId = id;
  document.getElementById('rem-detalle-modal').style.display = 'flex';
}

// ---------- imprimir ----------
function imprimirRemision(id){
  const r = DB.remisiones.find(x => x.id === id);
  if(!r) return;
  const items = DB.remision_items.filter(it => it.remision_id === id);
  const ordenes = DB.remision_ordenes.filter(o => o.remision_id === id).map(o => o.orden);

  const filas = items.map(it => `<tr>
    <td>${it.descripcion || ''}</td>
    <td class="num">${it.cantidad != null ? fmtNum(it.cantidad,2) : ''}${it.unidad?' '+it.unidad:''}</td>
    <td class="num">${fmtCOP(it.valor_unitario||0)}</td>
    <td class="num">${fmtCOP(it.valor_total||0)}</td>
  </tr>`).join('')
  + Array.from({length: Math.max(0, 4 - items.length)}).map(()=>'<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Remisión ${numeroConPrefijo(r.numero)} — ${r.cliente || ''}</title>
<style>
  body{ font-family: Arial, Helvetica, sans-serif; color:#111; margin:20px; }
  table{ border-collapse:collapse; width:100%; }
  td, th{ border:1px solid #333; padding:6px 8px; text-align:left; font-size:13px; }
  .cab td{ font-weight:700; background:#3B4252; color:#fff; width:22%; }
  .titulo{ text-align:center; font-size:22px; font-weight:700; }
  .remnum{ text-align:right; }
  .remnum .lbl{ font-size:11px; color:#fff; }
  .remnum .num{ color:#B3261E; font-size:20px; font-weight:700; }
  .items th{ background:#3B4252; color:#fff; }
  .items td.num, .items th.num{ text-align:right; }
  .firma th{ background:#3B4252; color:#fff; text-align:center; }
  .firma td{ height:40px; vertical-align:bottom; }
  .footer-obs-print{ display:none; }
  @media print{
    body{ margin:10mm; margin-bottom:20mm; }
    .footer-obs-print{ display:block; position:fixed; left:0; right:0; bottom:0; font-size:11px; color:#333; border-top:1px solid #999; padding-top:4px; background:#fff; }
  }
</style>
</head><body>
  <table>
    <tr>
      <td class="cab">NOMBRE</td>
      <td class="titulo" colspan="2">${r.cliente || ''}</td>
      <td class="cab remnum"><div class="lbl">REMISIÓN No.</div><div class="num">${numeroConPrefijo(r.numero)}</div></td>
    </tr>
    <tr><td class="cab">PEDIDO No.</td><td colspan="2">${ordenes.join(', ') || '—'}</td><td>${(r.fecha||'').slice(0,10)}</td></tr>
    <tr><td class="cab">TELÉFONO</td><td colspan="3">${r.telefono || ''}</td></tr>
    <tr><td class="cab">DIRECCIÓN</td><td colspan="3">${r.direccion || ''}</td></tr>
  </table>
  <table class="items" style="margin-top:-1px">
    <thead><tr><th style="width:46%">DESCRIPCIÓN</th><th class="num">CANTIDAD</th><th class="num">VALOR UNITARIO</th><th class="num">VALOR TOTAL</th></tr></thead>
    <tbody>${filas}</tbody>
    <tr><td colspan="3" style="text-align:right;font-weight:700">TOTAL</td><td class="num" style="font-weight:700">${fmtCOP(r.total||0)}</td></tr>
  </table>
  <table class="firma" style="margin-top:-1px">
    <thead><tr><th colspan="2">NOMBRE Y SELLO DEL QUE RECIBE</th><th>OBSERVACIONES</th></tr></thead>
    <tbody>
      <tr><td colspan="2" rowspan="2"></td><td rowspan="2">${r.observaciones || ''}</td></tr>
      <tr></tr>
      <tr><td style="width:30%">NIT o C.C.</td><td>CELULAR</td><td></td></tr>
    </tbody>
  </table>
</body></html>`;

  const w = window.open('', '_blank');
  if(!w){ toast('El navegador bloqueó la ventana de impresión — permite ventanas emergentes para este sitio'); return; }
  w.document.write(html);
  w.document.close();
  agregarBotonExcelVentana(w, w.document.title);
  w.focus();
  setTimeout(() => w.print(), 300);
}

// ---------- listado ----------
export function renderListadoRemisiones(){
  const tbody = document.querySelector('#tbl-rem-listado tbody');
  if(!tbody) return;

  const fCliente = normalizarTexto(document.getElementById('rem-f-cliente')?.value || '');
  const fNumero = (document.getElementById('rem-f-numero')?.value || '').trim().replace(/^rm\s*/i, '');
  const fOrden = document.getElementById('rem-f-orden')?.value ? parseInt(document.getElementById('rem-f-orden').value,10) : null;
  const fDesde = document.getElementById('rem-f-desde')?.value || '';
  const fHasta = document.getElementById('rem-f-hasta')?.value || '';

  const ordenesPorRemision = {};
  DB.remision_ordenes.forEach(o => { (ordenesPorRemision[o.remision_id] = ordenesPorRemision[o.remision_id] || []).push(o.orden); });

  let filas = DB.remisiones.slice().sort((a,b) => (b.numero||0) - (a.numero||0));
  if(fCliente) filas = filas.filter(r => normalizarTexto(r.cliente).includes(fCliente));
  if(fNumero) filas = filas.filter(r => String(r.numero).includes(fNumero));
  if(fOrden != null && !isNaN(fOrden)) filas = filas.filter(r => (ordenesPorRemision[r.id]||[]).includes(fOrden));
  if(fDesde) filas = filas.filter(r => (r.fecha||'') >= fDesde);
  if(fHasta) filas = filas.filter(r => (r.fecha||'') <= fHasta);

  tbody.innerHTML = filas.slice(0, 200).map(r => `<tr data-id="${r.id}">
    <td>${numeroConPrefijo(r.numero)}</td>
    <td>${(r.fecha||'').slice(0,10) || '—'}</td>
    <td>${r.cliente || '—'}</td>
    <td class="num">${fmtCOP(r.total||0)}</td>
    <td>${(ordenesPorRemision[r.id]||[]).join(', ') || '—'}</td>
    <td><div class="row-actions">
      <button type="button" class="row-btn" data-ver-rem="${r.id}">Ver</button>
      <button type="button" class="row-btn" data-edit-rem="${r.id}">Editar</button>
      <button type="button" class="row-btn row-btn-danger" data-del-rem="${r.id}">Eliminar</button>
    </div></td>
  </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Sin remisiones registradas todavía</td></tr>';

  tbody.querySelectorAll('[data-ver-rem]').forEach(b => b.addEventListener('click', () => mostrarDetalleRemision(parseInt(b.dataset.verRem,10))));
  tbody.querySelectorAll('[data-edit-rem]').forEach(b => b.addEventListener('click', () => editarRemision(parseInt(b.dataset.editRem,10))));
  tbody.querySelectorAll('[data-del-rem]').forEach(b => b.addEventListener('click', () => eliminarRemision(parseInt(b.dataset.delRem,10))));
}

// ---------- informe (por rango, agrupado por cliente) ----------
let ultimoInformeRemisiones = null;

export function renderInformeRemisiones(){
  const kpisEl = document.getElementById('rem-inf-kpis');
  if(!kpisEl) return;
  const desde = document.getElementById('rem-inf-desde').value || '2024-01-01';
  const hasta = document.getElementById('rem-inf-hasta').value || fechaHoyLocal();
  const filas = DB.remisiones.filter(r => (r.fecha||'') >= desde && (r.fecha||'') <= hasta);
  const total = filas.reduce((s,r)=>s+(r.total||0),0);

  kpisEl.innerHTML = `
    <div class="kpi"><div class="lbl">Remisiones</div><div class="val">${filas.length}</div><div class="sub">${desde} a ${hasta}</div></div>
    <div class="kpi"><div class="lbl">Total despachado</div><div class="val">${fmtCOP(total)}</div></div>`;

  const porCliente = {};
  filas.forEach(r => {
    const cliente = r.cliente || 'Sin cliente';
    porCliente[cliente] = porCliente[cliente] || { cliente, n:0, total:0 };
    porCliente[cliente].n++;
    porCliente[cliente].total += (r.total||0);
  });
  const filasCliente = Object.values(porCliente).sort((a,b) => b.total - a.total);

  document.querySelector('#tbl-rem-inf-cliente tbody').innerHTML = filasCliente.map(f => `<tr>
    <td>${f.cliente}</td><td class="num">${f.n}</td><td class="num">${fmtCOP(f.total)}</td>
  </tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--ink-faint)">Sin remisiones en este rango</td></tr>';

  ultimoInformeRemisiones = { desde, hasta, n: filas.length, total, filasCliente };
}

function imprimirInformeRemisiones(){
  if(!ultimoInformeRemisiones) return;
  const k = ultimoInformeRemisiones;
  imprimirInforme({
    titulo: 'Informe de remisiones',
    subtitulo: `${k.desde} a ${k.hasta} · ${k.n} remisión(es) · Total despachado ${fmtCOP(k.total)}`,
    secciones: [{
      titulo: 'Por cliente',
      columnas: [{ key:'cliente', label:'Cliente' }, { key:'n', label:'Remisiones', num:true }, { key:'total', label:'Total', num:true }],
      filas: k.filasCliente.map(f => ({ cliente:f.cliente, n:f.n, total:fmtCOP(f.total) }))
    }]
  });
}

function exportarInformeRemisiones(){
  if(!ultimoInformeRemisiones) return;
  const k = ultimoInformeRemisiones;
  exportarExcel(`LitoColor_remisiones_${k.desde}_a_${k.hasta}.xlsx`, [{
    nombre: 'Por cliente',
    filas: k.filasCliente.map(f => ({ Cliente: f.cliente, Remisiones: f.n, Total: f.total }))
  }]);
}

// ---------- init ----------
export function initRemisiones(){
  const clienteInput = document.getElementById('rem-cliente-input');
  if(!clienteInput) return; // esta pestaña no existe para este rol/página

  clienteInput.addEventListener('input', () => {
    clienteActual = null;
    renderDropdownClientes(clienteInput.value);
  });
  clienteInput.addEventListener('focus', () => renderDropdownClientes(clienteInput.value));
  document.getElementById('rem-mostrar-remitidas').addEventListener('change', () => renderOrdenesDelCliente(clienteInput.value));
  clienteInput.addEventListener('blur', () => setTimeout(ocultarDropdownClientes, 150));
  clienteInput.addEventListener('change', () => {
    // si escribió un nombre que sí calza con un cliente del maestro (aunque
    // no lo haya elegido del desplegable), igual se cargan sus órdenes
    if(!clienteActual){
      const texto = normalizarTexto(clienteInput.value);
      const match = DB.clientes.find(c => normalizarTexto(c.nombre) === texto);
      if(match) seleccionarCliente(match);
      else renderOrdenesDelCliente(clienteInput.value);
    }
  });

  document.getElementById('rem-abrir-crear').addEventListener('click', () => {
    mostrarCrearCard();
    document.getElementById('rem-crear-card').scrollIntoView({ behavior:'smooth', block:'start' });
    clienteInput.focus();
  });
  document.getElementById('rem-add-item').addEventListener('click', () => {
    itemsActuales.push({ orden:null, descripcion:'', cantidad:0, unidad:'', valor_unitario:0, valor_total:0 });
    renderTablaItemsRemision();
    actualizarTotalRemision();
  });
  document.getElementById('rem-guardar').addEventListener('click', guardarRemision);
  document.getElementById('rem-limpiar').addEventListener('click', () => {
    if(itemsActuales.length && !confirm('¿Cerrar sin guardar? Se perderá lo que no hayas guardado.')) return;
    limpiarFormularioRemision();
    ocultarCrearCard();
  });

  document.getElementById('rem-f-buscar').addEventListener('click', renderListadoRemisiones);
  document.getElementById('rem-f-limpiar').addEventListener('click', () => {
    ['rem-f-cliente','rem-f-numero','rem-f-orden','rem-f-desde','rem-f-hasta'].forEach(id => document.getElementById(id).value = '');
    renderListadoRemisiones();
  });

  document.getElementById('rem-detalle-cerrar').addEventListener('click', () => {
    document.getElementById('rem-detalle-modal').style.display = 'none';
  });
  document.getElementById('rem-detalle-imprimir').addEventListener('click', () => {
    const id = parseInt(document.getElementById('rem-detalle-modal').dataset.remisionId, 10);
    if(id) imprimirRemision(id);
  });

  document.getElementById('rem-inf-desde').addEventListener('change', renderInformeRemisiones);
  document.getElementById('rem-inf-hasta').addEventListener('change', renderInformeRemisiones);
  document.getElementById('rem-inf-imprimir').addEventListener('click', imprimirInformeRemisiones);
  document.getElementById('rem-inf-exportar').addEventListener('click', exportarInformeRemisiones);

  document.getElementById('rem-fecha').value = fechaHoyLocal();
  actualizarNumeroPreview();
  renderTablaItemsRemision();
  actualizarTotalRemision();
  renderListadoRemisiones();
  renderInformeRemisiones();
}
