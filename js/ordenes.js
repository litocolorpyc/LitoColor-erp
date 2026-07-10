import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast, fmtNum, exportarExcel } from './helpers.js';

let oppPiezaCount = 0;
let editingOrden = null; // si no es null, Guardar actualiza esa orden en vez de crear una nueva

// ---------- cálculo de imposición (geometría pura, sugerida y editable) ----------
function calcPorPliego(pliegoW, pliegoH, piezaW, piezaH){
  if(!pliegoW || !pliegoH || !piezaW || !piezaH) return 0;
  const a = Math.floor(pliegoW / piezaW) * Math.floor(pliegoH / piezaH);
  const b = Math.floor(pliegoW / piezaH) * Math.floor(pliegoH / piezaW);
  return Math.max(a, b);
}

const HINT_TIPO_TRABAJO = {
  'Litografia': '',
  'Impresión Digital': 'Ficha simplificada: no requiere pliego ni imposición.',
  'Gran Formato': 'Ficha simplificada: banners, pendones, vinilos, etc.',
  'Servicio de Impresión Externo': 'Ficha simplificada: trabajo que se subcontrata con un proveedor.',
  'Trabajo Externo': 'Ficha simplificada: cualquier trabajo que no es de planta propia.'
};

function aplicarTipoTrabajo(){
  const tipoSel = document.getElementById('opp-tipo-trabajo');
  const piezasList = document.getElementById('opp-piezas-list');
  if(!tipoSel || !piezasList) return;
  const tipo = tipoSel.value;
  const esLitografia = tipo === 'Litografia';
  piezasList.classList.toggle('tipo-otros', !esLitografia);
  const hint = document.getElementById('opp-tipo-trabajo-hint');
  if(hint) hint.textContent = HINT_TIPO_TRABAJO[tipo] || '';
}

export function refreshPapelPliegoSelects(){
  document.querySelectorAll('#opp-piezas-list .opp-pieza-card').forEach(node => {
    populatePapelSelect(node);
    populatePliegoSelect(node);
  });
}

// Tamaños de pliego que maneja la planta. 70x100 es el más usado, por eso
// queda seleccionado por defecto en cada pieza nueva.
const PLIEGOS_PERMITIDOS = ['70x100', '60x90'];

function populatePapelSelect(node){
  const sel = node.querySelector('.f-papel');
  const valorPrevio = sel.value;
  sel.innerHTML = '<option value="">Selecciona un papel…</option>' +
    DB.materias_primas.filter(m=>m.activo!==false).map(m =>
      `<option value="${m.nombre}" data-pliego="${m.pliego_ancho && m.pliego_alto ? m.pliego_ancho+'x'+m.pliego_alto : ''}">${m.nombre}</option>`
    ).join('');
  if(valorPrevio) ensureOptionExists(sel, valorPrevio);
}

function populatePliegoSelect(node){
  const sel = node.querySelector('.f-pliego');
  const valorPrevio = sel.value;
  sel.innerHTML = PLIEGOS_PERMITIDOS.map(p => `<option value="${p}">${p.replace('x',' x ')} cm</option>`).join('');
  // si ya tenía un valor válido lo respeta; si no, cae en 70x100 (el más usado)
  sel.value = (valorPrevio && PLIEGOS_PERMITIDOS.includes(valorPrevio)) ? valorPrevio : '70x100';
}

function addPiezaCard(prefill){
  oppPiezaCount++;
  const tpl = document.getElementById('opp-pieza-template');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.index = oppPiezaCount;
  node.querySelector('.opp-pieza-num').textContent = oppPiezaCount;

  node.querySelector('.opp-remove-pieza').addEventListener('click', () => {
    node.remove();
    updateOppPreview();
  });

  const recalc = () => recalcPieza(node);
  node.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input', recalc);
    el.addEventListener('change', recalc);
  });
  node.querySelectorAll('.f-proc').forEach(cb => {
    cb.addEventListener('change', () => { cb.dataset.touched = '1'; });
  });

  document.getElementById('opp-piezas-list').appendChild(node);
  populatePapelSelect(node);
  populatePliegoSelect(node);

  // al elegir un papel, el pliego se ajusta solo según lo que tenga
  // guardado ese papel en el maestro de Materias primas (editable después)
  node.querySelector('.f-papel').addEventListener('change', () => {
    const opt = node.querySelector('.f-papel').selectedOptions[0];
    const pliego = opt && opt.dataset.pliego;
    if(pliego && PLIEGOS_PERMITIDOS.includes(pliego)){
      node.querySelector('.f-pliego').value = pliego;
    }
    recalcPieza(node);
  });

  if(prefill) fillPiezaCard(node, prefill);
  recalcPieza(node);
  updateOppPreview();
  return node;
}

function fillPiezaCard(node, p){
  node.querySelector('.f-pieza').value = p.pieza || '';
  node.querySelector('.f-cantidad').value = p.cantidad ?? '';
  node.querySelector('.f-tam-ancho').value = p.tamano_ancho ?? '';
  node.querySelector('.f-tam-alto').value = p.tamano_alto ?? '';
  ensureOptionExists(node.querySelector('.f-papel'), p.papel || '');
  if(p.pliego_ancho && p.pliego_alto){
    const pliegoGuardado = p.pliego_ancho + 'x' + p.pliego_alto;
    node.querySelector('.f-pliego').value = PLIEGOS_PERMITIDOS.includes(pliegoGuardado) ? pliegoGuardado : '70x100';
  }
  node.querySelector('.f-tintas-frente').value = p.tintas_frente ?? 4;
  node.querySelector('.f-tintas-atras').value = p.tintas_atras ?? 0;
  node.querySelector('.f-ctp').value = p.ctp || 'Convencional';
  node.querySelector('.f-tira').value = p.tira_retira || 'Tira y retira';
  node.querySelector('.f-laminado').value = p.laminado || '';
  node.querySelector('.f-laminado-lados').value = p.laminado_lados || 0;
  node.querySelector('.f-barniz').checked = !!p.barniz_uv;
  node.querySelector('.f-troquelado').checked = !!p.troquelado;
  node.querySelector('.f-troquel-detalle').value = p.troquel_detalle || '';
  node.querySelector('.f-talonarios').checked = !!p.talonarios;
  node.querySelector('.f-otros').value = p.otros_acabados || '';
  const otrosSimple = node.querySelector('.f-otros-simple');
  if(otrosSimple) otrosSimple.value = p.otros_acabados || '';
  const prov = node.querySelector('.f-proveedor'); if(prov) prov.value = p.proveedor || '';
  const costoExt = node.querySelector('.f-costo-externo'); if(costoExt) costoExt.value = p.costo_externo ?? '';
  const fechaEnt = node.querySelector('.f-fecha-entrega'); if(fechaEnt) fechaEnt.value = (p.fecha_entrega_estimada || '').slice(0,10);
  node.querySelector('.f-unidades-montaje').value = p.unidades_por_montaje || 1;
  const ma = node.querySelector('.f-medida-ancho'), mal = node.querySelector('.f-medida-alto');
  ma.value = p.medida_tamano_ancho ?? ''; ma.dataset.touched = '1';
  mal.value = p.medida_tamano_alto ?? ''; mal.dataset.touched = '1';
  const pp = node.querySelector('.f-tam-por-pliego'); pp.value = p.tamanos_por_pliego ?? ''; pp.dataset.touched = '1';
  const tp = node.querySelector('.f-tam-programados'); tp.value = p.tamanos_programados ?? ''; tp.dataset.touched = '1';
  const requeridos = Array.isArray(p.procesos_requeridos) ? p.procesos_requeridos : [];
  node.querySelectorAll('.f-proc').forEach(cb => {
    cb.checked = requeridos.includes(cb.value);
    cb.dataset.touched = '1';
  });
}

function recalcPieza(node){
  const cantidad = parseFloat(node.querySelector('.f-cantidad').value) || 0;
  const unidadesMontaje = parseFloat(node.querySelector('.f-unidades-montaje').value) || 1;
  const tamAncho = parseFloat(node.querySelector('.f-tam-ancho').value) || 0;
  const tamAlto = parseFloat(node.querySelector('.f-tam-alto').value) || 0;
  const pliego = node.querySelector('.f-pliego').value.split('x').map(Number);
  const medidaAnchoEl = node.querySelector('.f-medida-ancho');
  const medidaAltoEl = node.querySelector('.f-medida-alto');

  if(!medidaAnchoEl.dataset.touched && tamAncho) medidaAnchoEl.value = (tamAncho + 5).toFixed(1);
  if(!medidaAltoEl.dataset.touched && tamAlto) medidaAltoEl.value = (tamAlto + 5).toFixed(1);
  medidaAnchoEl.oninput = () => medidaAnchoEl.dataset.touched = '1';
  medidaAltoEl.oninput = () => medidaAltoEl.dataset.touched = '1';

  const medidaAncho = parseFloat(medidaAnchoEl.value) || 0;
  const medidaAlto = parseFloat(medidaAltoEl.value) || 0;

  const tamSolicitados = unidadesMontaje > 0 ? Math.ceil(cantidad / unidadesMontaje) : cantidad;
  node.querySelector('.f-tam-solicitados').value = tamSolicitados || 0;

  const porPliegoEl = node.querySelector('.f-tam-por-pliego');
  if(!porPliegoEl.dataset.touched) porPliegoEl.value = calcPorPliego(pliego[0], pliego[1], medidaAncho, medidaAlto) || '';
  porPliegoEl.oninput = () => porPliegoEl.dataset.touched = '1';

  const programadosEl = node.querySelector('.f-tam-programados');
  if(!programadosEl.dataset.touched) programadosEl.value = tamSolicitados ? Math.round(tamSolicitados * 1.10) : '';
  programadosEl.oninput = () => programadosEl.dataset.touched = '1';

  const porPliego = parseFloat(porPliegoEl.value) || 0;
  const programados = parseFloat(programadosEl.value) || 0;
  const pliegos = porPliego > 0 ? Math.ceil(programados / porPliego) : 0;
  node.querySelector('.f-pliegos-result').textContent = pliegos ? fmtNum(pliegos, 0) : '—';

  const procTroquelado = node.querySelector('.f-proc[value="Troquelado"]');
  const procPlastificado = node.querySelector('.f-proc[value="Plastificado"]');
  const procEngomadora = node.querySelector('.f-proc[value="Engomadora"]');
  const troquelado = node.querySelector('.f-troquelado').checked;
  const laminado = node.querySelector('.f-laminado').value;
  const otros = (node.querySelector('.f-otros').value || '').toLowerCase();
  const usaEngomadora = /engom|argoll|encaratul|pegar|colbon/.test(otros) || node.querySelector('.f-talonarios').checked;
  if(!procTroquelado.dataset.touched) procTroquelado.checked = troquelado;
  if(!procPlastificado.dataset.touched) procPlastificado.checked = !!laminado;
  if(!procEngomadora.dataset.touched) procEngomadora.checked = usaEngomadora;
}

function updateOppPreview(){
  const n = document.querySelectorAll('#opp-piezas-list .opp-pieza-card').length;
  document.getElementById('opp-preview').textContent = n + (n === 1 ? ' pieza agregada' : ' piezas agregadas');
}

function suggestNextOrden(){
  const all = [
    ...DB.pedidos.map(p => p.orden),
    ...DB.opp_ordenes.map(o => o.orden)
  ].filter(n => typeof n === 'number');
  const max = all.length ? Math.max(...all) : 5938;
  return max + 1;
}

// ---------- selectores de Cliente / Producto con creación rápida ----------
function ensureOptionExists(select, value){
  if(!value) return;
  const existe = Array.from(select.options).some(o => o.value === value);
  if(!existe){
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = value + ' (no está en el maestro)';
    select.insertBefore(opt, select.lastElementChild); // antes de "+ Nuevo…"
  }
  select.value = value;
}

export function populateClienteSelect(){
  const sel = document.getElementById('opp-cliente');
  const valorPrevio = sel.value;
  sel.innerHTML = '<option value="">Selecciona un cliente…</option>' +
    DB.clientes.filter(c=>c.activo!==false).map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('') +
    '<option value="__nuevo__">+ Nuevo cliente…</option>';
  if(valorPrevio) ensureOptionExists(sel, valorPrevio === '__nuevo__' ? '' : valorPrevio);
}

export function populateProductoSelect(){
  const sel = document.getElementById('opp-producto');
  const valorPrevio = sel.value;
  sel.innerHTML = '<option value="">Selecciona un producto…</option>' +
    DB.productos.filter(p=>p.activo!==false).map(p => `<option value="${p.nombre}">${p.nombre}</option>`).join('') +
    '<option value="__nuevo__">+ Nuevo producto…</option>';
  if(valorPrevio) ensureOptionExists(sel, valorPrevio === '__nuevo__' ? '' : valorPrevio);
}

const cacheCombinaciones = new Map(); // producto -> filas (para no repetir la consulta)

async function renderProductoRef(){
  const nombre = document.getElementById('opp-producto').value;
  const cont = document.getElementById('opp-producto-ref');
  if(!nombre || nombre === '__nuevo__'){ cont.style.display = 'none'; return; }

  cont.style.display = '';
  cont.innerHTML = '<div class="producto-ref-box">Consultando combinaciones…</div>';

  let combos = cacheCombinaciones.get(nombre);
  if(!combos){
    const { data, error } = await sb.from('productos_combinaciones').select('*').eq('producto', nombre);
    if(error){ console.error(error); cont.style.display = 'none'; return; }
    combos = data || [];
    cacheCombinaciones.set(nombre, combos);
  }

  if(!combos.length){ cont.style.display = 'none'; return; }
  const tamanos = [...new Set(combos.map(c=>c.tamano).filter(Boolean))];
  const papeles = [...new Set(combos.map(c=>c.papel).filter(Boolean))];
  const acabados = [...new Set(combos.map(c=>c.acabados).filter(Boolean))];
  cont.innerHTML = `<div class="producto-ref-box">
    <div class="producto-ref-title">Combinaciones de referencia para "${nombre}" (${combos.length})</div>
    <div class="producto-ref-row"><b>Tamaños:</b> ${tamanos.join(', ')}</div>
    <div class="producto-ref-row"><b>Papeles:</b> ${papeles.join(', ')}</div>
    <div class="producto-ref-row"><b>Acabados posibles:</b> ${acabados.slice(0,12).join(', ')}${acabados.length>12?'…':''}</div>
  </div>`;
}

function wireNuevoInline(selectId, wrapId, inputId, btnId, table, onCreated){
  const sel = document.getElementById(selectId);
  const wrap = document.getElementById(wrapId);
  sel.addEventListener('change', () => {
    wrap.style.display = sel.value === '__nuevo__' ? 'flex' : 'none';
    if(sel.value === '__nuevo__') document.getElementById(inputId).focus();
  });
  document.getElementById(btnId).addEventListener('click', async () => {
    const nombre = document.getElementById(inputId).value.trim();
    if(!nombre){ toast('Escribe un nombre'); return; }
    const { data, error } = await sb.from(table).insert([{ nombre }]).select();
    if(error){ console.error(error); toast('Error al crear — revisa la consola'); return; }
    onCreated(data[0]);
    document.getElementById(inputId).value = '';
    wrap.style.display = 'none';
    sel.value = nombre;
    if(table === 'productos') renderProductoRef();
    toast('Creado: ' + nombre);
  });
}

// ---------- estado / avance de una orden ----------
export function areasCompletadasPorPieza(pieza){
  const recs = DB.produccion.filter(r => r.op === pieza.op || (r.orden === pieza.orden && r.suborden === pieza.suborden));
  return new Set(recs.map(r => r.area).filter(Boolean));
}

export function estadoOrden(o){
  if(o.estado === 'Cancelada') return { label: 'Cancelada', pct: null };
  if(o.estado === 'Cerrada') return { label: 'Cerrada', pct: 100 };
  const piezas = DB.opp_piezas.filter(p => p.orden === o.orden);
  if(!piezas.length) return { label: 'Pendiente', pct: 0 };
  let totalReq = 0, totalDone = 0, algunoEmpezado = false;
  piezas.forEach(p => {
    const req = Array.isArray(p.procesos_requeridos) ? p.procesos_requeridos : [];
    const done = areasCompletadasPorPieza(p);
    totalReq += req.length;
    const doneCount = req.filter(a => done.has(a)).length;
    totalDone += doneCount;
    if(doneCount > 0) algunoEmpezado = true;
  });
  if(totalReq === 0) return { label: 'Pendiente', pct: 0 };
  const pct = Math.round((totalDone / totalReq) * 100);
  if(pct >= 100) return { label: 'Completada', pct: 100 };
  if(algunoEmpezado) return { label: 'En proceso', pct };
  return { label: 'Pendiente', pct: 0 };
}

function estadoBadgeHTML(estado){
  const cls = { 'Completada':'done', 'Cerrada':'done', 'En proceso':'estado-chip-warn', 'Pendiente':'pending', 'Cancelada':'pending' }[estado.label] || 'pending';
  const pct = estado.pct != null ? ` (${estado.pct}%)` : '';
  return `<span class="estado-chip ${cls}">${estado.label}${pct}</span>`;
}

// Para el selector del operario: solo órdenes que siguen abiertas para trabajar.
export function getOrdenesSeleccionables(){
  return DB.opp_ordenes
    .filter(o => o.estado !== 'Cerrada' && o.estado !== 'Cancelada')
    .sort((a,b) => b.orden - a.orden);
}

// ---------- costo acumulado de una orden ----------
function costoAcumulado(orden){
  return DB.produccion.filter(r => r.orden === orden).reduce((s,r)=>s+(r.valorActividad||0),0);
}

// ---------- render: tablas y tableros ----------
export function renderOppRecent(){
  renderOppLista(DB.opp_ordenes.slice(0, 20));
  renderEstadoOrdenes();
  renderOrdenesVivas();
  renderRadarHistorico();
}

function tipoTrabajoLabel(o){
  return o.tipo_trabajo === 'Litografia' ? 'Litografía' : (o.tipo_trabajo || 'Litografía');
}

function renderOppLista(rows){
  const conteo = {};
  DB.opp_piezas.forEach(p => { conteo[p.orden] = (conteo[p.orden] || 0) + 1; });
  document.querySelector('#tbl-opp-recent tbody').innerHTML = rows.map(o => {
    const estado = estadoOrden(o);
    const costo = costoAcumulado(o.orden);
    return `<tr>
      <td>${o.orden}</td><td>${o.cliente || '—'}</td>
      <td><span class="tipo-trabajo-chip">${tipoTrabajoLabel(o)}</span></td>
      <td>${o.producto || '—'}</td>
      <td class="num">${conteo[o.orden] || 0}</td><td>${(o.fecha || '').slice(0,10)}</td>
      <td>${estadoBadgeHTML(estado)}</td><td class="num">${fmtCOPlocal(costo)}</td>
      <td><div class="row-actions">
        <button type="button" class="row-btn" data-detalle="${o.orden}">Ver detalle</button>
        <button type="button" class="row-btn" data-edit="${o.orden}">Editar</button>
        <button type="button" class="row-btn" data-dup="${o.orden}">Duplicar</button>
        ${o.estado!=='Cancelada' ? `<button type="button" class="row-btn row-btn-danger" data-cancel="${o.orden}">Cancelar</button>` : ''}
      </div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--ink-faint)">Sin órdenes registradas</td></tr>';

  document.querySelectorAll('#tbl-opp-recent [data-detalle]').forEach(b => b.addEventListener('click', () => mostrarDetalleOrden(parseInt(b.dataset.detalle,10))));
  document.querySelectorAll('#tbl-opp-recent [data-edit]').forEach(b => b.addEventListener('click', () => loadOrdenParaEditar(parseInt(b.dataset.edit,10))));
  document.querySelectorAll('#tbl-opp-recent [data-dup]').forEach(b => b.addEventListener('click', () => duplicarOrden(parseInt(b.dataset.dup,10))));
  document.querySelectorAll('#tbl-opp-recent [data-cancel]').forEach(b => b.addEventListener('click', () => cancelarOrden(parseInt(b.dataset.cancel,10))));
}
function fmtCOPlocal(n){ if(n==null||isNaN(n)) return '—'; return '$' + Math.round(n).toLocaleString('es-CO'); }

// par etiqueta/valor para la ficha técnica del detalle de orden — se omite si no hay valor
function filaFicha(label, value){
  if(value === null || value === undefined || value === '' || value === false) return '';
  return `<div class="ficha-item"><span class="ficha-lbl">${label}</span><span class="ficha-val">${value}</span></div>`;
}

export function renderOrdenesVivas(){
  const tbody = document.querySelector('#tbl-ordenes-vivas tbody');
  if(!tbody) return;
  const filas = [];
  DB.opp_ordenes.forEach(o => {
    if(o.estado === 'Cancelada') return;
    const piezas = DB.opp_piezas.filter(p => p.orden === o.orden);
    piezas.forEach(p => {
      const requeridos = Array.isArray(p.procesos_requeridos) ? p.procesos_requeridos : [];
      if(!requeridos.length) return;
      const completados = areasCompletadasPorPieza(p);
      const pendientes = requeridos.filter(a => !completados.has(a));
      if(pendientes.length){
        const pct = Math.round(((requeridos.length - pendientes.length) / requeridos.length) * 100);
        filas.push({ orden: o.orden, cliente: o.cliente, producto: o.producto, pieza: p.pieza || ('Pieza ' + p.suborden), pct });
      }
    });
  });
  filas.sort((a,b) => b.orden - a.orden);
  tbody.innerHTML = filas.map(f => `<tr><td>${f.orden}</td><td>${f.cliente || '—'}</td><td>${f.producto || '—'}</td><td>${f.pieza}</td><td class="num">${f.pct}%</td></tr>`).join('')
    || '<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">No hay órdenes con procesos pendientes</td></tr>';
}

export function renderEstadoOrdenes(){
  const ordenes = DB.opp_ordenes.slice(0, 15);
  const cont = document.getElementById('opp-estado-list');
  if(!cont) return;
  if(!ordenes.length){
    cont.innerHTML = '<p style="color:var(--ink-faint);font-size:13px">Aún no hay órdenes guardadas.</p>';
    return;
  }
  cont.innerHTML = ordenes.map(o => {
    const piezas = DB.opp_piezas.filter(p => p.orden === o.orden);
    if(!piezas.length) return '';
    const filas = piezas.map(p => {
      const requeridos = Array.isArray(p.procesos_requeridos) ? p.procesos_requeridos : [];
      const completados = areasCompletadasPorPieza(p);
      const hechos = requeridos.filter(a => completados.has(a)).length;
      const pct = requeridos.length ? Math.round((hechos / requeridos.length) * 100) : 0;
      const chips = requeridos.map(a => {
        const done = completados.has(a);
        return `<span class="estado-chip ${done ? 'done' : 'pending'}">${done ? '✓' : '·'} ${a}</span>`;
      }).join('');
      return `<div class="estado-pieza-row">
        <span class="estado-pieza-nombre">${p.pieza || ('Pieza ' + p.suborden)}</span>
        <div class="estado-bar-wrap"><div class="estado-bar-fill" style="width:${pct}%"></div></div>
        ${chips}
      </div>`;
    }).join('');
    const estado = estadoOrden(o);
    return `<div class="estado-orden">
      <div class="estado-orden-head"><b>Orden ${o.orden} — ${o.cliente || ''}</b>${estadoBadgeHTML(estado)}</div>
      ${filas}
    </div>`;
  }).join('') || '<p style="color:var(--ink-faint);font-size:13px">Sin piezas asociadas todavía.</p>';
}

// ---------- radar histórico: órdenes del Excel migrado, último mes ----------
export function renderRadarHistorico(){
  const tbl = document.getElementById('tbl-radar-historico');
  if(!tbl) return;
  const hoy = new Date();
  const haceUnMes = new Date(hoy); haceUnMes.setDate(haceUnMes.getDate() - 30);
  const ordenesConOpp = new Set(DB.opp_ordenes.map(o => o.orden));

  const ultimaPorOrden = {};
  DB.produccion.forEach(r => {
    if(r.orden == null || ordenesConOpp.has(r.orden)) return; // ya tiene OPP propia, no es "histórica suelta"
    if(!r.fecha) return;
    if(!ultimaPorOrden[r.orden] || r.fecha > ultimaPorOrden[r.orden].fecha){
      ultimaPorOrden[r.orden] = { fecha: r.fecha, cliente: r.cliente, trabajo: r.trabajo };
    }
  });
  const vivas = Object.entries(ultimaPorOrden)
    .filter(([orden, info]) => new Date(info.fecha) >= haceUnMes)
    .sort((a,b) => b[1].fecha.localeCompare(a[1].fecha));

  document.querySelector('#tbl-radar-historico tbody').innerHTML = vivas.map(([orden, info]) =>
    `<tr><td>${orden}</td><td>${info.cliente || '—'}</td><td>${info.trabajo || '—'}</td><td>${info.fecha.slice(0,10)}</td></tr>`
  ).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-faint)">Sin actividad histórica en el último mes</td></tr>';
}

let chartDetalle = null;
let ordenDetalleActual = null; // recuerda qué orden está abierta en el detalle, para el botón de imprimir

function ingresoDeOrden(orden){
  return DB.pedidos.filter(p => p.orden === orden).reduce((s,p)=>s+(p.total||0),0);
}

export function mostrarDetalleOrden(orden){
  const o = DB.opp_ordenes.find(x => x.orden === orden);
  if(!o) return;
  const piezas = DB.opp_piezas.filter(p => p.orden === orden).sort((a,b)=>a.suborden-b.suborden);
  const registros = DB.produccion.filter(r => r.orden === orden);
  const estado = estadoOrden(o);
  const ingreso = ingresoDeOrden(orden);
  const costo = registros.reduce((s,r)=>s+(r.valorActividad||0),0);

  document.getElementById('opp-detalle-titulo').textContent = `Orden ${orden} — ${o.cliente || ''} · ${tipoTrabajoLabel(o)}`;
  ordenDetalleActual = orden;

  // ---- horas por área de TODA la orden, para el gráfico ----
  const areaMap = {};
  registros.forEach(r => { const a = r.area || 'General'; areaMap[a] = (areaMap[a]||0) + (r.tiempoHr||0); });
  const areas = Object.keys(areaMap);

  const piezasHTML = piezas.map(p => {
    const recsPieza = registros.filter(r => r.op === p.op || (r.suborden === p.suborden));
    const requeridos = Array.isArray(p.procesos_requeridos) ? p.procesos_requeridos : [];
    const completados = areasCompletadasPorPieza(p);
    const chips = requeridos.map(a => `<span class="estado-chip ${completados.has(a)?'done':'pending'}">${completados.has(a)?'✓':'·'} ${a}</span>`).join('') || '<span class="card-hint">sin procesos definidos</span>';

    const materiales = [...new Set(recsPieza.map(r => [r.materiaPrima, r.consumoMP].filter(Boolean).join(' — ')).filter(Boolean))];

    const ficha = [
      filaFicha('OP', p.op),
      filaFicha('Tamaño terminado', (p.tamano_ancho || p.tamano_alto) ? `${fmtNum(p.tamano_ancho,1)} x ${fmtNum(p.tamano_alto,1)} cm` : ''),
      filaFicha('Papel', p.papel),
      filaFicha('Pliego', (p.pliego_ancho && p.pliego_alto) ? `${p.pliego_ancho} x ${p.pliego_alto} cm` : ''),
      filaFicha('Tintas frente/atrás', p.tintas_frente != null ? `${p.tintas_frente} x ${p.tintas_atras || 0}` : ''),
      filaFicha('CTP', p.ctp),
      filaFicha('Impresión', p.tira_retira),
      filaFicha('Laminado', p.laminado ? `${p.laminado}${p.laminado_lados ? ' · ' + p.laminado_lados + ' lado(s)' : ''}` : ''),
      filaFicha('Barniz UV', p.barniz_uv ? 'Sí' : ''),
      filaFicha('Troquelado', p.troquelado ? (p.troquel_detalle || 'Sí') : ''),
      filaFicha('Talonarios', p.talonarios ? 'Sí' : ''),
      filaFicha('Otros acabados', p.otros_acabados),
      filaFicha('Diagrama de corte', p.diagrama_corte),
      filaFicha('Unidades por montaje', p.unidades_por_montaje),
      filaFicha('Tamaños solicitados', p.tamanos_solicitados != null ? fmtNum(p.tamanos_solicitados,0) : ''),
      filaFicha('Tamaños programados', p.tamanos_programados != null ? fmtNum(p.tamanos_programados,0) : ''),
      filaFicha('Medida con margen', (p.medida_tamano_ancho || p.medida_tamano_alto) ? `${fmtNum(p.medida_tamano_ancho,1)} x ${fmtNum(p.medida_tamano_alto,1)} cm` : ''),
      filaFicha('Tamaños por pliego', p.tamanos_por_pliego != null ? fmtNum(p.tamanos_por_pliego,0) : ''),
      filaFicha('Pliegos necesarios', p.pliegos != null ? fmtNum(p.pliegos,0) : ''),
      filaFicha('Proveedor / quién lo realiza', p.proveedor),
      filaFicha('Costo del servicio', p.costo_externo != null ? fmtCOPlocal(p.costo_externo) : ''),
      filaFicha('Fecha de entrega estimada', p.fecha_entrega_estimada ? (p.fecha_entrega_estimada||'').slice(0,10) : ''),
      filaFicha('Notas', p.notas)
    ].join('');

    const porOperarioMaquina = {};
    recsPieza.forEach(r => {
      const k = (r.operario||'—') + ' · ' + (r.maquina || 'Manual');
      porOperarioMaquina[k] = porOperarioMaquina[k] || { horas:0, cantidad:0 };
      porOperarioMaquina[k].horas += (r.tiempoHr||0);
      porOperarioMaquina[k].cantidad += (r.cantidad||0);
    });
    const filasOM = Object.entries(porOperarioMaquina).map(([k,v]) =>
      `<tr><td>${k}</td><td class="num">${fmtNum(v.horas,2)}</td><td class="num">${fmtNum(v.cantidad,0)}</td></tr>`
    ).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--ink-faint)">Sin registros de producción aún</td></tr>';

    return `<div class="detalle-pieza-card">
      <div class="detalle-pieza-head">
        <b>${p.pieza || ('Pieza ' + p.suborden)}</b>
        <span class="card-hint">${p.cantidad ? fmtNum(p.cantidad,0)+' uds solicitadas' : ''}</span>
      </div>
      <div class="detalle-ficha-grid">${ficha}</div>
      <div class="detalle-pieza-chips">${chips}</div>
      ${materiales.length ? `<div class="detalle-pieza-materiales"><b>Materiales consumidos:</b> ${materiales.join(' · ')}</div>` : ''}
      <table class="detalle-mini-table">
        <thead><tr><th>Operario · Máquina</th><th class="num">Horas</th><th class="num">Cantidad</th></tr></thead>
        <tbody>${filasOM}</tbody>
      </table>
    </div>`;
  }).join('') || '<p class="card-hint">Esta orden no tiene piezas registradas (probablemente migrada del histórico sin detalle de OPP).</p>';

  document.getElementById('opp-detalle-body').innerHTML = `
    <div class="kpi-row" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">Estado</div><div class="val" style="font-size:16px">${o.cliente||'—'}</div><div class="sub">${o.producto||''} · ${(o.fecha||'').slice(0,10)}</div></div>
      <div class="kpi"><div class="lbl">Ingreso</div><div class="val">${fmtCOPlocal(ingreso)}</div><div class="sub">según pedidos</div></div>
      <div class="kpi"><div class="lbl">Costo mano de obra</div><div class="val">${fmtCOPlocal(costo)}</div><div class="sub">${registros.length} registros de producción</div></div>
      <div class="kpi"><div class="lbl">Margen</div><div class="val ${ingreso-costo>=0?'pos':'neg'}">${fmtCOPlocal(ingreso-costo)}</div><div class="sub">${estadoBadgeHTML(estado)}</div></div>
    </div>
    ${areas.length ? '<canvas id="chart-detalle-area" height="90" style="margin-bottom:16px"></canvas>' : ''}
    ${o.observaciones ? `<div class="detalle-orden-obs"><b>Observaciones de la orden:</b> ${o.observaciones}</div>` : ''}
    <div class="detalle-piezas-grid">${piezasHTML}</div>
  `;

  if(areas.length){
    const el = document.getElementById('chart-detalle-area');
    if(chartDetalle) chartDetalle.destroy();
    chartDetalle = new Chart(el, { type:'bar', data:{ labels: areas,
      datasets:[{ label:'Horas en esta orden', data: areas.map(a=>areaMap[a]), backgroundColor:'#185FA5' }]},
      options:{ indexAxis:'y', responsive:true, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}},y:{grid:{display:false}}} } });
  }

  document.getElementById('opp-detalle-card').style.display = '';
  document.getElementById('opp-detalle-card').scrollIntoView({ behavior:'smooth' });
}

// ---------- imprimir la orden (para cuando no hay pantalla a mano en planta) ----------
export function imprimirOrdenActual(){
  if(ordenDetalleActual == null){ toast('Primero abre el detalle de una orden'); return; }
  imprimirDetalleOrden(ordenDetalleActual);
}

export function imprimirDetalleOrden(orden){
  const o = DB.opp_ordenes.find(x => x.orden === orden);
  if(!o) return;
  const piezas = DB.opp_piezas.filter(p => p.orden === orden).sort((a,b)=>a.suborden-b.suborden);
  const registros = DB.produccion.filter(r => r.orden === orden);
  const estado = estadoOrden(o);

  const piezasHTML = piezas.map(p => {
    const recsPieza = registros.filter(r => r.op === p.op || (r.suborden === p.suborden));
    const requeridos = Array.isArray(p.procesos_requeridos) ? p.procesos_requeridos : [];
    const completados = areasCompletadasPorPieza(p);
    const procesosTxt = requeridos.map(a => `${completados.has(a) ? '✓' : '☐'} ${a}`).join('&nbsp;&nbsp;&nbsp;') || 'sin procesos definidos';
    const materiales = [...new Set(recsPieza.map(r => [r.materiaPrima, r.consumoMP].filter(Boolean).join(' — ')).filter(Boolean))];

    const porOM = {};
    recsPieza.forEach(r => {
      const k = (r.operario||'—') + ' · ' + (r.maquina || 'Manual');
      porOM[k] = porOM[k] || { horas:0, cantidad:0 };
      porOM[k].horas += (r.tiempoHr||0);
      porOM[k].cantidad += (r.cantidad||0);
    });
    const filasOM = Object.entries(porOM).map(([k,v]) =>
      `<tr><td>${k}</td><td>${fmtNum(v.horas,2)}</td><td>${fmtNum(v.cantidad,0)}</td></tr>`
    ).join('') || '<tr><td colspan="3">Sin registros de producción aún</td></tr>';

    const ficha = [
      ['OP', p.op],
      ['Tamaño terminado', (p.tamano_ancho || p.tamano_alto) ? `${fmtNum(p.tamano_ancho,1)} x ${fmtNum(p.tamano_alto,1)} cm` : ''],
      ['Papel', p.papel],
      ['Pliego', (p.pliego_ancho && p.pliego_alto) ? `${p.pliego_ancho} x ${p.pliego_alto} cm` : ''],
      ['Tintas frente/atrás', p.tintas_frente != null ? `${p.tintas_frente} x ${p.tintas_atras || 0}` : ''],
      ['CTP', p.ctp],
      ['Impresión', p.tira_retira],
      ['Laminado', p.laminado ? `${p.laminado}${p.laminado_lados ? ' · ' + p.laminado_lados + ' lado(s)' : ''}` : ''],
      ['Barniz UV', p.barniz_uv ? 'Sí' : ''],
      ['Troquelado', p.troquelado ? (p.troquel_detalle || 'Sí') : ''],
      ['Talonarios', p.talonarios ? 'Sí' : ''],
      ['Otros acabados', p.otros_acabados],
      ['Diagrama de corte', p.diagrama_corte],
      ['Unidades por montaje', p.unidades_por_montaje],
      ['Tamaños solicitados', p.tamanos_solicitados != null ? fmtNum(p.tamanos_solicitados,0) : ''],
      ['Tamaños programados', p.tamanos_programados != null ? fmtNum(p.tamanos_programados,0) : ''],
      ['Medida con margen', (p.medida_tamano_ancho || p.medida_tamano_alto) ? `${fmtNum(p.medida_tamano_ancho,1)} x ${fmtNum(p.medida_tamano_alto,1)} cm` : ''],
      ['Tamaños por pliego', p.tamanos_por_pliego != null ? fmtNum(p.tamanos_por_pliego,0) : ''],
      ['Pliegos necesarios', p.pliegos != null ? fmtNum(p.pliegos,0) : ''],
      ['Proveedor / quién lo realiza', p.proveedor],
      ['Costo del servicio', p.costo_externo != null ? fmtCOPlocal(p.costo_externo) : ''],
      ['Fecha de entrega estimada', p.fecha_entrega_estimada ? (p.fecha_entrega_estimada||'').slice(0,10) : ''],
      ['Notas', p.notas]
    ].filter(([,v]) => v !== null && v !== undefined && v !== '' && v !== false)
     .map(([l,v]) => `<tr><td class="lbl">${l}</td><td>${v}</td></tr>`).join('');

    return `<div class="pieza-print">
      <h3>${p.pieza || ('Pieza ' + p.suborden)}${p.cantidad ? ' — ' + fmtNum(p.cantidad,0) + ' uds' : ''}</h3>
      <table class="ficha-print"><tbody>${ficha}</tbody></table>
      <p class="procesos-print"><b>Procesos:</b> ${procesosTxt}</p>
      ${materiales.length ? `<p class="materiales-print"><b>Materiales consumidos:</b> ${materiales.join(' · ')}</p>` : ''}
      <table class="om-print">
        <thead><tr><th>Operario · Máquina</th><th>Horas</th><th>Cantidad</th></tr></thead>
        <tbody>${filasOM}</tbody>
      </table>
    </div>`;
  }).join('') || '<p>Esta orden no tiene piezas registradas (probablemente migrada del histórico sin detalle de OPP).</p>';

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Orden ${orden} — ${o.cliente || ''}</title>
<style>
  body{ font-family: Arial, Helvetica, sans-serif; color:#111; margin:20px; }
  h1{ font-size:20px; margin:0 0 2px; }
  .sub{ color:#444; font-size:13px; margin-bottom:16px; }
  h3{ font-size:15px; margin:16px 0 6px; border-bottom:1px solid #999; padding-bottom:3px; }
  table{ border-collapse:collapse; width:100%; margin-bottom:8px; font-size:12px; }
  td, th{ border:1px solid #ccc; padding:4px 6px; text-align:left; }
  .ficha-print td.lbl{ color:#555; width:38%; }
  .procesos-print, .materiales-print{ font-size:12px; margin:4px 0; }
  .pieza-print{ page-break-inside: avoid; margin-bottom:14px; }
  @media print{ body{ margin:10mm; } }
</style>
</head><body>
  <h1>Orden de producción ${orden}</h1>
  <div class="sub">${o.cliente || '—'} ${o.producto ? '· ' + o.producto : ''} · ${tipoTrabajoLabel(o)} · ${(o.fecha||'').slice(0,10)} · Estado: ${estado.label}${estado.pct!=null ? ' (' + estado.pct + '%)' : ''}</div>
  ${o.observaciones ? `<p><b>Observaciones:</b> ${o.observaciones}</p>` : ''}
  ${piezasHTML}
</body></html>`;

  const w = window.open('', '_blank');
  if(!w){ toast('El navegador bloqueó la ventana de impresión — permite ventanas emergentes para este sitio'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

// ---------- crear / editar / duplicar / cancelar ----------
function resetOppForm(nextOrden){
  editingOrden = null;
  document.getElementById('opp-form-mode').textContent = 'Creando una orden nueva';
  document.getElementById('opp-piezas-list').innerHTML = '';
  oppPiezaCount = 0;
  document.getElementById('opp-cliente').value = '';
  document.getElementById('opp-producto').value = '';
  document.getElementById('opp-cliente-nuevo-wrap').style.display = 'none';
  document.getElementById('opp-producto-nuevo-wrap').style.display = 'none';
  document.getElementById('opp-producto-ref').style.display = 'none';
  document.getElementById('opp-orden').value = nextOrden != null ? nextOrden : suggestNextOrden();
  document.getElementById('opp-orden').disabled = false;
  document.getElementById('opp-fecha').value = new Date().toISOString().slice(0,10);
  setValSafe('opp-tipo-trabajo', 'Litografia');
  aplicarTipoTrabajo();
  addPiezaCard();
}

function loadOrdenParaEditar(orden){
  const o = DB.opp_ordenes.find(x => x.orden === orden);
  if(!o) return;
  editingOrden = orden;
  document.getElementById('opp-form-mode').textContent = `Editando la orden ${orden} — al guardar se sobrescribe`;
  document.getElementById('opp-orden').value = orden;
  document.getElementById('opp-orden').disabled = true;
  ensureOptionExists(document.getElementById('opp-cliente'), o.cliente || '');
  ensureOptionExists(document.getElementById('opp-producto'), o.producto || '');
  document.getElementById('opp-fecha').value = (o.fecha || '').slice(0,10) || new Date().toISOString().slice(0,10);
  setValSafe('opp-tipo-trabajo', o.tipo_trabajo || 'Litografia');
  aplicarTipoTrabajo();
  renderProductoRef();

  document.getElementById('opp-piezas-list').innerHTML = '';
  oppPiezaCount = 0;
  const piezas = DB.opp_piezas.filter(p => p.orden === orden).sort((a,b)=>a.suborden-b.suborden);
  piezas.forEach(p => addPiezaCard(p));
  if(!piezas.length) addPiezaCard();
  toast('Orden ' + orden + ' cargada para editar');
  document.getElementById('panel-ordenes').scrollIntoView({ behavior:'smooth' });
}

function duplicarOrden(orden){
  const o = DB.opp_ordenes.find(x => x.orden === orden);
  if(!o) return;
  editingOrden = null; // se guarda como ORDEN NUEVA
  const nuevoNumero = suggestNextOrden();
  document.getElementById('opp-form-mode').textContent = `Duplicando la orden ${orden} → se guardará como una orden nueva`;
  document.getElementById('opp-orden').value = nuevoNumero;
  document.getElementById('opp-orden').disabled = false;
  ensureOptionExists(document.getElementById('opp-cliente'), o.cliente || '');
  ensureOptionExists(document.getElementById('opp-producto'), o.producto || '');
  document.getElementById('opp-fecha').value = new Date().toISOString().slice(0,10);
  setValSafe('opp-tipo-trabajo', o.tipo_trabajo || 'Litografia');
  aplicarTipoTrabajo();
  renderProductoRef();

  document.getElementById('opp-piezas-list').innerHTML = '';
  oppPiezaCount = 0;
  const piezas = DB.opp_piezas.filter(p => p.orden === orden).sort((a,b)=>a.suborden-b.suborden);
  piezas.forEach(p => addPiezaCard(p));
  if(!piezas.length) addPiezaCard();
  toast('Ajusta precios/cantidades y guarda como nueva orden ' + nuevoNumero);
  document.getElementById('panel-ordenes').scrollIntoView({ behavior:'smooth' });
}

async function cancelarOrden(orden){
  if(!confirm(`¿Cancelar la orden ${orden}? Esto no borra su historial, solo la marca como cancelada.`)) return;
  const { error } = await sb.from('opp_ordenes').update({ estado: 'Cancelada' }).eq('orden', orden);
  if(error){ console.error(error); toast('No se pudo cancelar la orden'); return; }
  const o = DB.opp_ordenes.find(x => x.orden === orden);
  if(o) o.estado = 'Cancelada';
  toast('Orden ' + orden + ' cancelada');
  renderOppRecent();
}

async function saveOpp(){
  const btn = document.getElementById('opp-save');
  const orden = parseInt(document.getElementById('opp-orden').value, 10);
  const cliente = document.getElementById('opp-cliente').value.trim();
  const cards = document.querySelectorAll('#opp-piezas-list .opp-pieza-card');

  if(!orden || !cliente){ toast('Falta el número de orden o el cliente'); return; }
  if(cliente === '__nuevo__'){ toast('Completa la creación del cliente nuevo (botón "Agregar")'); return; }
  if(document.getElementById('opp-producto').value === '__nuevo__'){ toast('Completa la creación del producto nuevo (botón "Agregar")'); return; }
  if(cards.length === 0){ toast('Agrega al menos una pieza'); return; }

  btn.disabled = true; btn.textContent = 'Guardando…';
  try{
    const tipoTrabajo = document.getElementById('opp-tipo-trabajo')?.value || 'Litografia';
    const esLitografia = tipoTrabajo === 'Litografia';
    const cabecera = {
      orden, cliente,
      producto: document.getElementById('opp-producto').value.trim() || null,
      fecha: document.getElementById('opp-fecha').value,
      tipo_trabajo: tipoTrabajo
    };

    if(editingOrden === orden){
      const { error: errUpd } = await sb.from('opp_ordenes').update(cabecera).eq('orden', orden);
      if(errUpd) throw errUpd;
      const { error: errDel } = await sb.from('opp_piezas').delete().eq('orden', orden);
      if(errDel) throw errDel;
    } else {
      const { error: errIns } = await sb.from('opp_ordenes').insert([cabecera]);
      if(errIns) throw errIns;
    }

    const piezasPayload = Array.from(cards).map((node, i) => {
      const suborden = i + 1;
      const base = {
        orden, suborden, op: orden + '-' + suborden,
        pieza: node.querySelector('.f-pieza').value.trim() || null,
        cantidad: parseFloat(node.querySelector('.f-cantidad').value) || null,
        procesos_requeridos: Array.from(node.querySelectorAll('.f-proc:checked')).map(cb => cb.value)
      };

      if(!esLitografia){
        // ficha simplificada: nada de imposición/pliego, solo lo relevante
        // para Impresión Digital, Gran Formato, Servicio de Impresión
        // Externo o Trabajo Externo.
        return {
          ...base,
          proveedor: node.querySelector('.f-proveedor')?.value.trim() || null,
          costo_externo: parseFloat(node.querySelector('.f-costo-externo')?.value) || null,
          fecha_entrega_estimada: node.querySelector('.f-fecha-entrega')?.value || null,
          otros_acabados: node.querySelector('.f-otros-simple')?.value.trim() || null
        };
      }

      const pliego = node.querySelector('.f-pliego').value.split('x').map(Number);
      return {
        ...base,
        tamano_ancho: parseFloat(node.querySelector('.f-tam-ancho').value) || null,
        tamano_alto: parseFloat(node.querySelector('.f-tam-alto').value) || null,
        papel: node.querySelector('.f-papel').value.trim() || null,
        pliego_ancho: pliego[0] || null, pliego_alto: pliego[1] || null,
        tintas_frente: parseInt(node.querySelector('.f-tintas-frente').value) || 0,
        tintas_atras: parseInt(node.querySelector('.f-tintas-atras').value) || 0,
        ctp: node.querySelector('.f-ctp').value,
        tira_retira: node.querySelector('.f-tira').value,
        laminado: node.querySelector('.f-laminado').value || null,
        laminado_lados: parseInt(node.querySelector('.f-laminado-lados').value) || 0,
        barniz_uv: node.querySelector('.f-barniz').checked,
        troquelado: node.querySelector('.f-troquelado').checked,
        troquel_detalle: node.querySelector('.f-troquel-detalle').value.trim() || null,
        talonarios: node.querySelector('.f-talonarios').checked,
        otros_acabados: node.querySelector('.f-otros').value.trim() || null,
        unidades_por_montaje: parseFloat(node.querySelector('.f-unidades-montaje').value) || 1,
        tamanos_solicitados: parseFloat(node.querySelector('.f-tam-solicitados').value) || null,
        tamanos_programados: parseFloat(node.querySelector('.f-tam-programados').value) || null,
        medida_tamano_ancho: parseFloat(node.querySelector('.f-medida-ancho').value) || null,
        medida_tamano_alto: parseFloat(node.querySelector('.f-medida-alto').value) || null,
        tamanos_por_pliego: parseFloat(node.querySelector('.f-tam-por-pliego').value) || null,
        pliegos: parseFloat(node.querySelector('.f-pliegos-result').textContent.replace(/\./g,'')) || null
      };
    });

    const { error: errPiezas } = await sb.from('opp_piezas').insert(piezasPayload);
    if(errPiezas) throw errPiezas;

    toast((editingOrden===orden ? 'Orden actualizada: ' : 'Orden guardada: ') + orden + ' con ' + piezasPayload.length + ' pieza(s)');

    const { data: o1 } = await sb.from('opp_ordenes').select('*').order('orden', { ascending: false });
    const { data: o2 } = await sb.from('opp_piezas').select('*');
    DB.opp_ordenes = o1 || [];
    DB.opp_piezas = o2 || [];

    resetOppForm(suggestNextOrden());
    renderOppRecent();
  }catch(err){
    console.error(err);
    const detalle = (err && (err.message || err.details || err.hint)) || 'revisa la consola';
    toast('Error al guardar la orden: ' + detalle);
  }finally{
    btn.disabled = false; btn.textContent = 'Guardar orden completa';
  }
}

function filtrarOrdenes(){
  const q = document.getElementById('opp-buscar').value.trim().toLowerCase();
  if(!q){ renderOppLista(DB.opp_ordenes.slice(0,20)); return; }
  const filtradas = DB.opp_ordenes.filter(o =>
    String(o.orden).includes(q) ||
    (o.cliente||'').toLowerCase().includes(q) ||
    (o.producto||'').toLowerCase().includes(q)
  );
  renderOppLista(filtradas.slice(0,50));
}

// Si el número que se escribió en "Orden N°" ya existe, carga esa orden
// completa (cliente, producto y piezas) en modo edición automáticamente.
function checkOrdenExistente(){
  const input = document.getElementById('opp-orden');
  const val = parseInt(input.value, 10);
  if(!val || input.disabled) return; // disabled = ya está en modo edición, no repetir
  const existe = DB.opp_ordenes.find(o => o.orden === val);
  if(existe){
    loadOrdenParaEditar(val);
    toast('La orden ' + val + ' ya existe — cargada para editar');
  }
}

// Conecta un evento de forma segura: si el elemento no existe en esta
// página (por ejemplo un HTML desactualizado), avisa en consola pero NO
// lanza una excepción — así una sola pieza faltante no bloquea todo lo
// demás que venga después en initOppForm().
function on(id, evento, handler){
  const el = document.getElementById(id);
  if(!el){ console.warn('[ordenes.js] No se encontró #' + id + ' — revisa que index.html esté actualizado.'); return; }
  el.addEventListener(evento, handler);
}

function setValSafe(id, valor){
  const el = document.getElementById(id);
  if(el) el.value = valor;
}

export function initOppForm(){
  populateClienteSelect();
  populateProductoSelect();
  wireNuevoInline('opp-cliente', 'opp-cliente-nuevo-wrap', 'opp-cliente-nuevo-nombre', 'opp-cliente-nuevo-add', 'clientes', c => DB.clientes.push(c));
  wireNuevoInline('opp-producto', 'opp-producto-nuevo-wrap', 'opp-producto-nuevo-nombre', 'opp-producto-nuevo-add', 'productos', p => DB.productos.push(p));
  on('opp-producto', 'change', renderProductoRef);
  on('opp-tipo-trabajo', 'change', aplicarTipoTrabajo);
  resetOppForm();
  on('opp-add-pieza', 'click', () => addPiezaCard());
  on('opp-save', 'click', saveOpp);
  on('opp-reset', 'click', () => resetOppForm());
  on('opp-buscar', 'input', filtrarOrdenes);
  on('opp-detalle-cerrar', 'click', () => {
    document.getElementById('opp-detalle-card').style.display = 'none';
  });
  on('opp-detalle-imprimir', 'click', imprimirOrdenActual);
  on('opp-orden', 'change', checkOrdenExistente);
  on('opp-orden', 'blur', checkOrdenExistente);

  // ---------- botón superior: consultar el detalle completo de cualquier orden ----------
  const consultarBtn = document.getElementById('opp-consultar-btn');
  const consultarInput = document.getElementById('opp-consultar-orden');
  if(consultarBtn && consultarInput){
    const ejecutarConsulta = () => {
      const val = parseInt(consultarInput.value, 10);
      if(!val){ toast('Escribe un número de orden'); return; }
      const existe = DB.opp_ordenes.find(o => o.orden === val);
      if(!existe){ toast('No existe una orden con ese número'); return; }
      mostrarDetalleOrden(val);
    };
    consultarBtn.addEventListener('click', ejecutarConsulta);
    consultarInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') ejecutarConsulta(); });
  } else {
    console.warn('[ordenes.js] No se encontró la tarjeta "Consultar orden" — revisa que index.html esté actualizado.');
  }

  on('export-ordenes', 'click', () => {
    const conteo = {};
    DB.opp_piezas.forEach(p => { conteo[p.orden] = (conteo[p.orden] || 0) + 1; });
    exportarExcel('LitoColor_ordenes.xlsx', [{
      nombre: 'Órdenes',
      filas: DB.opp_ordenes.map(o => {
        const estado = estadoOrden(o);
        return {
          Orden: o.orden, Cliente: o.cliente, Tipo: tipoTrabajoLabel(o), Producto: o.producto, Fecha: (o.fecha||'').slice(0,10),
          Piezas: conteo[o.orden] || 0, Estado: estado.label,
          'Avance %': estado.pct, 'Costo M.O.': costoAcumulado(o.orden)
        };
      })
    }]);
  });
}
