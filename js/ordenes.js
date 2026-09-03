import { sb } from './supabase-client.js';
import { DB, normProd } from './store.js';
import { toast, fmtNum, exportarExcel, fechaHoyLocal, wireTableScroll } from './helpers.js';
import { getCurrentUser, puedeEditarProduccion } from './auth.js';
import { poblarDatalistProveedores } from './costos.js';

const ROLES_REORDENAN_PRIORIDAD = ['admin', 'gerente', 'jefe_produccion'];

let oppPiezaCount = 0;
let editingOrden = null; // si no es null, Guardar actualiza esa orden en vez de crear una nueva
let presupuestoPendienteImportacion = null; // presupuesto leído del Excel, se guarda junto con la orden

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

// Qué tipo de proveedor tiene más sentido sugerir primero según el tipo de
// trabajo de la orden. No es una restricción — solo ordena la lista para
// que lo más probable aparezca de primero; cualquier proveedor se puede
// elegir igual.
const TIPO_PROVEEDOR_RELEVANTE = {
  'Servicio de Impresión Externo': ['Proveedor de Maquila', 'Proveedor de Servicios'],
  'Trabajo Externo': ['Proveedor de Maquila', 'Proveedor de Servicios'],
  'Gran Formato': ['Proveedor de Maquila', 'Proveedor de Insumos'],
  'Impresión Digital': ['Proveedor de Insumos', 'Proveedor de Maquila']
};

function refreshProveedoresDatalist(){
  const dl = document.getElementById('opp-proveedores-datalist');
  const hint = document.getElementById('opp-proveedor-hint');
  if(!dl) return;
  const tipo = document.getElementById('opp-tipo-trabajo')?.value || 'Litografia';
  const relevantes = TIPO_PROVEEDOR_RELEVANTE[tipo] || [];

  const activos = DB.proveedores.filter(p => p.activo !== false);
  const ordenados = activos.slice().sort((a, b) => {
    const ra = relevantes.indexOf(a.tipo_proveedor);
    const rb = relevantes.indexOf(b.tipo_proveedor);
    const pa = ra === -1 ? 99 : ra;
    const pb = rb === -1 ? 99 : rb;
    return pa - pb || a.nombre.localeCompare(b.nombre);
  });

  dl.innerHTML = ordenados.map(p =>
    `<option value="${p.nombre}">${p.tipo_proveedor ? ' — ' + p.tipo_proveedor : ''}</option>`
  ).join('');

  if(hint) hint.textContent = relevantes.length ? `sugerido primero: ${relevantes.join(' / ')}` : '';
}

// ---------- orden en que se hacen los procesos de una pieza ----------
// Los procesos que requiere una pieza (los checkboxes de arriba) ahora
// también tienen un ORDEN elegible al crear/editar la orden — antes
// procesos_requeridos salía siempre en el mismo orden fijo de los
// checkboxes en el HTML. Se arma como una lista aparte, arrastrable
// (mismo patrón que "Prioridad de producción"), sincronizada con lo que
// esté marcado; el orden por defecto de un proceso recién marcado sale
// del maestro "Áreas" (columna Orden).
function ordenPorDefectoArea(area){
  const a = DB.areas.find(x => x.nombre === area);
  return (a && a.orden != null) ? a.orden : 999;
}

function wireDragOrdenProcesos(cont){
  let arrastrando = null;
  cont.querySelectorAll('.opp-proceso-orden-row').forEach(row => {
    row.addEventListener('dragstart', () => { arrastrando = row; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if(!arrastrando || arrastrando === row) return;
      const rect = row.getBoundingClientRect();
      const despuesDelPunto = (e.clientY - rect.top) > rect.height / 2;
      row.parentNode.insertBefore(arrastrando, despuesDelPunto ? row.nextSibling : row);
    });
  });
}

// Reconstruye la lista arrastrable a partir de los checkboxes marcados
// ahora mismo. `ordenPreferido` (opcional) es una secuencia ya guardada
// (ej. al editar una pieza existente) que manda la primera vez; después,
// se respeta lo que el usuario ya tenía arrastrado en pantalla y los
// procesos recién marcados se agregan al final según el maestro Áreas.
function refrescarOrdenProcesos(node, ordenPreferido){
  const cont = node.querySelector('.opp-procesos-orden');
  if(!cont) return;
  const marcados = Array.from(node.querySelectorAll('.f-proc:checked')).map(cb => cb.value);
  let orden;
  if(Array.isArray(ordenPreferido) && ordenPreferido.length){
    orden = ordenPreferido.filter(p => marcados.includes(p));
    marcados.forEach(p => { if(!orden.includes(p)) orden.push(p); });
  } else {
    const filasActuales = Array.from(cont.querySelectorAll('[data-proc]')).map(r => r.dataset.proc);
    orden = filasActuales.filter(p => marcados.includes(p));
    const nuevos = marcados.filter(p => !orden.includes(p)).sort((a,b) => ordenPorDefectoArea(a) - ordenPorDefectoArea(b));
    orden = [...orden, ...nuevos];
  }

  cont.innerHTML = orden.map(p => `<div class="opp-proceso-orden-row" draggable="true" data-proc="${p}">
      <span class="prioridad-handle">⠿</span><span>${p}</span>
    </div>`).join('') || '<span class="card-hint">marca al menos un proceso arriba</span>';
  wireDragOrdenProcesos(cont);
}

// El orden final que se guarda en procesos_requeridos.
function procesosOrdenados(node){
  return Array.from(node.querySelectorAll('.opp-procesos-orden [data-proc]')).map(r => r.dataset.proc);
}

// Los checkboxes de proceso marcados "solo Litografía" (Corte inicial,
// Litografía, Guillotina) se ocultan por CSS para otros tipos de trabajo,
// pero si se quedan marcados igual entran a procesos_requeridos: la pieza
// nunca llega a 100% (nadie hace ese proceso) y en la pantalla de operario
// aparece un globo de "Litografía" que no aplica (ver puntos 6 y 11 de
// AjustesERP). Se sincroniza su estado "checked" con el tipo de trabajo
// vigente cada vez que cambia, y también al agregar una pieza nueva.
function sincronizarProcesosLitografia(node){
  const tipoSel = document.getElementById('opp-tipo-trabajo');
  const esLitografia = (tipoSel?.value || 'Litografia') === 'Litografia';
  node.querySelectorAll('.litografia-only-check .f-proc').forEach(cb => { cb.checked = esLitografia; });
}

function aplicarTipoTrabajo(){
  const tipoSel = document.getElementById('opp-tipo-trabajo');
  const piezasList = document.getElementById('opp-piezas-list');
  if(!tipoSel || !piezasList) return;
  const tipo = tipoSel.value;
  const esLitografia = tipo === 'Litografia';
  piezasList.classList.toggle('tipo-otros', !esLitografia);
  piezasList.querySelectorAll('.opp-pieza-card').forEach(node => {
    sincronizarProcesosLitografia(node);
    refrescarOrdenProcesos(node);
    recalcPieza(node);
  });
  const hint = document.getElementById('opp-tipo-trabajo-hint');
  if(hint) hint.textContent = HINT_TIPO_TRABAJO[tipo] || '';
  refreshProveedoresDatalist();
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
    cb.addEventListener('change', () => { cb.dataset.touched = '1'; refrescarOrdenProcesos(node); });
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

  // Si el papel ya viene definido (ej. una orden importada), el campo
  // arranca colapsado con un resumen — "Editar" lo despliega de nuevo.
  node.querySelector('.f-papel-editar-btn').addEventListener('click', () => expandirPapel(node));

  sincronizarProcesosLitografia(node);
  if(prefill) fillPiezaCard(node, prefill);
  refrescarOrdenProcesos(node, Array.isArray(prefill?.procesos_requeridos) ? prefill.procesos_requeridos : null);
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
  if(p.papel) colapsarPapel(node);
  node.querySelector('.f-tintas-frente').value = p.tintas_frente ?? 4;
  node.querySelector('.f-tintas-atras').value = p.tintas_atras ?? 0;
  const tintasDetTiro = node.querySelector('.f-tintas-detalle-tiro'); if(tintasDetTiro) tintasDetTiro.value = p.tintas_detalle_tiro || '';
  const tintasDetRetiro = node.querySelector('.f-tintas-detalle-retiro'); if(tintasDetRetiro) tintasDetRetiro.value = p.tintas_detalle_retiro || '';
  node.querySelector('.f-ctp').value = p.ctp || 'Convencional';
  // Prepara las opciones correctas de Impresión/Tipo de Montaje según si
  // tiene tinta atrás, ANTES de fijar el valor guardado (si no, el select
  // todavía no tendría esa opción disponible para elegirla).
  actualizarMontaje(node);
  node.querySelector('.f-tira').value = p.tira_retira || '';
  const giroSel = node.querySelector('.f-giro'); if(giroSel) giroSel.value = p.giro || '';
  actualizarMontaje(node); // vuelve a correr para mostrar/ocultar Giro y la nota según lo que quedó cargado
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
  // OJO: si p.procesos_requeridos no viene definido (ej. al importar desde
  // Excel, que no trae esa lista), NO tocar las casillas — se quedan con
  // los valores por defecto de la plantilla (Diseño/Litografía/Corte
  // inicial/Guillotina/Terminado marcados). Si se tratara como "lista
  // vacía" y se desmarcara todo, la pieza queda con 0 procesos requeridos
  // y el avance de la orden nunca se puede calcular — ese fue el bug que
  // afectó a las órdenes importadas.
  if(Array.isArray(p.procesos_requeridos)){
    const requeridos = p.procesos_requeridos;
    node.querySelectorAll('.f-proc').forEach(cb => {
      cb.checked = requeridos.includes(cb.value);
      cb.dataset.touched = '1';
    });
  }
}

// Cuando la pieza no tiene tinta en el retiro, "Impresión" queda fija en
// "Solo Tiro". En cuanto se le pone alguna tinta atrás, ese mismo campo se
// convierte en "Tipo de Montaje" (T/R · T Y R) — con Giro (Escuadra/Pinza)
// visible solo si eligen T/R, y la nota "Diferentes Planchas" — que se
// guarda en Otros acabados y también se avisa en pantalla — si eligen T Y R.
// Cuando el papel ya viene definido (típicamente al importar desde Excel,
// donde casi siempre es el mismo — ej. "Propalcote 115gr 60x90"), se
// colapsa en una línea de resumen para no repetir esa info visualmente.
// "Editar" lo despliega de nuevo sin perder nada.
function colapsarPapel(node){
  const papel = node.querySelector('.f-papel').value;
  const resumen = node.querySelector('.f-papel-resumen-texto');
  if(resumen) resumen.textContent = 'Papel: ' + (papel || '—');
  node.querySelector('.f-papel-resumen-linea').style.display = '';
  node.querySelector('.f-papel-pliego-fields').style.display = 'none';
}

function expandirPapel(node){
  node.querySelector('.f-papel-resumen-linea').style.display = 'none';
  node.querySelector('.f-papel-pliego-fields').style.display = '';
}

function actualizarMontaje(node){
  const tintasAtras = parseFloat(node.querySelector('.f-tintas-atras').value) || 0;
  const sel = node.querySelector('.f-tira');
  const label = node.querySelector('.f-tira-label');
  const giroWrap = node.querySelector('.f-giro-wrap');
  const notaSpan = node.querySelector('.f-montaje-nota');
  const otrosInput = node.querySelector('.f-otros');

  if(tintasAtras <= 0){
    label.textContent = 'Impresión';
    if(sel.value !== 'Solo Tiro' || sel.options.length !== 1){
      sel.innerHTML = '<option value="Solo Tiro">Solo Tiro</option>';
      sel.value = 'Solo Tiro';
    }
    sel.disabled = true;
    giroWrap.style.display = 'none';
    quitarNotaDiferentesPlanchas(otrosInput);
    return;
  }

  label.textContent = 'Tipo de Montaje';
  sel.disabled = false;
  if(!['T/R', 'T Y R'].includes(sel.value)){
    sel.innerHTML = '<option value="">Selecciona…</option><option value="T/R">T/R</option><option value="T Y R">T Y R</option>';
  }

  const giroFieldWrap = node.querySelector('.f-giro').closest('.field');

  if(sel.value === 'T/R'){
    giroWrap.style.display = '';
    giroFieldWrap.style.display = '';
    notaSpan.style.display = 'none';
    quitarNotaDiferentesPlanchas(otrosInput);
  } else if(sel.value === 'T Y R'){
    // "T Y R" no usa Giro (Escuadra/Pinza) — solo aplica a "T/R". Se oculta
    // únicamente el campo Giro (no toda la fila), porque la nota
    // "Diferentes Planchas" vive en la misma fila y sí debe seguir visible.
    giroWrap.style.display = '';
    giroFieldWrap.style.display = 'none';
    node.querySelector('.f-giro').value = '';
    notaSpan.style.display = '';
    agregarNotaDiferentesPlanchas(otrosInput);
  } else {
    giroWrap.style.display = 'none';
    notaSpan.style.display = 'none';
  }
}

function agregarNotaDiferentesPlanchas(otrosInput){
  if(!otrosInput || otrosInput.value.includes('Diferentes Planchas')) return;
  otrosInput.value = otrosInput.value.trim() ? otrosInput.value.trim() + ', Diferentes Planchas' : 'Diferentes Planchas';
}

function quitarNotaDiferentesPlanchas(otrosInput){
  if(!otrosInput || !otrosInput.value.includes('Diferentes Planchas')) return;
  otrosInput.value = otrosInput.value
    .split(',').map(s => s.trim()).filter(s => s && s !== 'Diferentes Planchas').join(', ');
}

function recalcPieza(node){
  actualizarMontaje(node);
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

// Sugiere en el campo "Nombre de la pieza" las piezas que ya se han usado
// antes para el producto elegido (sigue siendo texto libre — si no está en
// la lista, se puede escribir y queda registrada al guardar la orden).
function refreshPiezasDatalist(){
  const dl = document.getElementById('opp-piezas-datalist');
  if(!dl) return;
  const producto = document.getElementById('opp-producto')?.value || '';
  const piezas = DB.piezas_producto.filter(pp => pp.producto === producto && pp.activo !== false);
  dl.innerHTML = piezas.map(pp => `<option value="${pp.pieza}">`).join('');
}

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
// Subprocesos activos definidos para un área (catálogo "Subprocesos" en
// Maestros), en el orden en que se deben hacer. Un área sin nada acá se
// sigue completando con un solo registro terminado (ver abajo).
export function subprocesosDeArea(area){
  return DB.subprocesos
    .filter(s => s.proceso === area && s.activo !== false)
    .sort((a,b) => (a.orden ?? 999) - (b.orden ?? 999));
}

// El registro CERRADO (horaFin seteada) más reciente de una lista, por
// fecha+hora de fin. "más reciente" es lo que manda para saber si un
// área/subproceso está terminado — ver areasCompletadasPorPieza.
function masReciente(recs){
  return recs.reduce((max, r) => {
    if(!max) return r;
    return ((r.fecha||'') + (r.horaFin||'')) > ((max.fecha||'') + (max.horaFin||'')) ? r : max;
  }, null);
}

// Áreas que YA se dieron por terminadas para esta pieza. Corrección
// (12ago26): antes, con que CUALQUIER registro de esa área hubiera
// quedado terminado alguna vez, el área contaba como completada para
// siempre — así, si alguien reabría un área ya terminada para hacerle
// algo más (reproceso, un detalle que faltó) y esta vez la PAUSABA en
// vez de finalizarla, el área seguía viéndose "terminada" con datos
// viejos y la orden desaparecía de los tableros aunque en la realidad
// seguía con trabajo pendiente. Ahora manda el registro CERRADO MÁS
// RECIENTE de cada área (o de cada subproceso, si el área los tiene): si
// el último quedó pausado, el área vuelve a estar pendiente aunque antes
// se hubiera terminado — así se puede "reabrir" un proceso sin trucos.
export function areasCompletadasPorPieza(pieza){
  const recs = DB.produccion.filter(r =>
    (r.op === pieza.op || (r.orden === pieza.orden && r.suborden === pieza.suborden)) && r.horaFin
  );
  const requeridos = Array.isArray(pieza.procesos_requeridos) ? pieza.procesos_requeridos : [];
  const completadas = new Set();
  requeridos.forEach(area => {
    const subs = subprocesosDeArea(area);
    const recsArea = recs.filter(r => r.area === area);
    if(!subs.length){
      const ultimo = masReciente(recsArea);
      if(ultimo && ultimo.procesoCompleto !== false) completadas.add(area);
    } else {
      const todosOk = subs.every(s => {
        const ultimo = masReciente(recsArea.filter(r => r.subproceso === s.nombre));
        return ultimo && ultimo.procesoCompleto !== false;
      });
      if(todosOk) completadas.add(area);
    }
  });
  return completadas;
}

// Áreas que tienen CUALQUIER actividad (en curso o terminada) — se usa solo
// para mostrar "En proceso" mientras se trabaja, sin exigir que ya cuente
// como área completada. Se exige horaIni: una actividad ASIGNADA a un
// operario pero que todavía no empezó (ver "Prioridad de producción" y
// js/registrar.js) no cuenta como trabajo real todavía — si contara, una
// orden pasaría a "En proceso" solo por haberse repartido, sin que nadie
// hubiera puesto una mano encima.
export function areasConActividadPorPieza(pieza){
  const recs = DB.produccion.filter(r =>
    (r.op === pieza.op || (r.orden === pieza.orden && r.suborden === pieza.suborden)) && r.horaIni
  );
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
    const tocado = areasConActividadPorPieza(p);
    totalReq += req.length;
    totalDone += req.filter(a => done.has(a)).length;
    if(req.some(a => tocado.has(a))) algunoEmpezado = true;
  });
  if(totalReq === 0) return { label: 'Pendiente', pct: 0 };
  const pct = Math.round((totalDone / totalReq) * 100);
  if(pct >= 100) return { label: 'Completada', pct: 100 };
  if(algunoEmpezado) return { label: 'En proceso', pct };
  return { label: 'Pendiente', pct: 0 };
}

export function estadoBadgeHTML(estado){
  const cls = { 'Completada':'done', 'Cerrada':'done', 'En proceso':'estado-chip-warn', 'Pendiente':'pending', 'Cancelada':'pending' }[estado.label] || 'pending';
  const pct = estado.pct != null ? ` (${estado.pct}%)` : '';
  return `<span class="estado-chip ${cls}">${estado.label}${pct}</span>`;
}

// Una orden sigue "viva" (debe verse en los tableros de pendientes/en
// proceso) mientras no esté cancelada ni ya haya llegado al 100%. Antes los
// tableros solo excluían 'Cerrada'/'Cancelada' en el campo guardado en la
// BD, pero nada en el sistema pone nunca 'Cerrada' — el 100% se calcula al
// vuelo (ver estadoOrden) — así que una orden terminada se quedaba mezclada
// con las pendientes para siempre. No se borra ni se toca nada en la BD:
// la orden y su historial siguen existiendo, solo se saca de estos tableros.
export function ordenEnCurso(o){
  const label = estadoOrden(o).label;
  return label !== 'Cerrada' && label !== 'Cancelada' && label !== 'Completada';
}

// Para el selector del operario: solo órdenes que siguen abiertas para trabajar.
export function getOrdenesSeleccionables(){
  return DB.opp_ordenes
    .filter(ordenEnCurso)
    .sort((a,b) => b.orden - a.orden);
}

// ---------- costo acumulado de una orden ----------
function costoAcumulado(orden){
  return DB.produccion.filter(r => r.orden === orden).reduce((s,r)=>s+(r.valorActividad||0),0);
}

// Costo de materiales/compras asociado a la orden (de los recibos de
// compra importados con Concepto asignado) — es ADICIONAL al costo de
// mano de obra de costoAcumulado(), no lo reemplaza.
function costoMaterialesDeOrden(orden){
  return DB.costos_movimientos.filter(m => m.orden === orden).reduce((s,m)=>s+(m.valor||0),0);
}

// Texto para una compra/costo asociado a una orden (costos_movimientos sin
// produccion_id — viene de "Registrar costo" o de "Importar compra" en esa
// misma pestaña). Para lo importado del PDF el comentario queda como
// "Compra No. 1750 — Plancha CTP…" (ver guardarRecibo en recibos.js) — se
// le quita el "Compra No. X — " de adelante para mostrar solo la
// descripción del material (por nombre de columna, no por recibo_id: hay
// movimientos viejos, de antes de que se guardara recibo_id, con el mismo
// formato de comentario). Para lo cargado a mano el comentario ya es lo
// que la persona escribió tal cual; si lo dejó vacío, se usa el nombre del
// concepto de costo.
function descripcionCompra(m){
  const base = (m.comentario || '').replace(/^Compra\s*No\.?\s*\S+\s*—\s*/i, '').trim();
  if(base) return base;
  const concepto = DB.costos_conceptos.find(c => c.id === m.concepto_id);
  return concepto ? concepto.nombre : 'Costo asociado';
}

// Compras/costos ligados DIRECTO a una orden (o a una pieza puntual de
// ella) desde "Registrar costo" (a mano o importando el PDF de Siigo) —
// distintos de los "Consumo automático" que genera Registrar al finalizar
// una actividad (esos ya se excluyen: no tienen produccion_id). Pedido
// explícito 14ago26: si una compra se asocia a una orden es porque ese
// material completo va para ella, aunque nadie lo haya "consumido" todavía
// desde Registrar.
function comprasDeOrden(orden, suborden){
  return DB.costos_movimientos.filter(m =>
    m.orden === orden && m.suborden === (suborden ?? null) && m.produccion_id == null
  );
}

// Lista de "Materiales consumidos" de una pieza, cada uno con su costo si
// lo tiene. El costo sale de costos_movimientos: cada vez que se registra
// un consumo numérico con costo_unitario configurado, se genera ahí un
// movimiento "Consumo automático — <material> (<cantidad>)" ligado al
// produccion_id del registro (ver descontarInventarioYCargarCosto en
// registrar.js) — acá se suman esos movimientos por registro. Si el
// material no tiene costo_unitario cargado o el consumo se escribió como
// texto libre, no hay movimiento que sumar y el material sale sin costo
// (nunca en $0, para no dar a entender que de verdad no costó nada).
// También se suman las compras ligadas directo a esta pieza (ver
// comprasDeOrden arriba).
function materialesConsumidosConCosto(recsPieza, orden, suborden){
  const porDetalle = new Map(); // "nombre — cantidad" -> costo acumulado
  recsPieza.forEach(r => {
    const detalle = [r.materiaPrima, r.consumoMP].filter(Boolean).join(' — ');
    if(!detalle) return;
    const costoReg = DB.costos_movimientos
      .filter(m => m.produccion_id === r.id && (m.comentario || '').startsWith('Consumo automático'))
      .reduce((s,m) => s + (m.valor || 0), 0);
    porDetalle.set(detalle, (porDetalle.get(detalle) || 0) + costoReg);
  });
  comprasDeOrden(orden, suborden).forEach(m => {
    const detalle = descripcionCompra(m) + ' — compra';
    porDetalle.set(detalle, (porDetalle.get(detalle) || 0) + (m.valor || 0));
  });
  return Array.from(porDetalle.entries()).map(([detalle, costo]) =>
    costo > 0 ? `${detalle} (${fmtCOPlocal(costo)})` : detalle
  );
}

// ---------- render: tablas y tableros ----------
export function renderOppRecent(){
  renderOppLista(DB.opp_ordenes.slice(0, 20));
  renderPrioridadOrdenes();
  renderPrioridadArea();
  renderEstadoOrdenes();
  renderOrdenesVivas();
  renderRadarHistorico();
}

export function tipoTrabajoLabel(o){
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

// ---------- prioridad de producción (arrastrar y soltar) ----------
// Menor prioridad = se muestra más arriba = se debe trabajar primero.
// Solo gerente/jefe de producción pueden reordenar; los demás solo ven la lista.
let prioridadDragOrden = null; // número de orden que se está arrastrando ahora mismo

function puedeReordenarPrioridad(){
  const user = getCurrentUser();
  return !!user && ROLES_REORDENAN_PRIORIDAD.includes(user.rol);
}

// Mismo grupo de roles (gerente/jefe de producción/admin) también puede
// cargar y editar el presupuesto de una orden.
function puedeEditarPresupuesto(){
  return puedeReordenarPrioridad();
}

function renderPrioridadOrdenes(){
  const cont = document.getElementById('opp-prioridad-list');
  if(!cont) return;
  const activas = DB.opp_ordenes
    .filter(ordenEnCurso)
    .sort((a,b) => (a.prioridad ?? 999999) - (b.prioridad ?? 999999));

  const puedeArrastrar = puedeReordenarPrioridad();
  document.getElementById('opp-prioridad-hint').textContent = puedeArrastrar
    ? 'Arrastra las filas (⠿) para cambiar el orden en que se deben trabajar.'
    : 'Solo el gerente o el jefe de producción pueden cambiar este orden.';

  if(!activas.length){
    cont.innerHTML = '<p style="color:var(--ink-faint);font-size:13px">No hay órdenes activas para priorizar.</p>';
    return;
  }

  cont.innerHTML = activas.map((o, i) => {
    const estado = estadoOrden(o);
    return `<div class="prioridad-row" data-orden="${o.orden}" draggable="${puedeArrastrar}">
      <span class="prioridad-handle">${puedeArrastrar ? '⠿' : '·'}</span>
      <span class="prioridad-num">${i + 1}</span>
      <span class="prioridad-info fila-clicable"><b>Orden ${o.orden}</b> — ${o.cliente || '—'} <span class="tipo-trabajo-chip">${tipoTrabajoLabel(o)}</span></span>
      ${estadoBadgeHTML(estado)}
    </div>`;
  }).join('');

  // El texto de cada fila abre el detalle completo — separado del arrastre,
  // que sigue funcionando desde cualquier parte de la fila con el ícono ⠿.
  cont.querySelectorAll('.prioridad-info').forEach(info => {
    info.addEventListener('click', () => {
      const orden = parseInt(info.closest('.prioridad-row').dataset.orden, 10);
      mostrarDetalleOrden(orden);
    });
  });

  if(!puedeArrastrar) return;

  cont.querySelectorAll('.prioridad-row').forEach(row => {
    row.addEventListener('dragstart', () => {
      prioridadDragOrden = parseInt(row.dataset.orden, 10);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      persistirPrioridad();
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      const enCurso = cont.querySelector('.dragging');
      if(!enCurso || enCurso === row) return;
      const rect = row.getBoundingClientRect();
      const despuesDelPunto = (e.clientY - rect.top) > rect.height / 2;
      row.parentNode.insertBefore(enCurso, despuesDelPunto ? row.nextSibling : row);
    });
  });
}

// Toma el orden visual actual del panel, le asigna 1..N, actualiza en
// memoria y guarda en Supabase. Se llama al soltar una fila.
async function persistirPrioridad(){
  const cont = document.getElementById('opp-prioridad-list');
  if(!cont) return;
  const ordenIds = Array.from(cont.querySelectorAll('.prioridad-row')).map(r => parseInt(r.dataset.orden, 10));
  const cambios = [];
  ordenIds.forEach((ordenId, i) => {
    const nuevaPrioridad = i + 1;
    const o = DB.opp_ordenes.find(x => x.orden === ordenId);
    if(o && o.prioridad !== nuevaPrioridad){
      o.prioridad = nuevaPrioridad;
      cambios.push({ orden: ordenId, prioridad: nuevaPrioridad });
    }
  });
  renderPrioridadOrdenes(); // repinta ya con los números 1..N correctos
  if(!cambios.length) return;
  try{
    await Promise.all(cambios.map(c => sb.from('opp_ordenes').update({ prioridad: c.prioridad }).eq('orden', c.orden)));
    toast('Prioridad actualizada');
  }catch(err){
    console.error(err);
    toast('No se pudo guardar el nuevo orden de prioridad — intenta de nuevo');
  }
}

// ---------- prioridad de producción POR ÁREA (cola independiente) ----------
// Distinta de "Prioridad de producción" (arriba, por ORDEN completa): acá
// se prioriza por SUBORDEN y ÁREA — una cola propia de, por ejemplo,
// "Litografía" con las piezas pendientes de esa área de TODAS las órdenes
// activas, sin importar cómo esté priorizada Troquelado o Terminado. No
// reemplaza la prioridad por orden — cuando una pieza todavía no se
// priorizó a mano en su área, cae de respaldo a la prioridad de su orden
// (y al número de suborden), igual que getPiezasPendientesPorPrioridad().
let prioridadAreaDragRow = null;

function nombresDeAreas(){
  return DB.areas.filter(a => a.activo !== false)
    .sort((a,b) => (a.orden ?? 999) - (b.orden ?? 999))
    .map(a => a.nombre);
}

function piezasPendientesDeArea(area){
  const filas = [];
  DB.opp_ordenes.filter(ordenEnCurso).forEach(o => {
    DB.opp_piezas.filter(p => p.orden === o.orden).forEach(p => {
      const requeridos = Array.isArray(p.procesos_requeridos) ? p.procesos_requeridos : [];
      if(!requeridos.includes(area)) return;
      if(areasCompletadasPorPieza(p).has(area)) return;
      filas.push({ o, p });
    });
  });
  const rangos = new Map(DB.prioridad_area.filter(x => x.area === area).map(x => [x.orden_prod + '-' + x.suborden, x.orden]));
  return filas.sort((a,b) => {
    const ra = rangos.has(a.o.orden + '-' + a.p.suborden) ? rangos.get(a.o.orden + '-' + a.p.suborden) : 999999;
    const rb = rangos.has(b.o.orden + '-' + b.p.suborden) ? rangos.get(b.o.orden + '-' + b.p.suborden) : 999999;
    return ra - rb || (a.o.prioridad ?? 999999) - (b.o.prioridad ?? 999999) || a.p.suborden - b.p.suborden;
  });
}

function poblarSelectPrioridadArea(){
  const sel = document.getElementById('opp-prioridad-area-select');
  if(!sel) return;
  const valorPrevio = sel.value;
  sel.innerHTML = nombresDeAreas().map(a => `<option value="${a}">${a}</option>`).join('');
  if(Array.from(sel.options).some(o => o.value === valorPrevio)) sel.value = valorPrevio;
}

// ---------- asignar operario a una pieza+área (desde Prioridad por área) ----------
// Cada fila de "Prioridad por área" ya es una suborden puntual pendiente de
// un área puntual — a diferencia de la asignación vieja "por orden completa"
// (que adivinaba sola cuál era "lo próximo pendiente" de toda la orden), acá
// el jefe/gerente asigna directamente sobre la fila que quiere, sin adivinar
// nada: tiene sentido porque las prioridades ya se manejan por suborden.

// Registro de producción "asignado, sin iniciar" (horaIni null) que ya
// exista para esta pieza+área — así se reasigna/quita en vez de duplicar.
function asignacionPendienteDeSuborden(orden, suborden, area){
  return DB.produccion.find(r => r.orden === orden && r.suborden === suborden && r.area === area && !r.horaIni && !r.horaFin) || null;
}

async function asignarOperarioASuborden(o, p, area, operarioNombre){
  const pendiente = asignacionPendienteDeSuborden(o.orden, p.suborden, area);
  const user = getCurrentUser();

  try{
    if(!operarioNombre){
      if(pendiente){
        const { error } = await sb.from('produccion').delete().eq('id', pendiente.id);
        if(error) throw error;
        const idx = DB.produccion.findIndex(r => r.id === pendiente.id);
        if(idx >= 0) DB.produccion.splice(idx, 1);
        toast('Asignación quitada');
      }
    } else if(pendiente){
      const { data, error } = await sb.from('produccion')
        .update({ operario: operarioNombre, asignado_por: user?.nombre || null })
        .eq('id', pendiente.id).select();
      if(error) throw error;
      const idx = DB.produccion.findIndex(r => r.id === pendiente.id);
      if(idx >= 0) DB.produccion[idx] = normProd(data[0]);
      toast('Reasignado a ' + operarioNombre);
    } else {
      const row = {
        fecha: fechaHoyLocal(), operario: operarioNombre, hora_ini: null, hora_fin: null,
        area, actividad: null, maquina: null,
        orden: o.orden, suborden: p.suborden, op: p.op,
        cliente: o.cliente, trabajo: p.pieza || null,
        opp: p.op || String(o.orden),
        asignado_por: user?.nombre || null
      };
      const { data, error } = await sb.from('produccion').insert([row]).select();
      if(error) throw error;
      DB.produccion.unshift(normProd(data[0]));
      toast(`Asignado a ${operarioNombre} — ${area} · ${p.pieza || 'Pieza ' + p.suborden}`);
    }
    renderPrioridadArea();
  }catch(err){
    console.error(err);
    toast('No se pudo guardar la asignación — revisa la consola');
    renderPrioridadArea();
  }
}

function renderPrioridadArea(){
  const sel = document.getElementById('opp-prioridad-area-select');
  const cont = document.getElementById('opp-prioridad-area-list');
  const hint = document.getElementById('opp-prioridad-area-hint');
  if(!sel || !cont) return;
  if(!sel.options.length) poblarSelectPrioridadArea();
  const area = sel.value;
  const puede = puedeReordenarPrioridad();
  if(hint) hint.textContent = puede
    ? 'Arrastra las filas (⠿) para priorizar el trabajo de esta área específica, cruzando todas las órdenes.'
    : 'Solo el gerente o el jefe de producción pueden cambiar este orden.';

  if(!area){ cont.innerHTML = '<p class="card-hint">No hay áreas cargadas todavía (Maestros &gt; Áreas).</p>'; return; }

  const filas = piezasPendientesDeArea(area);
  if(!filas.length){
    cont.innerHTML = '<p style="color:var(--ink-faint);font-size:13px">No hay piezas pendientes de esta área ahora mismo.</p>';
    return;
  }

  const operariosActivos = DB.personal.filter(p => p.activo !== false);

  cont.innerHTML = filas.map(({ o, p }, i) => {
    const pendiente = asignacionPendienteDeSuborden(o.orden, p.suborden, area);
    const selectorAsignar = puede ? `
      <div class="prioridad-asignar">
        <select class="prioridad-asignar-select" data-orden="${o.orden}" data-suborden="${p.suborden}">
          <option value="">— sin asignar —</option>
          ${operariosActivos.map(op => `<option value="${op.nombre}"${pendiente && pendiente.operario === op.nombre ? ' selected' : ''}>${op.nombre}</option>`).join('')}
        </select>
        ${pendiente ? `<span class="card-hint">asignada a ${pendiente.operario}</span>` : ''}
      </div>` : '';
    return `<div class="prioridad-row" data-orden="${o.orden}" data-suborden="${p.suborden}" draggable="${puede}">
      <span class="prioridad-handle">${puede ? '⠿' : '·'}</span>
      <span class="prioridad-num">${i + 1}</span>
      <span class="prioridad-info fila-clicable"><b>Orden ${o.orden}-${p.suborden}</b> — ${o.cliente || '—'} ${p.pieza ? '· ' + p.pieza : ''} <span class="tipo-trabajo-chip">${tipoTrabajoLabel(o)}</span></span>
      ${selectorAsignar}
    </div>`;
  }).join('');

  cont.querySelectorAll('.prioridad-info').forEach(info => {
    info.addEventListener('click', () => {
      const orden = parseInt(info.closest('.prioridad-row').dataset.orden, 10);
      mostrarDetalleOrden(orden);
    });
  });

  // El desplegable de asignar vive dentro de una fila arrastrable — sin
  // esto, intentar abrirlo dispara el drag-and-drop en vez de la lista.
  cont.querySelectorAll('.prioridad-asignar-select').forEach(sel => {
    sel.addEventListener('mousedown', e => e.stopPropagation());
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', () => {
      const orden = parseInt(sel.dataset.orden, 10);
      const suborden = parseInt(sel.dataset.suborden, 10);
      const o = DB.opp_ordenes.find(x => x.orden === orden);
      const p = DB.opp_piezas.find(x => x.orden === orden && x.suborden === suborden);
      if(!o || !p) return;
      sel.disabled = true;
      asignarOperarioASuborden(o, p, area, sel.value).finally(() => { sel.disabled = false; });
    });
  });

  if(!puede) return;
  cont.querySelectorAll('.prioridad-row').forEach(row => {
    row.addEventListener('dragstart', () => {
      prioridadAreaDragRow = row;
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      persistirPrioridadArea(area);
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      const enCurso = cont.querySelector('.dragging');
      if(!enCurso || enCurso === row) return;
      const rect = row.getBoundingClientRect();
      const despuesDelPunto = (e.clientY - rect.top) > rect.height / 2;
      row.parentNode.insertBefore(enCurso, despuesDelPunto ? row.nextSibling : row);
    });
  });
}

async function persistirPrioridadArea(area){
  const cont = document.getElementById('opp-prioridad-area-list');
  if(!cont) return;
  const filas = Array.from(cont.querySelectorAll('.prioridad-row')).map((row, i) => ({
    area,
    orden_prod: parseInt(row.dataset.orden, 10),
    suborden: parseInt(row.dataset.suborden, 10),
    orden: i + 1
  }));
  cont.querySelectorAll('.prioridad-num').forEach((el, i) => { el.textContent = i + 1; });
  if(!filas.length) return;
  try{
    const { data, error } = await sb.from('prioridad_area').upsert(filas, { onConflict: 'area,orden_prod,suborden' }).select();
    if(error) throw error;
    (data || []).forEach(row => {
      const idx = DB.prioridad_area.findIndex(x => x.area === row.area && x.orden_prod === row.orden_prod && x.suborden === row.suborden);
      if(idx >= 0) DB.prioridad_area[idx] = row; else DB.prioridad_area.push(row);
    });
    toast('Prioridad de ' + area + ' actualizada');
  }catch(err){
    console.error(err);
    toast('No se pudo guardar la prioridad de esta área — intenta de nuevo');
  }
}

// par etiqueta/valor para la ficha técnica del detalle de orden — se omite si no hay valor
export function filaFicha(label, value){
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
  const ordenes = DB.opp_ordenes.filter(ordenEnCurso).slice(0, 15);
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
    return `<div class="estado-orden fila-clicable" data-orden="${o.orden}">
      <div class="estado-orden-head"><b>Orden ${o.orden} — ${o.cliente || ''}</b>${estadoBadgeHTML(estado)}</div>
      ${filas}
    </div>`;
  }).join('') || '<p style="color:var(--ink-faint);font-size:13px">Sin piezas asociadas todavía.</p>';
  cont.querySelectorAll('.estado-orden[data-orden]').forEach(el => {
    el.addEventListener('click', () => mostrarDetalleOrden(parseInt(el.dataset.orden, 10)));
  });
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
    `<tr class="fila-clicable" data-orden="${orden}"><td>${orden}</td><td>${info.cliente || '—'}</td><td>${info.trabajo || '—'}</td><td>${info.fecha.slice(0,10)}</td></tr>`
  ).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-faint)">Sin actividad histórica en el último mes</td></tr>';
  document.querySelectorAll('#tbl-radar-historico tbody tr[data-orden]').forEach(tr => {
    tr.addEventListener('click', () => mostrarDetalleOrden(parseInt(tr.dataset.orden, 10)));
  });
}

let chartDetalle = null;
let ordenDetalleActual = null; // recuerda qué orden está abierta en el detalle, para el botón de imprimir

// Para que dashboard.js pueda refrescar SOLO si la orden que se acaba de
// corregir (Ajustar consumo, Corregir registro) es la que está abierta
// ahora mismo en "Detalle de la orden" — evita pisar el detalle de otra
// orden que el usuario pueda tener a la vista.
export function getOrdenDetalleActual(){ return ordenDetalleActual; }

// El botón "Ajustar" del Historial de producción abre "Corregir registro"
// (Operario), que vive en otro módulo/pestaña — ordenes.js no puede
// importar dashboard.js directo (dashboard.js ya importa de ordenes.js, y
// se generaría un ciclo), así que app.js inyecta acá el handler real una
// sola vez al arrancar.
let onAjustarConsumoCallback = null;
export function setAjustarConsumoHandler(fn){ onAjustarConsumoCallback = fn; }

// ---------- presupuesto vs. real, por orden ----------
function comparativoPresupuestoHTML(pres, costoReal, ingresoReal, costoMateriales){
  const totalCosto = (pres.total_costo != null) ? pres.total_costo : ((pres.costo || 0) + (pres.imprevistos || 0));
  const desviacion = totalCosto ? costoReal - totalCosto : null;
  const desviacionPct = totalCosto ? (desviacion / totalCosto * 100) : null;
  const margenEsperado = (pres.precio_venta_antes_iva != null && totalCosto != null) ? pres.precio_venta_antes_iva - totalCosto : null;
  const margenReal = (pres.precio_venta_antes_iva != null) ? pres.precio_venta_antes_iva - costoReal : null;
  const costoRealTotal = costoReal + (costoMateriales || 0);
  const margenRealTotal = (pres.precio_venta_antes_iva != null) ? pres.precio_venta_antes_iva - costoRealTotal : null;

  return [
    filaFicha('Costo total presupuestado', totalCosto ? fmtCOPlocal(totalCosto) : ''),
    filaFicha('Costo real (mano de obra)', fmtCOPlocal(costoReal)),
    filaFicha('Costo de materiales/compras', costoMateriales ? fmtCOPlocal(costoMateriales) : ''),
    filaFicha('Costo real total (mano de obra + materiales)', costoMateriales ? fmtCOPlocal(costoRealTotal) : ''),
    filaFicha('Desviación de costo', desviacion != null ? `${fmtCOPlocal(desviacion)} (${fmtNum(desviacionPct,1)}%)` : ''),
    filaFicha('Ingreso facturado real', ingresoReal ? fmtCOPlocal(ingresoReal) : ''),
    filaFicha('Rentabilidad esperada', pres.rentabilidad_esperada_pct != null ? fmtNum(pres.rentabilidad_esperada_pct,1) + '%' : ''),
    filaFicha('Margen esperado (presupuesto)', margenEsperado != null ? fmtCOPlocal(margenEsperado) : ''),
    filaFicha('Margen real estimado (vs. costo real)', margenReal != null ? fmtCOPlocal(margenReal) : ''),
    filaFicha('Margen real total (con materiales)', (costoMateriales && margenRealTotal != null) ? fmtCOPlocal(margenRealTotal) : '')
  ].join('') || '<p class="card-hint">Sin presupuesto cargado todavía para esta orden.</p>';
}

function wirePresupuestoOrden(orden, costoReal, ingresoReal, costoMateriales){
  const btn = document.getElementById('pres-guardar');
  if(!btn) return; // usuario sin permiso de edición — solo lectura
  btn.addEventListener('click', async () => {
    const costoVal = parseFloat(document.getElementById('pres-costo').value) || 0;
    const imprevistosVal = parseFloat(document.getElementById('pres-imprevistos').value) || 0;
    const precioSinIva = parseFloat(document.getElementById('pres-precio-sin-iva').value) || null;
    const precioConIva = parseFloat(document.getElementById('pres-precio-con-iva').value) || null;
    const totalCosto = costoVal + imprevistosVal;
    const rentabilidadPct = (precioSinIva && totalCosto) ? ((precioSinIva - totalCosto) / precioSinIva * 100) : null;

    const payload = {
      orden, costo: costoVal, imprevistos: imprevistosVal, total_costo: totalCosto,
      precio_venta_antes_iva: precioSinIva, precio_con_iva: precioConIva,
      rentabilidad_esperada_pct: rentabilidadPct, actualizado_en: new Date().toISOString()
    };

    btn.disabled = true; btn.textContent = 'Guardando…';
    try{
      const { error } = await sb.from('presupuesto_orden').upsert([payload]).select();
      if(error) throw error;
      const idx = DB.presupuesto_orden.findIndex(p => p.orden === orden);
      if(idx >= 0) DB.presupuesto_orden[idx] = payload; else DB.presupuesto_orden.push(payload);
      document.getElementById('pres-comparativo').innerHTML = comparativoPresupuestoHTML(payload, costoReal, ingresoReal, costoMateriales);
      const hint = document.getElementById('pres-guardado-hint');
      if(hint) hint.textContent = 'Presupuesto guardado ✓';
      toast('Presupuesto de la orden ' + orden + ' guardado');
    }catch(err){
      console.error(err);
      toast('No se pudo guardar el presupuesto — revisa la consola');
    }finally{
      btn.disabled = false; btn.textContent = 'Guardar presupuesto';
    }
  });
}

function ingresoDeOrden(orden){
  return DB.pedidos.filter(p => p.orden === orden).reduce((s,p)=>s+(p.total||0),0);
}

// Agrupa registros de producción por Área + Operario + Máquina. Antes se
// agrupaba solo por operario+máquina, pero la máquina física "Guillotina"
// está duplicada a propósito en dos áreas distintas (Corte inicial y
// Guillotina/corte final) — sin el área, un operario que trabajó en las dos
// quedaba mezclado en una sola fila, sumando horas/cantidad de dos procesos
// distintos.
function agruparAreaOpMaqRows(recs){
  const grupos = {};
  recs.forEach(r => {
    const area = r.area || 'General';
    const operario = r.operario || '—';
    const maquina = r.maquina || 'Manual';
    const k = area + '|' + operario + '|' + maquina;
    grupos[k] = grupos[k] || { area, operario, maquina, horas:0, cantidad:0 };
    grupos[k].horas += (r.tiempoHr||0);
    grupos[k].cantidad += (r.cantidad||0);
  });
  return Object.values(grupos).sort((a,b) =>
    a.area.localeCompare(b.area) || a.operario.localeCompare(b.operario) || a.maquina.localeCompare(b.maquina)
  );
}

function agruparPorAreaOperarioMaquina(recs){
  return agruparAreaOpMaqRows(recs)
    .map(v => `<tr><td>${v.area}</td><td>${v.operario} · ${v.maquina}</td><td class="num">${fmtNum(v.horas,2)}</td><td class="num">${fmtNum(v.cantidad,0)}</td></tr>`)
    .join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-faint)">Sin registros de producción aún</td></tr>';
}

function agruparPorAreaOperarioMaquinaPrint(recs){
  return agruparAreaOpMaqRows(recs)
    .map(v => `<tr><td>${v.area}</td><td>${v.operario} · ${v.maquina}</td><td>${fmtNum(v.horas,2)}</td><td>${fmtNum(v.cantidad,0)}</td></tr>`)
    .join('') || '<tr><td colspan="4">Sin registros de producción aún</td></tr>';
}

// A qué pieza pertenece un registro de producción — mismo criterio que se
// usa para agrupar (r.op === p.op, o si no hay OP, por suborden).
function piezaLabelDeRegistro(r, piezas){
  const p = piezas.find(pz => pz.op && pz.op === r.op) || piezas.find(pz => pz.suborden === r.suborden);
  if(p) return `${p.suborden}. ${p.pieza || 'Pieza'}`;
  return r.suborden != null ? `Suborden ${r.suborden}` : '—';
}

// Historial de TODO lo que pasó en la orden — un registro por cada
// actividad que un operario inició (no agrupado, a diferencia de la tabla
// de horas por área), del más reciente al más antiguo, con su comentario.
// Antes el comentario que el operario escribe al finalizar una actividad
// (ver js/registrar.js, .rc-comentario) se guardaba en produccion.comentario
// pero no se mostraba en ninguna parte — quedaba enterrado en la base.
function historialOrdenRows(registros){
  return [...registros].sort((a,b) => {
    const fa = (a.fecha||'') + ' ' + (a.horaIni||'');
    const fb = (b.fecha||'') + ' ' + (b.horaIni||'');
    return fb.localeCompare(fa);
  });
}

function estadoRegistroHTML(r){
  const chips = [];
  if(!r.horaIni) chips.push(`<span class="estado-chip pending">📌 asignada, sin iniciar${r.asignadoPor ? ' — por ' + r.asignadoPor : ''}</span>`);
  else if(!r.horaFin) chips.push('<span class="estado-chip estado-chip-warn">⏱ en curso</span>');
  else if(r.procesoCompleto === false) chips.push(`<span class="estado-chip estado-chip-warn">⏸ pausa${r.motivoPausa ? ' — ' + r.motivoPausa : ''}</span>`);
  else chips.push('<span class="estado-chip done">✓ terminado</span>');
  if(r.reproceso === 'Si') chips.push('<span class="estado-chip pending">↺ reproceso</span>');
  if(r.numeroRemision) chips.push(`<span class="estado-chip done">🚚 remisión ${r.numeroRemision}</span>`);
  return chips.join(' ');
}

function historialOrdenHTML(registros, piezas){
  if(!registros.length) return '<p class="card-hint">Todavía no hay registros de producción para esta orden.</p>';
  const puedeAjustar = puedeEditarProduccion();
  const filas = historialOrdenRows(registros).map(r => `<tr>
      <td>${(r.fecha||'').slice(0,10)}${r.horaIni ? ' ' + r.horaIni.slice(0,5) : ''}${r.horaFin ? ' – ' + r.horaFin.slice(0,5) : ''}</td>
      <td>${piezaLabelDeRegistro(r, piezas)}</td>
      <td>${r.area || '—'}</td>
      <td>${r.subproceso || '—'}</td>
      <td>${r.actividad || '—'}</td>
      <td>${r.operario || '—'}</td>
      <td>${r.maquina || 'Manual'}</td>
      <td class="num">${r.tiempoHr != null ? fmtNum(r.tiempoHr,2) : '—'}</td>
      <td class="num">${r.cantidad != null ? fmtNum(r.cantidad,0) : '—'}</td>
      <td>${r.materiaPrima || '—'}</td>
      <td>${r.consumoMP || '—'}</td>
      <td>${estadoRegistroHTML(r)}</td>
      <td>${r.comentario || ''}</td>
      ${puedeAjustar ? `<td><button type="button" class="row-btn" data-ajustar="${r.id}">Ajustar</button></td>` : ''}
    </tr>`).join('');
  return `<div class="table-wrap"><table class="detalle-mini-table">
    <thead><tr><th>Fecha / hora</th><th>Pieza</th><th>Área</th><th>Subproceso</th><th>Actividad</th><th>Operario</th><th>Máquina</th><th>Horas</th><th>Cant.</th><th>Materia prima</th><th>Consumo</th><th>Estado</th><th>Comentario</th>${puedeAjustar ? '<th></th>' : ''}</tr></thead>
    <tbody>${filas}</tbody>
  </table></div>`;
}

export function mostrarDetalleOrden(orden){
  const o = DB.opp_ordenes.find(x => x.orden === orden);
  if(!o){
    toast('La orden ' + orden + ' es histórica (viene del Excel migrado) y no tiene ficha de detalle en OPP');
    return;
  }
  const piezas = DB.opp_piezas.filter(p => p.orden === orden).sort((a,b)=>a.suborden-b.suborden);
  const registros = DB.produccion.filter(r => r.orden === orden);
  const estado = estadoOrden(o);
  const ingreso = ingresoDeOrden(orden);
  const costo = registros.reduce((s,r)=>s+(r.valorActividad||0),0);
  const costoMateriales = costoMaterialesDeOrden(orden);

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

    const materiales = materialesConsumidosConCosto(recsPieza, orden, p.suborden);

    const ficha = [
      filaFicha('OP', p.op),
      filaFicha('Tamaño terminado', (p.tamano_ancho || p.tamano_alto) ? `${fmtNum(p.tamano_ancho,1)} x ${fmtNum(p.tamano_alto,1)} cm` : ''),
      filaFicha('Papel', p.papel),
      filaFicha('Tintas frente/atrás', p.tintas_frente != null ? `${p.tintas_frente} x ${p.tintas_atras || 0}` : ''),
      filaFicha('Detalle tintas — Tiro', p.tintas_detalle_tiro),
      filaFicha('Detalle tintas — Retiro', p.tintas_detalle_retiro),
      filaFicha('CTP', p.ctp),
      filaFicha('Impresión / Tipo de montaje', p.tira_retira),
      filaFicha('Giro', p.giro),
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

    const filasOM = agruparPorAreaOperarioMaquina(recsPieza);

    return `<div class="detalle-pieza-card">
      <div class="detalle-pieza-head">
        <b>${p.pieza || ('Pieza ' + p.suborden)}</b>
        <span class="card-hint">${p.cantidad ? fmtNum(p.cantidad,0)+' uds solicitadas' : ''}</span>
      </div>
      <div class="detalle-ficha-grid">${ficha}</div>
      <div class="detalle-pieza-chips">${chips}</div>
      ${materiales.length ? `<div class="detalle-pieza-materiales"><b>Materiales consumidos:</b> ${materiales.join(' · ')}</div>` : ''}
      <table class="detalle-mini-table">
        <thead><tr><th>Área</th><th>Operario · Máquina</th><th class="num">Horas</th><th class="num">Cantidad</th></tr></thead>
        <tbody>${filasOM}</tbody>
      </table>
    </div>`;
  }).join('') || '<p class="card-hint">Esta orden no tiene piezas registradas (probablemente migrada del histórico sin detalle de OPP).</p>';

  // Compras/costos que se asociaron a la orden completa desde "Registrar
  // costo" pero sin marcarle una pieza puntual — no aparecen dentro de
  // ninguna tarjeta de pieza (ver materialesConsumidosConCosto), así que se
  // listan acá una sola vez para no perderlas.
  const comprasSinPieza = comprasDeOrden(orden, null);
  const comprasSinPiezaHTML = comprasSinPieza.length
    ? `<div class="detalle-orden-obs"><b>Materiales/costos comprados para toda la orden</b> <span class="card-hint">(sin pieza puntual asignada)</span><br>${comprasSinPieza.map(m => `${descripcionCompra(m)} (${fmtCOPlocal(m.valor||0)})`).join(' · ')}</div>`
    : '';

  const pres = DB.presupuesto_orden.find(p => p.orden === orden) || {};
  const puedeEditar = puedeEditarPresupuesto();
  const dis = puedeEditar ? '' : 'disabled';
  const ingresoPresupuestado = pres.precio_venta_antes_iva != null ? pres.precio_venta_antes_iva : null;
  // Mismo criterio que la tabla "Rentabilidad por orden" del Gerencial (punto
  // 3 de AjustesERP): si no hay ingreso facturado, se usa el presupuestado
  // para no mostrar un margen negativo sin sentido. El margen también debe
  // descontar el costo de materiales/compras con esta orden asociada (punto
  // 10) — antes solo restaba mano de obra, así que una orden con compras de
  // materia prima ya cargadas mostraba un margen que no las reflejaba.
  const ingresoBase = ingreso > 0 ? ingreso : (ingresoPresupuestado || 0);
  const margen = (ingresoBase || costo || costoMateriales) ? (ingresoBase - costo - costoMateriales) : null;

  document.getElementById('opp-detalle-body').innerHTML = `
    <div class="kpi-row" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">Estado</div><div class="val" style="font-size:16px">${o.cliente||'—'}</div><div class="sub">${o.producto||''} · ${(o.fecha||'').slice(0,10)}</div></div>
      <div class="kpi"><div class="lbl">Ingreso facturado</div><div class="val">${fmtCOPlocal(ingreso)}</div><div class="sub">${ingreso>0 ? 'según pedidos' : (ingresoPresupuestado ? 'en $0 — el margen usa el presupuestado' : 'según pedidos')}</div></div>
      <div class="kpi"><div class="lbl">Ingreso presupuestado</div><div class="val">${ingresoPresupuestado!=null ? fmtCOPlocal(ingresoPresupuestado) : '—'}</div><div class="sub">precio venta antes de IVA</div></div>
      <div class="kpi"><div class="lbl">Costo mano de obra</div><div class="val">${fmtCOPlocal(costo)}</div><div class="sub">${registros.length} registros de producción</div></div>
      <div class="kpi"><div class="lbl">Otros costos</div><div class="val">${fmtCOPlocal(costoMateriales)}</div><div class="sub">materiales/compras con esta orden asociada</div></div>
      <div class="kpi"><div class="lbl">Margen</div><div class="val ${margen==null?'':(margen>=0?'pos':'neg')}">${margen==null?'—':fmtCOPlocal(margen)}</div><div class="sub">${estadoBadgeHTML(estado)}</div></div>
    </div>
    ${areas.length ? '<canvas id="chart-detalle-area" height="90" style="margin-bottom:16px"></canvas>' : ''}
    ${o.observaciones ? `<div class="detalle-orden-obs"><b>Observaciones de la orden:</b> ${o.observaciones}</div>` : ''}
    ${comprasSinPiezaHTML}

    <div class="card presupuesto-card" style="margin:0 0 16px">
      <div class="card-head"><h3>Presupuesto vs. Real</h3><span class="card-hint">${puedeEditar ? 'como lo entrega el gerente a producción' : 'solo gerente/jefe de producción pueden editar estos valores'}</span></div>
      <div class="form-row">
        <div class="field"><label>Costo</label><input type="number" id="pres-costo" min="0" ${dis} value="${pres.costo ?? ''}"></div>
        <div class="field"><label>Imprevistos</label><input type="number" id="pres-imprevistos" min="0" ${dis} value="${pres.imprevistos ?? ''}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Precio venta antes de IVA</label><input type="number" id="pres-precio-sin-iva" min="0" ${dis} value="${pres.precio_venta_antes_iva ?? ''}"></div>
        <div class="field"><label>Precio con IVA</label><input type="number" id="pres-precio-con-iva" min="0" ${dis} value="${pres.precio_con_iva ?? ''}"></div>
      </div>
      ${puedeEditar ? `<div class="form-foot"><span id="pres-guardado-hint" class="card-hint"></span><button type="button" class="btn-primary" id="pres-guardar">Guardar presupuesto</button></div>` : ''}
      <div class="detalle-ficha-grid" id="pres-comparativo" style="margin-top:12px">${comparativoPresupuestoHTML(pres, costo, ingreso, costoMateriales)}</div>
    </div>

    <div class="detalle-piezas-grid">${piezasHTML}</div>

    <div class="card" style="margin:16px 0 0">
      <div class="card-head"><h3>Historial de producción</h3><span class="card-hint">todos los registros de esta orden, con comentarios — del más reciente al más antiguo</span></div>
      ${historialOrdenHTML(registros, piezas)}
    </div>
  `;

  wirePresupuestoOrden(orden, costo, ingreso, costoMateriales);

  document.querySelectorAll('#opp-detalle-body [data-ajustar]').forEach(btn => {
    btn.addEventListener('click', () => {
      if(onAjustarConsumoCallback) onAjustarConsumoCallback(parseInt(btn.dataset.ajustar, 10));
    });
  });

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

function estadoRegistroTexto(r){
  const partes = [];
  if(!r.horaIni) partes.push('asignada, sin iniciar' + (r.asignadoPor ? ' (por ' + r.asignadoPor + ')' : ''));
  else if(!r.horaFin) partes.push('en curso');
  else if(r.procesoCompleto === false) partes.push('pausa' + (r.motivoPausa ? ' — ' + r.motivoPausa : ''));
  else partes.push('terminado');
  if(r.reproceso === 'Si') partes.push('reproceso');
  return partes.join(' · ');
}

function historialOrdenPrintHTML(registros, piezas){
  if(!registros.length) return '';
  const filas = historialOrdenRows(registros).map(r => `<tr>
      <td>${(r.fecha||'').slice(0,10)}${r.horaIni ? ' ' + r.horaIni.slice(0,5) : ''}${r.horaFin ? ' – ' + r.horaFin.slice(0,5) : ''}</td>
      <td>${piezaLabelDeRegistro(r, piezas)}</td>
      <td>${r.area || '—'}</td>
      <td>${r.subproceso || '—'}</td>
      <td>${r.actividad || '—'}</td>
      <td>${r.operario || '—'}</td>
      <td>${r.materiaPrima || '—'}${r.consumoMP ? ' — ' + r.consumoMP : ''}</td>
      <td>${estadoRegistroTexto(r)}</td>
      <td>${r.comentario || ''}</td>
    </tr>`).join('');
  return `<h3>Historial de producción</h3>
  <table class="historial-print">
    <thead><tr><th>Fecha / hora</th><th>Pieza</th><th>Área</th><th>Subproceso</th><th>Actividad</th><th>Operario</th><th>Materia prima</th><th>Estado</th><th>Comentario</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>`;
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
    // white-space:nowrap por proceso — si no, al imprimir el navegador puede
    // cortar la línea justo entre el ☐/✓ y el nombre del proceso, y quedan
    // en renglones (o páginas) distintos.
    const procesosTxt = requeridos.map(a => `<span style="white-space:nowrap">${completados.has(a) ? '✓' : '☐'} ${a}</span>`).join('&nbsp;&nbsp;&nbsp;') || 'sin procesos definidos';
    const materiales = [...new Set(recsPieza.map(r => [r.materiaPrima, r.consumoMP].filter(Boolean).join(' — ')).filter(Boolean))];

    const filasOM = agruparPorAreaOperarioMaquinaPrint(recsPieza);

    const ficha = [
      ['OP', p.op],
      ['Tamaño terminado', (p.tamano_ancho || p.tamano_alto) ? `${fmtNum(p.tamano_ancho,1)} x ${fmtNum(p.tamano_alto,1)} cm` : ''],
      ['Papel', p.papel],
      ['Tintas frente/atrás', p.tintas_frente != null ? `${p.tintas_frente} x ${p.tintas_atras || 0}` : ''],
      ['Detalle tintas — Tiro', p.tintas_detalle_tiro],
      ['Detalle tintas — Retiro', p.tintas_detalle_retiro],
      ['CTP', p.ctp],
      ['Impresión / Tipo de montaje', p.tira_retira],
      ['Giro', p.giro],
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
        <thead><tr><th>Área</th><th>Operario · Máquina</th><th>Horas</th><th>Cantidad</th></tr></thead>
        <tbody>${filasOM}</tbody>
      </table>
    </div>`;
  }).join('') || '<p>Esta orden no tiene piezas registradas (probablemente migrada del histórico sin detalle de OPP).</p>';

  const historialHTML = historialOrdenPrintHTML(registros, piezas);

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
  .historial-print{ page-break-inside: avoid; }
  @media print{ body{ margin:10mm; } }
</style>
</head><body>
  <h1>Orden de producción ${orden}</h1>
  <div class="sub">${o.cliente || '—'} ${o.producto ? '· ' + o.producto : ''} · ${tipoTrabajoLabel(o)} · ${(o.fecha||'').slice(0,10)} · Estado: ${estado.label}${estado.pct!=null ? ' (' + estado.pct + '%)' : ''}</div>
  ${o.observaciones ? `<p><b>Observaciones:</b> ${o.observaciones}</p>` : ''}
  ${piezasHTML}
  ${historialHTML}
</body></html>`;

  const w = window.open('', '_blank');
  if(!w){ toast('El navegador bloqueó la ventana de impresión — permite ventanas emergentes para este sitio'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

// ---------- crear / editar / duplicar / cancelar ----------
// ============================================================
// IMPORTAR ORDEN DESDE EXCEL
// Lee un archivo .xlsx con el formato "formulario" que usa
// producción (bloques de columnas repetidos, uno por pieza) y
// llena el formulario de arriba — NO guarda nada solo, siempre
// hay que revisar y darle click a "Guardar orden completa". Este
// formato es el de Litografía (papel, pliego, tintas, troquelado…).
// ============================================================

function normalizarTexto(s){
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Busca la primera fila (desde `desde`) donde alguna de las primeras
// columnas contenga una de las etiquetas dadas (ej. "Cliente", "Orden").
// No asume en qué columna exacta está la etiqueta porque cambia de un
// archivo a otro según cómo estén combinadas las celdas.
function buscarFila(grid, etiquetas, desde = 0){
  const objetivo = etiquetas.map(normalizarTexto);
  for(let i = desde; i < grid.length; i++){
    const fila = grid[i] || [];
    for(let c = 0; c < Math.min(fila.length, 5); c++){
      if(objetivo.includes(normalizarTexto(fila[c]))) return i;
    }
  }
  return -1;
}

function valorCelda(grid, fila, col){
  if(fila < 0 || col < 0) return null;
  const v = (grid[fila] || [])[col];
  return (v === undefined || v === '') ? null : v;
}

function leerArchivoComoGrid(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try{
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }));
      }catch(err){ reject(err); }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsArrayBuffer(file);
  });
}

// Detecta en qué columnas empieza cada "bloque" (cada pieza/suborden)
// usando la fila de "Orden" como referencia: cada valor numérico en
// esa fila marca el inicio de un bloque de 3 columnas.
function columnasDeBloque(grid, filaOrden){
  const fila = grid[filaOrden] || [];
  const cols = [];
  for(let c = 0; c < fila.length; c++){
    const v = fila[c];
    if(v !== null && v !== '' && !isNaN(parseFloat(v))) cols.push(c);
  }
  return cols;
}

function extraerPiezasDelGrid(grid){
  const filaOrden = buscarFila(grid, ['Orden']);
  if(filaOrden === -1){
    throw new Error('No encontré la fila "Orden" en el archivo. ¿Es el formato de orden de producción que usa planta?');
  }
  const cols = columnasDeBloque(grid, filaOrden);
  if(!cols.length){
    throw new Error('Encontré la fila "Orden" pero no logré leer ningún número de orden en ella.');
  }

  const filaCliente = buscarFila(grid, ['Cliente']);
  const filaSuborden = buscarFila(grid, ['SubOrden', 'Sub Orden', 'Sub orden']);
  const filaProducto = buscarFila(grid, ['Producto']);
  const filaPieza = buscarFila(grid, ['Piezas', 'Pieza']);
  const filaCantidad = buscarFila(grid, ['Cantidad']);
  const filaTamano = buscarFila(grid, ['Tamaño', 'Tamano']);
  const filaPapel = buscarFila(grid, ['Papel']);
  const filaTintas = buscarFila(grid, ['Tintas']);
  const filaCtp = buscarFila(grid, ['Ctp']);
  const filaLaminados = buscarFila(grid, ['Laminados']);
  const filaBarniz = buscarFila(grid, ['Barniz UV']);
  const filaTroquelado = buscarFila(grid, ['Troquelado']);
  const filaTroquel = buscarFila(grid, ['Troquel']);
  const filaTalonarios = buscarFila(grid, ['Talonarios']);
  const filaOtros = buscarFila(grid, ['Otros']);
  const filaUnidadesMontaje = buscarFila(grid, ['Unidades Por Montaje', 'Unidades por Montaje']);
  const filaTamProgramados = buscarFila(grid, ['Tamaños Programados', 'Tamanos Programados']);
  const filaMedidas = buscarFila(grid, ['Medidas Tamaño', 'Medida Tamaño', 'Medidas Tamano']);
  const filaTamPorPliego = buscarFila(grid, ['Tamaños por pliego', 'Tamanos por pliego']);
  // filas del presupuesto que trae el Excel (parte de abajo, "ITEMS" sub-total)
  const filaCosto = buscarFila(grid, ['Costo']);
  const filaImprevistos = buscarFila(grid, ['Imprevistos']);
  const filaPrecioVentaSinIva = buscarFila(grid, ['Precio Venta Antes De Iva', 'Precio Venta Antes de IVA']);
  const filaPrecioConIva = buscarFila(grid, ['Precio Total Con Iva', 'Precio Total Con IVA']);

  const bloques = cols.map(c => {
    const otrosLineas = [];
    if(filaOtros !== -1){
      for(let r = filaOtros; r < filaOtros + 3 && r < grid.length; r++){
        const v = valorCelda(grid, r, c);
        if(v) otrosLineas.push(String(v).trim());
      }
    }
    // "Tintas" a veces no trae un número limpio (ej. "2 (cm)") sino una
    // nota descriptiva — si pasa, se guarda el texto tal cual en el
    // detalle de tintas, en vez de perderlo intentando forzarlo a número.
    const esNumeroLimpio = v => v != null && /^-?\d+(\.\d+)?$/.test(String(v).trim());
    const tintasFrenteRaw = valorCelda(grid, filaTintas, c);
    const tintasAtrasRaw = valorCelda(grid, filaTintas, c + 2);
    const tintasLimpias = esNumeroLimpio(tintasFrenteRaw) && esNumeroLimpio(tintasAtrasRaw);

    return {
      cliente: valorCelda(grid, filaCliente, c),
      orden: valorCelda(grid, filaOrden, c),
      suborden: valorCelda(grid, filaSuborden, c),
      producto: valorCelda(grid, filaProducto, c),
      pieza: valorCelda(grid, filaPieza, c),
      cantidad: valorCelda(grid, filaCantidad, c),
      tamano_ancho: valorCelda(grid, filaTamano, c),
      tamano_alto: valorCelda(grid, filaTamano, c + 2),
      papel: valorCelda(grid, filaPapel, c),
      tintas_frente: tintasLimpias ? parseFloat(tintasFrenteRaw) : null,
      tintas_atras: tintasLimpias ? parseFloat(tintasAtrasRaw) : null,
      tintas_detalle_tiro: tintasLimpias ? null : `Según Excel: ${tintasFrenteRaw ?? '—'}`,
      tintas_detalle_retiro: tintasLimpias ? null : `Según Excel: ${tintasAtrasRaw ?? '—'}`,
      ctp: valorCelda(grid, filaCtp, c) || 'Convencional',
      laminado: valorCelda(grid, filaLaminados, c),
      laminado_lados: valorCelda(grid, filaLaminados, c + 2),
      barniz_uv: !!valorCelda(grid, filaBarniz, c),
      troquelado: !!valorCelda(grid, filaTroquelado, c),
      troquel_detalle: valorCelda(grid, filaTroquel, c),
      talonarios: !!valorCelda(grid, filaTalonarios, c),
      otros_acabados: otrosLineas.length ? otrosLineas.join(', ') : null,
      unidades_por_montaje: valorCelda(grid, filaUnidadesMontaje, c) || 1,
      tamanos_programados: valorCelda(grid, filaTamProgramados, c),
      medida_tamano_ancho: valorCelda(grid, filaMedidas, c),
      medida_tamano_alto: valorCelda(grid, filaMedidas, c + 2),
      tamanos_por_pliego: valorCelda(grid, filaTamPorPliego, c),
      costo: valorCelda(grid, filaCosto, c),
      imprevistos: valorCelda(grid, filaImprevistos, c),
      precio_venta_antes_iva: valorCelda(grid, filaPrecioVentaSinIva, c),
      precio_con_iva: valorCelda(grid, filaPrecioConIva, c)
    };
  }).filter(b => b.orden != null && !isNaN(parseFloat(b.orden)));

  return bloques;
}

// Llena el formulario con las piezas ya interpretadas — el usuario
// sigue teniendo que revisar y darle "Guardar orden completa". El
// formato importado es siempre de Litografía.
function aplicarImportacion(ordenNum, piezas){
  const yaExiste = DB.opp_ordenes.some(o => o.orden === ordenNum);
  editingOrden = yaExiste ? ordenNum : null;
  document.getElementById('opp-form-mode').textContent = yaExiste
    ? `Importado desde Excel — la orden ${ordenNum} ya existía, esto va a ACTUALIZARLA. Revisa antes de guardar`
    : 'Importado desde Excel — revisa los datos antes de guardar';
  document.getElementById('opp-orden').value = ordenNum;
  document.getElementById('opp-orden').disabled = false;
  document.getElementById('opp-fecha').value = fechaHoyLocal();
  setValSafe('opp-tipo-trabajo', 'Litografia');
  aplicarTipoTrabajo();

  const cliente = piezas[0] && piezas[0].cliente ? String(piezas[0].cliente).trim() : '';
  ensureOptionExists(document.getElementById('opp-cliente'), cliente);

  const producto = piezas[0] && piezas[0].producto ? String(piezas[0].producto).trim() : '';
  ensureOptionExists(document.getElementById('opp-producto'), producto);
  renderProductoRef();
  refreshPiezasDatalist();

  document.getElementById('opp-piezas-list').innerHTML = '';
  oppPiezaCount = 0;
  piezas.forEach(p => addPiezaCard({
    pieza: p.pieza,
    cantidad: p.cantidad,
    tamano_ancho: p.tamano_ancho,
    tamano_alto: p.tamano_alto,
    papel: p.papel ? String(p.papel).trim() : '',
    tintas_frente: p.tintas_frente,
    tintas_atras: p.tintas_atras,
    tintas_detalle_tiro: p.tintas_detalle_tiro,
    tintas_detalle_retiro: p.tintas_detalle_retiro,
    ctp: p.ctp,
    laminado: p.laminado,
    laminado_lados: p.laminado_lados,
    barniz_uv: p.barniz_uv,
    troquelado: p.troquelado,
    troquel_detalle: p.troquel_detalle,
    talonarios: p.talonarios,
    otros_acabados: p.otros_acabados,
    unidades_por_montaje: p.unidades_por_montaje,
    medida_tamano_ancho: p.medida_tamano_ancho,
    medida_tamano_alto: p.medida_tamano_alto,
    tamanos_por_pliego: p.tamanos_por_pliego,
    tamanos_programados: p.tamanos_programados
  }));

  // El presupuesto (Costo/Imprevistos/Precio de venta) viene en el mismo
  // Excel, más abajo — se suma entre todas las piezas de esta orden y
  // queda lista para guardarse apenas se guarde la orden.
  const sumar = campo => piezas.reduce((s, p) => s + (parseFloat(p[campo]) || 0), 0);
  presupuestoPendienteImportacion = {
    orden: ordenNum,
    costo: sumar('costo'),
    imprevistos: sumar('imprevistos'),
    precio_venta_antes_iva: sumar('precio_venta_antes_iva'),
    precio_con_iva: sumar('precio_con_iva')
  };
  const hayPresupuesto = presupuestoPendienteImportacion.costo || presupuestoPendienteImportacion.precio_venta_antes_iva;

  const avisoExiste = yaExiste ? ` ⚠️ La orden ${ordenNum} ya existía — al guardar se van a REEMPLAZAR sus piezas actuales por las del Excel.` : '';
  toast((hayPresupuesto
    ? `Se leyeron ${piezas.length} pieza(s) de la orden ${ordenNum} — el presupuesto también se leyó y se guardará junto con la orden`
    : `Se leyeron ${piezas.length} pieza(s) de la orden ${ordenNum} — revísalas antes de guardar`) + avisoExiste);
  document.getElementById('panel-ordenes').scrollIntoView({ behavior: 'smooth' });
}

async function importarOrdenExcel(file){
  const grid = await leerArchivoComoGrid(file);
  const bloques = extraerPiezasDelGrid(grid);
  if(!bloques.length){
    throw new Error('No encontré ninguna pieza reconocible en el archivo.');
  }

  const ordenesDistintas = [...new Set(bloques.map(b => Math.round(parseFloat(b.orden))))];
  let ordenElegida = ordenesDistintas[0];

  if(ordenesDistintas.length > 1){
    const resp = prompt(
      'Este archivo tiene varias órdenes: ' + ordenesDistintas.join(', ') +
      '.\nEscribe cuál quieres importar (se importa una a la vez):',
      ordenesDistintas[0]
    );
    if(resp == null) return; // el usuario canceló
    ordenElegida = parseInt(resp, 10);
    if(!ordenesDistintas.includes(ordenElegida)){
      toast('Ese número de orden no está en el archivo');
      return;
    }
  }

  const piezas = bloques
    .filter(b => Math.round(parseFloat(b.orden)) === ordenElegida)
    .sort((a, b) => (parseFloat(a.suborden) || 0) - (parseFloat(b.suborden) || 0));

  const existente = DB.opp_ordenes.find(o => o.orden === ordenElegida);
  if(existente){
    const piezasActuales = DB.opp_piezas.filter(p => p.orden === ordenElegida).length;
    const reemplazar = confirm(
      `La orden ${ordenElegida} ya existe en el sistema (${existente.cliente || 'sin cliente'} — ${piezasActuales} pieza(s) guardadas actualmente).\n\n` +
      `¿Qué quieres hacer?\n\n` +
      `Aceptar = REEMPLAZAR la orden guardada con los datos de este Excel (se pierden los datos actuales de esa orden).\n` +
      `Cancelar = CONSERVAR la orden como está — no se importa nada.`
    );
    if(!reemplazar){
      toast(`Se conservó la orden ${ordenElegida} tal como estaba — no se importó nada`);
      return;
    }
  }

  aplicarImportacion(ordenElegida, piezas);
}

function resetOppForm(nextOrden){
  editingOrden = null;
  presupuestoPendienteImportacion = null;
  document.getElementById('opp-form-mode').textContent = 'Creando una orden nueva';
  document.getElementById('opp-piezas-list').innerHTML = '';
  oppPiezaCount = 0;
  document.getElementById('opp-cliente').value = '';
  document.getElementById('opp-producto').value = '';
  refreshPiezasDatalist();
  document.getElementById('opp-cliente-nuevo-wrap').style.display = 'none';
  document.getElementById('opp-producto-nuevo-wrap').style.display = 'none';
  document.getElementById('opp-producto-ref').style.display = 'none';
  document.getElementById('opp-orden').value = nextOrden != null ? nextOrden : suggestNextOrden();
  document.getElementById('opp-orden').disabled = false;
  document.getElementById('opp-fecha').value = fechaHoyLocal();
  document.getElementById('opp-observaciones').value = '';
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
  document.getElementById('opp-observaciones').value = o.observaciones || '';
  ensureOptionExists(document.getElementById('opp-cliente'), o.cliente || '');
  ensureOptionExists(document.getElementById('opp-producto'), o.producto || '');
  document.getElementById('opp-fecha').value = (o.fecha || '').slice(0,10) || fechaHoyLocal();
  setValSafe('opp-tipo-trabajo', o.tipo_trabajo || 'Litografia');
  aplicarTipoTrabajo();
  renderProductoRef();
  refreshPiezasDatalist();

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
  document.getElementById('opp-fecha').value = fechaHoyLocal();
  document.getElementById('opp-observaciones').value = ''; // observación es de la orden original, no aplica igual a la copia
  setValSafe('opp-tipo-trabajo', o.tipo_trabajo || 'Litografia');
  aplicarTipoTrabajo();
  renderProductoRef();
  refreshPiezasDatalist();

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
  if(onOrdenesChangeCallback) onOrdenesChangeCallback();
}

// Punto 13 de AjustesERP: al ingresar la orden, avisa si el papel que se
// necesita no alcanza con el stock que hay cargado en Materias primas.
// Es una alerta, no bloquea el guardado — la orden se guarda igual, esto
// es solo para que se note a tiempo que hay que comprar.
//
// Solo se compara contra materiales "en seguimiento" (con stock_actual o
// stock_minimo mayor a 0 ya configurado en Maestros) — de lo contrario los
// 226 papeles precargados en 0/0 dispararían la alerta en cada orden.
//
// Además del aviso inmediato (alert()), queda GUARDADA en
// alertas_faltante_material — así sigue visible en Alertas aunque se
// cierre el mensaje, hasta que alguien reponga el stock de esa materia
// prima (ver materiasCtl en js/maestros.js, que la resuelve sola). Cada
// guardado de la orden reemplaza sus alertas anteriores por las actuales
// (si ya no falta, o falta menos, no debe quedar una alerta vieja colgada).
async function alertarStockPapelInsuficiente(orden, piezasPayload){
  const necesidad = {};
  piezasPayload.forEach(p => {
    if(!p.papel || !p.pliegos) return;
    necesidad[p.papel] = (necesidad[p.papel] || 0) + p.pliegos;
  });
  const faltantes = Object.entries(necesidad).map(([papel, pliegosNecesarios]) => {
    const mat = DB.materias_primas.find(m => m.nombre === papel);
    if(!mat || !((mat.stock_actual||0) > 0 || (mat.stock_minimo||0) > 0)) return null; // no está en seguimiento
    const stock = mat.stock_actual || 0;
    return { mat, papel, pliegosNecesarios, stock, unidad: mat.unidad || 'pliegos', falta: pliegosNecesarios - stock };
  }).filter(f => f && f.falta > 0);

  if(faltantes.length){
    const detalle = faltantes.map(f => `• ${f.papel}: hay ${fmtNum(f.stock,0)}, se necesitan ${fmtNum(f.pliegosNecesarios,0)} ${f.unidad} (faltan ${fmtNum(f.falta,0)})`).join('\n');
    alert(`⚠️ Stock insuficiente para esta orden — considera comprar:\n\n${detalle}`);
  }

  try{
    // limpia lo que esta orden tenía guardado antes — se vuelve a armar
    // desde cero con los faltantes actuales.
    const previas = DB.alertas_faltante_material.filter(a => a.orden === orden);
    if(previas.length){
      await sb.from('alertas_faltante_material').delete().eq('orden', orden);
      previas.forEach(a => {
        const idx = DB.alertas_faltante_material.indexOf(a);
        if(idx >= 0) DB.alertas_faltante_material.splice(idx, 1);
      });
    }
    if(faltantes.length){
      const rows = faltantes.map(f => ({
        orden, materia_prima_codigo: f.mat.codigo, cantidad_faltante: f.falta, unidad: f.unidad
      }));
      const { data, error } = await sb.from('alertas_faltante_material').insert(rows).select();
      if(error) throw error;
      DB.alertas_faltante_material.push(...(data || []));
    }
  }catch(err){
    console.error('No se pudo guardar la alerta de faltante de material:', err);
  }
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
      tipo_trabajo: tipoTrabajo,
      observaciones: document.getElementById('opp-observaciones').value.trim() || null
    };

    if(editingOrden === orden){
      const { error: errUpd } = await sb.from('opp_ordenes').update(cabecera).eq('orden', orden);
      if(errUpd) throw errUpd;
      const { error: errDel } = await sb.from('opp_piezas').delete().eq('orden', orden);
      if(errDel) throw errDel;
    } else {
      // orden nueva: entra de última en la prioridad de producción
      const maxPrioridad = DB.opp_ordenes.reduce((max, o) => Math.max(max, o.prioridad || 0), 0);
      cabecera.prioridad = maxPrioridad + 1;
      const { error: errIns } = await sb.from('opp_ordenes').insert([cabecera]);
      if(errIns) throw errIns;
    }

    const piezasPayload = Array.from(cards).map((node, i) => {
      const suborden = i + 1;
      const base = {
        orden, suborden, op: orden + '-' + suborden,
        pieza: node.querySelector('.f-pieza').value.trim() || null,
        cantidad: parseFloat(node.querySelector('.f-cantidad').value) || null,
        procesos_requeridos: procesosOrdenados(node)
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
        tintas_detalle_tiro: node.querySelector('.f-tintas-detalle-tiro')?.value.trim() || null,
        tintas_detalle_retiro: node.querySelector('.f-tintas-detalle-retiro')?.value.trim() || null,
        ctp: node.querySelector('.f-ctp').value,
        tira_retira: node.querySelector('.f-tira').value,
        giro: node.querySelector('.f-giro')?.value.trim() || null,
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
    await alertarStockPapelInsuficiente(orden, piezasPayload);

    const { data: o1 } = await sb.from('opp_ordenes').select('*').order('orden', { ascending: false });
    const { data: o2 } = await sb.from('opp_piezas').select('*');
    DB.opp_ordenes = o1 || [];
    DB.opp_piezas = o2 || [];

    // Registra automáticamente en los maestros lo que se usó por primera vez
    // (piezas nuevas para este producto, proveedores nuevos) — así la próxima
    // vez ya aparecen sugeridos, sin tener que ir a Maestros a crearlos antes.
    await registrarPiezasYProveedoresNuevos(cabecera.cliente, cabecera.producto, piezasPayload);

    // Si esta orden se creó importando un Excel que traía el presupuesto,
    // se guarda solo — el gerente lo puede seguir editando después
    // normalmente desde el detalle de la orden.
    if(presupuestoPendienteImportacion && presupuestoPendienteImportacion.orden === orden){
      const pres = presupuestoPendienteImportacion;
      const totalCosto = pres.costo + pres.imprevistos;
      const rentabilidadPct = (pres.precio_venta_antes_iva && totalCosto)
        ? ((pres.precio_venta_antes_iva - totalCosto) / pres.precio_venta_antes_iva * 100) : null;
      try{
        await sb.from('presupuesto_orden').upsert([{
          orden, costo: pres.costo, imprevistos: pres.imprevistos, total_costo: totalCosto,
          precio_venta_antes_iva: pres.precio_venta_antes_iva, precio_con_iva: pres.precio_con_iva,
          rentabilidad_esperada_pct: rentabilidadPct, actualizado_en: new Date().toISOString()
        }]);
        const idx = DB.presupuesto_orden.findIndex(p => p.orden === orden);
        const registro = { orden, costo: pres.costo, imprevistos: pres.imprevistos, total_costo: totalCosto,
          precio_venta_antes_iva: pres.precio_venta_antes_iva, precio_con_iva: pres.precio_con_iva,
          rentabilidad_esperada_pct: rentabilidadPct };
        if(idx >= 0) DB.presupuesto_orden[idx] = registro; else DB.presupuesto_orden.push(registro);
        toast('Presupuesto de la orden ' + orden + ' cargado automáticamente desde el Excel');
      }catch(err){
        console.warn('No se pudo guardar el presupuesto importado automáticamente:', err);
      }
    }

    resetOppForm(suggestNextOrden());
    renderOppRecent();
    if(onOrdenesChangeCallback) onOrdenesChangeCallback();
  }catch(err){
    console.error(err);
    const detalle = (err && (err.message || err.details || err.hint)) || 'revisa la consola';
    toast('Error al guardar la orden: ' + detalle);
  }finally{
    btn.disabled = false; btn.textContent = 'Guardar orden completa';
  }
}

// Después de guardar una orden, registra en los maestros lo que se usó por
// primera vez: cliente nuevo, producto nuevo, combinaciones producto+pieza
// nuevas, y proveedores nuevos escritos a mano en la ficha simplificada.
// Esto es lo que hace que importar un Excel con un cliente o producto que
// todavía no existe funcione solo, sin tener que ir a Maestros antes o
// después — igual pasa si alguien los escribe a mano sin usar "+ Nuevo".
async function registrarPiezasYProveedoresNuevos(cliente, producto, piezasPayload){
  try{
    if(cliente && !DB.clientes.some(c => c.nombre.toLowerCase() === cliente.toLowerCase())){
      const { data } = await sb.from('clientes').insert([{ nombre: cliente }]).select();
      if(data){
        DB.clientes.push(...data);
        populateClienteSelect();
      }
    }

    if(producto && !DB.productos.some(p => p.nombre.toLowerCase() === producto.toLowerCase())){
      const { data } = await sb.from('productos').insert([{ nombre: producto }]).select();
      if(data){
        DB.productos.push(...data);
        populateProductoSelect();
      }
    }

    if(producto){
      const nombresUnicos = [...new Set(piezasPayload.map(p => p.pieza).filter(Boolean))];
      const nuevas = nombresUnicos.filter(nombre =>
        !DB.piezas_producto.some(pp => pp.producto === producto && pp.pieza.toLowerCase() === nombre.toLowerCase())
      );
      if(nuevas.length){
        const payload = nuevas.map(pieza => ({ producto, pieza }));
        const { data } = await sb.from('piezas_producto').insert(payload).select();
        if(data) DB.piezas_producto.push(...data);
      }
    }

    const proveedoresUsados = [...new Set(piezasPayload.map(p => p.proveedor).filter(Boolean))];
    const nuevosProveedores = proveedoresUsados.filter(nombre =>
      !DB.proveedores.some(pv => pv.nombre.toLowerCase() === nombre.toLowerCase())
    );
    if(nuevosProveedores.length){
      const payload = nuevosProveedores.map(nombre => ({ nombre }));
      const { data } = await sb.from('proveedores').insert(payload).select();
      if(data){
        DB.proveedores.push(...data);
        poblarDatalistProveedores();
        refreshProveedoresDatalist();
      }
    }
  }catch(err){
    // no bloquea el guardado de la orden si esto falla — solo se pierde la sugerencia automática
    console.warn('No se pudieron registrar cliente/producto/piezas/proveedores nuevos en los maestros:', err);
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

let onOrdenesChangeCallback = null;

export function initOppForm(onChange){
  onOrdenesChangeCallback = onChange || null;
  wireTableScroll('tbl-ordenes-vivas', 'ordvivas-ir-inicio', 'ordvivas-ir-final');
  populateClienteSelect();
  populateProductoSelect();
  poblarDatalistProveedores();
  wireNuevoInline('opp-cliente', 'opp-cliente-nuevo-wrap', 'opp-cliente-nuevo-nombre', 'opp-cliente-nuevo-add', 'clientes', c => DB.clientes.push(c));
  wireNuevoInline('opp-producto', 'opp-producto-nuevo-wrap', 'opp-producto-nuevo-nombre', 'opp-producto-nuevo-add', 'productos', p => DB.productos.push(p));
  on('opp-producto', 'change', () => { renderProductoRef(); refreshPiezasDatalist(); });
  on('opp-tipo-trabajo', 'change', aplicarTipoTrabajo);
  poblarSelectPrioridadArea();
  on('opp-prioridad-area-select', 'change', renderPrioridadArea);
  resetOppForm();
  on('opp-add-pieza', 'click', () => addPiezaCard());
  on('opp-save', 'click', saveOpp);
  on('opp-reset', 'click', () => resetOppForm());

  const inputImportar = document.getElementById('opp-import-file');
  const btnImportar = document.getElementById('opp-import-btn');
  if(inputImportar && btnImportar){
    btnImportar.addEventListener('click', () => inputImportar.click());
    inputImportar.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = ''; // para poder volver a elegir el mismo archivo después
      if(!file) return;
      try{
        await importarOrdenExcel(file);
      }catch(err){
        console.error(err);
        toast('No se pudo importar el Excel: ' + err.message);
      }
    });
  } else {
    console.warn('[ordenes.js] No se encontró el botón "Importar desde Excel" — revisa que index.html esté actualizado.');
  }
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

// ============================================================
// PARA LA PANTALLA DE OPERARIO (registro.html)
// Funciones nuevas e independientes — no modifican nada de lo que ya
// existía en Órdenes ni en Registrar.
// ============================================================

// Globos/chips de todos los procesos requeridos de una pieza, con su
// estado (✓ terminado / · pendiente) — el mismo estilo que ya se usaba en
// la ficha de detalle, ahora reutilizado también en la lista de prioridad
// (ver punto 11 de AjustesERP: antes esta lista no mostraba ningún globo).
export function chipsProcesosHTML(pieza){
  const requeridos = Array.isArray(pieza.procesos_requeridos) ? pieza.procesos_requeridos : [];
  const completados = areasCompletadasPorPieza(pieza);
  // Cuando el área tiene subprocesos definidos, se le suma el avance
  // (ej. "Terminado (2/6)") — así se ve qué falta, no solo si ya cerró.
  const recsTerminados = DB.produccion.filter(r =>
    (r.op === pieza.op || (r.orden === pieza.orden && r.suborden === pieza.suborden)) &&
    r.horaFin && r.procesoCompleto !== false
  );
  return requeridos.map(a => {
    const done = completados.has(a);
    const subs = subprocesosDeArea(a);
    let etiqueta = a;
    if(subs.length){
      const subsTerminados = new Set(recsTerminados.filter(r => r.area === a && r.subproceso).map(r => r.subproceso));
      etiqueta += ` (${subs.filter(s => subsTerminados.has(s.nombre)).length}/${subs.length})`;
    }
    return `<span class="estado-chip ${done?'done':'pending'}">${done?'✓':'·'} ${etiqueta}</span>`;
  }).join('') || '<span class="card-hint">sin procesos definidos</span>';
}

// Piezas/subórdenes pendientes (les falta terminar al menos un proceso
// requerido) de órdenes activas (ni Cerrada ni Cancelada), en el mismo
// orden de prioridad que define Gerente/Jefe de Producción en el panel de
// Órdenes — el operario solo las ve, no las puede reordenar aquí.
//
// Antes esto trabajaba por ORDEN completa: una orden con 2 subórdenes
// aparecía como una sola fila, así una ya estuviera lista y la otra no.
// Ahora cada suborden es su propia fila, priorizada primero por la
// prioridad de su orden y luego por número de suborden — así 2 órdenes
// con 5 subórdenes en total se ven y se priorizan como 5 ítems (ver punto
// 11 de AjustesERP).
export function getPiezasPendientesPorPrioridad(){
  const filas = [];
  DB.opp_ordenes
    .filter(ordenEnCurso)
    .forEach(o => {
      const piezas = DB.opp_piezas.filter(p => p.orden === o.orden).sort((a,b)=>a.suborden-b.suborden);
      piezas.forEach(p => {
        const requeridos = Array.isArray(p.procesos_requeridos) ? p.procesos_requeridos : [];
        const completados = areasCompletadasPorPieza(p);
        const completa = requeridos.length > 0 && requeridos.every(a => completados.has(a));
        if(!completa) filas.push({ o, p });
      });
    });
  return filas.sort((a,b) => (a.o.prioridad ?? 999999) - (b.o.prioridad ?? 999999) || a.p.suborden - b.p.suborden);
}

// Ficha de solo lectura con la misma información que trae la orden
// impresa (OP, tamaño, papel, tintas, procesos, materiales, horas) —
// para cuando el operario no tiene la hoja física a la mano. No incluye
// nada de costos/presupuesto, eso no es para esta pantalla.
export function fichaOrdenParaOperarioHTML(orden){
  const o = DB.opp_ordenes.find(x => x.orden === orden);
  if(!o) return '<p class="card-hint">Esta orden es histórica (viene del Excel migrado) y no tiene ficha de detalle en OPP.</p>';

  const piezas = DB.opp_piezas.filter(p => p.orden === orden).sort((a,b)=>a.suborden-b.suborden);
  const registros = DB.produccion.filter(r => r.orden === orden);
  const estado = estadoOrden(o);

  const piezasHTML = piezas.map(p => {
    const recsPieza = registros.filter(r => r.op === p.op || (r.suborden === p.suborden));
    const chips = chipsProcesosHTML(p);

    const materiales = [...new Set(recsPieza.map(r => [r.materiaPrima, r.consumoMP].filter(Boolean).join(' — ')).filter(Boolean))];

    const ficha = [
      filaFicha('OP', p.op),
      filaFicha('Tamaño terminado', (p.tamano_ancho || p.tamano_alto) ? `${fmtNum(p.tamano_ancho,1)} x ${fmtNum(p.tamano_alto,1)} cm` : ''),
      filaFicha('Papel', p.papel),
      filaFicha('Tintas frente/atrás', p.tintas_frente != null ? `${p.tintas_frente} x ${p.tintas_atras || 0}` : ''),
      filaFicha('Detalle tintas — Tiro', p.tintas_detalle_tiro),
      filaFicha('Detalle tintas — Retiro', p.tintas_detalle_retiro),
      filaFicha('CTP', p.ctp),
      filaFicha('Impresión / Tipo de montaje', p.tira_retira),
      filaFicha('Giro', p.giro),
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
      filaFicha('Fecha de entrega estimada', p.fecha_entrega_estimada ? (p.fecha_entrega_estimada||'').slice(0,10) : ''),
      filaFicha('Notas', p.notas)
    ].join('');

    const filasOM = agruparPorAreaOperarioMaquina(recsPieza);

    return `<div class="detalle-pieza-card">
      <div class="detalle-pieza-head">
        <b>${p.pieza || ('Pieza ' + p.suborden)}</b>
        <span class="card-hint">${p.cantidad ? fmtNum(p.cantidad,0)+' uds solicitadas' : ''}</span>
      </div>
      <div class="detalle-ficha-grid">${ficha}</div>
      <div class="detalle-pieza-chips">${chips}</div>
      ${materiales.length ? `<div class="detalle-pieza-materiales"><b>Materiales consumidos:</b> ${materiales.join(' · ')}</div>` : ''}
      <table class="detalle-mini-table">
        <thead><tr><th>Área</th><th>Operario · Máquina</th><th class="num">Horas</th><th class="num">Cantidad</th></tr></thead>
        <tbody>${filasOM}</tbody>
      </table>
    </div>`;
  }).join('') || '<p class="card-hint">Esta orden no tiene piezas registradas.</p>';

  return `
    <div class="detalle-orden-obs" style="margin-bottom:12px">
      <b>Orden ${orden} — ${o.cliente || ''}</b> · ${tipoTrabajoLabel(o)} · ${(o.fecha||'').slice(0,10)} ${estadoBadgeHTML(estado)}
    </div>
    ${o.observaciones ? `<div class="detalle-orden-obs"><b>Observaciones:</b> ${o.observaciones}</div>` : ''}
    <div class="detalle-piezas-grid">${piezasHTML}</div>
  `;
}
