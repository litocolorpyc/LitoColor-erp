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

export function refreshPapelPliegoSelects(){
  document.querySelectorAll('#opp-piezas-list .opp-pieza-card').forEach(node => {
    populatePapelSelect(node);
    populatePliegoSelect(node);
  });
}

function distinctPliegos(){
  const set = new Set();
  DB.materias_primas.forEach(m => {
    if(m.pliego_ancho && m.pliego_alto) set.add(m.pliego_ancho + 'x' + m.pliego_alto);
  });
  return Array.from(set).sort();
}

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
  const pliegos = distinctPliegos();
  sel.innerHTML = pliegos.map(p => `<option value="${p}">${p.replace('x',' x ')} cm</option>`).join('') || '<option value="">— sin papeles con pliego definido —</option>';
  if(valorPrevio) ensureOptionExists(sel, valorPrevio);
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
    if(pliego){
      ensureOptionExists(node.querySelector('.f-pliego'), pliego);
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
  if(p.pliego_ancho && p.pliego_alto) ensureOptionExists(node.querySelector('.f-pliego'), p.pliego_ancho + 'x' + p.pliego_alto);
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

function renderOppLista(rows){
  const conteo = {};
  DB.opp_piezas.forEach(p => { conteo[p.orden] = (conteo[p.orden] || 0) + 1; });
  document.querySelector('#tbl-opp-recent tbody').innerHTML = rows.map(o => {
    const estado = estadoOrden(o);
    const costo = costoAcumulado(o.orden);
    return `<tr>
      <td>${o.orden}</td><td>${o.cliente || '—'}</td><td>${o.producto || '—'}</td>
      <td class="num">${conteo[o.orden] || 0}</td><td>${(o.fecha || '').slice(0,10)}</td>
      <td>${estadoBadgeHTML(estado)}</td><td class="num">${fmtCOPlocal(costo)}</td>
      <td><div class="row-actions">
        <button type="button" class="row-btn" data-detalle="${o.orden}">Ver detalle</button>
        <button type="button" class="row-btn" data-edit="${o.orden}">Editar</button>
        <button type="button" class="row-btn" data-dup="${o.orden}">Duplicar</button>
        ${o.estado!=='Cancelada' ? `<button type="button" class="row-btn row-btn-danger" data-cancel="${o.orden}">Cancelar</button>` : ''}
      </div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--ink-faint)">Sin órdenes registradas</td></tr>';

  document.querySelectorAll('#tbl-opp-recent [data-detalle]').forEach(b => b.addEventListener('click', () => mostrarDetalleOrden(parseInt(b.dataset.detalle,10))));
  document.querySelectorAll('#tbl-opp-recent [data-edit]').forEach(b => b.addEventListener('click', () => loadOrdenParaEditar(parseInt(b.dataset.edit,10))));
  document.querySelectorAll('#tbl-opp-recent [data-dup]').forEach(b => b.addEventListener('click', () => duplicarOrden(parseInt(b.dataset.dup,10))));
  document.querySelectorAll('#tbl-opp-recent [data-cancel]').forEach(b => b.addEventListener('click', () => cancelarOrden(parseInt(b.dataset.cancel,10))));
}
function fmtCOPlocal(n){ if(n==null||isNaN(n)) return '—'; return '$' + Math.round(n).toLocaleString('es-CO'); }

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

  document.getElementById('opp-detalle-titulo').textContent = `Orden ${orden} — ${o.cliente || ''}`;

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
        <span class="card-hint">${p.cantidad ? fmtNum(p.cantidad,0)+' uds' : ''} ${p.papel ? '· '+p.papel : ''} ${p.tintas_frente!=null ? '· Tintas '+p.tintas_frente+'x'+(p.tintas_atras||0) : ''}</span>
      </div>
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
    const cabecera = {
      orden, cliente,
      producto: document.getElementById('opp-producto').value.trim() || null,
      fecha: document.getElementById('opp-fecha').value
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
      const pliego = node.querySelector('.f-pliego').value.split('x').map(Number);
      const suborden = i + 1;
      return {
        orden, suborden, op: orden + '-' + suborden,
        pieza: node.querySelector('.f-pieza').value.trim() || null,
        cantidad: parseFloat(node.querySelector('.f-cantidad').value) || null,
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
        pliegos: parseFloat(node.querySelector('.f-pliegos-result').textContent.replace(/\./g,'')) || null,
        procesos_requeridos: Array.from(node.querySelectorAll('.f-proc:checked')).map(cb => cb.value)
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
    toast('Error al guardar la orden — revisa la consola');
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

export function initOppForm(){
  populateClienteSelect();
  populateProductoSelect();
  wireNuevoInline('opp-cliente', 'opp-cliente-nuevo-wrap', 'opp-cliente-nuevo-nombre', 'opp-cliente-nuevo-add', 'clientes', c => DB.clientes.push(c));
  wireNuevoInline('opp-producto', 'opp-producto-nuevo-wrap', 'opp-producto-nuevo-nombre', 'opp-producto-nuevo-add', 'productos', p => DB.productos.push(p));
  document.getElementById('opp-producto').addEventListener('change', renderProductoRef);
  resetOppForm();
  document.getElementById('opp-add-pieza').addEventListener('click', () => addPiezaCard());
  document.getElementById('opp-save').addEventListener('click', saveOpp);
  document.getElementById('opp-reset').addEventListener('click', () => resetOppForm());
  document.getElementById('opp-buscar').addEventListener('input', filtrarOrdenes);
  document.getElementById('opp-detalle-cerrar').addEventListener('click', () => {
    document.getElementById('opp-detalle-card').style.display = 'none';
  });
  const btnExport = document.getElementById('export-ordenes');
  if(btnExport) btnExport.addEventListener('click', () => {
    const conteo = {};
    DB.opp_piezas.forEach(p => { conteo[p.orden] = (conteo[p.orden] || 0) + 1; });
    exportarExcel('LitoColor_ordenes.xlsx', [{
      nombre: 'Órdenes',
      filas: DB.opp_ordenes.map(o => {
        const estado = estadoOrden(o);
        return {
          Orden: o.orden, Cliente: o.cliente, Producto: o.producto, Fecha: (o.fecha||'').slice(0,10),
          Piezas: conteo[o.orden] || 0, Estado: estado.label,
          'Avance %': estado.pct, 'Costo M.O.': costoAcumulado(o.orden)
        };
      })
    }]);
  });
}
