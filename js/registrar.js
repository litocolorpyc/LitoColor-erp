// Módulo del reloj checador. Lo usan TANTO index.html como registro.html,
// así que cualquier corrección aquí aplica a las dos pantallas a la vez.
import { sb } from './supabase-client.js';
import { DB, normProd } from './store.js';
import { toast, fmtNum, fechaHoyLocal } from './helpers.js';
import { getOrdenesSeleccionables, subprocesosDeArea } from './ordenes.js';

const timerIntervals = new Map();
const sessionRates = new Map();
let onChangeCallback = null; // lo define quien inicialice este módulo

function renderRecentReg(){
  const tbody = document.querySelector('#tbl-reg-recent tbody');
  if(!tbody) return;
  const nombre = document.getElementById('r-operario').value;
  const hint = document.getElementById('reg-recent-hint');
  if(!nombre){
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">Elige tu nombre arriba para ver tu historial</td></tr>';
    if(hint) hint.textContent = 'elige tu nombre arriba';
    return;
  }
  if(hint) hint.textContent = 'de ' + nombre;
  const recent = DB.produccion.filter(r => r.operario === nombre).slice(0,12);
  tbody.innerHTML = recent.map(r=>{
    const estado = !r.horaIni ? '<span class="estado-chip pending">📌 Asignada</span>'
      : (r.horaFin ? '<span class="estado-chip done">✓ Completo</span>' : '<span class="estado-chip estado-chip-warn">⏱ En curso</span>');
    const pieza = r.op ? r.op : (r.orden ? '<span style="color:var(--ink-faint)">sin pieza</span>' : '—');
    return `<tr><td>${(r.fecha||'').slice(0,10)}</td><td>${r.actividad||'—'}</td><td>${r.orden??'—'}</td><td>${pieza}</td><td>${estado}</td></tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">Sin registros todavía</td></tr>';
}

function populateOrdenSelect(){
  const sel = document.getElementById('r-orden');
  const valorPrevio = sel.value;
  const activas = getOrdenesSeleccionables();
  sel.innerHTML = '<option value="">Selecciona una orden…</option>' +
    activas.map(o => `<option value="${o.orden}">${o.orden} — ${o.cliente || ''}${o.producto ? ' · ' + o.producto : ''}</option>`).join('');
  if(activas.some(o => String(o.orden) === valorPrevio)) sel.value = valorPrevio;
}

// Opciones de Actividad/Máquina para un área — se reutilizan tanto en el
// formulario de "Iniciar actividad" como en la tarjeta de una actividad
// ASIGNADA que el operario todavía no empezó (ver runningCardPendienteHTML).
function actividadOptionsHTML(area){
  const acts = DB.actividades.filter(a=>a.area===area && a.activo!==false);
  return acts.map(a=>`<option value="${a.etiqueta}">${a.etiqueta}</option>`).join('') || '<option value="">Sin actividades para esta área</option>';
}
function maquinaOptionsHTML(area){
  const maqs = DB.maquinas.filter(m=>m.area===area && m.activo!==false);
  return '<option value="">Trabajo manual (sin máquina)</option>' +
    maqs.map(m=>`<option value="${m.nombre}">${m.nombre}</option>`).join('');
}
// Motivos de pausa (Desayuno, Almuerzo, Cambio de actividad, Daño de
// máquina, …) — catálogo en Maestros. Se piden al "Pausar" una actividad.
function motivoPausaOptionsHTML(){
  const motivos = DB.motivos_pausa.filter(m=>m.activo!==false);
  return '<option value="">— elige un motivo —</option>' +
    motivos.map(m=>`<option value="${m.nombre}">${m.nombre}</option>`).join('');
}
// Pasos internos de un área (catálogo "Subprocesos" en Maestros, ej.
// Terminado → Doblar pestañas/Engomado/Cerrar) — solo si el área tiene
// alguno definido. Mientras no estén TODOS registrados como terminados,
// el área no cuenta como completa (ver areasCompletadasPorPieza).
function subprocesoOptionsHTML(area){
  const subs = subprocesosDeArea(area);
  return '<option value="">— elige el subproceso —</option>' +
    subs.map(s=>`<option value="${s.nombre}">${s.nombre}</option>`).join('');
}
function populateActividadReg(){
  document.getElementById('r-actividad').innerHTML = actividadOptionsHTML(document.getElementById('r-area').value);
}
function populateMaquinaReg(){
  document.getElementById('r-maquina').innerHTML = maquinaOptionsHTML(document.getElementById('r-area').value);
}
function populateSubprocesoReg(){
  const area = document.getElementById('r-area').value;
  const subs = subprocesosDeArea(area);
  const wrap = document.getElementById('r-subproceso-wrap');
  if(!wrap) return;
  wrap.style.display = subs.length ? '' : 'none';
  document.getElementById('r-subproceso').innerHTML = subprocesoOptionsHTML(area);
}
function populatePiezaReg(){
  const orden = parseInt(document.getElementById('r-orden').value, 10);
  const sel = document.getElementById('r-pieza');
  const piezas = DB.opp_piezas.filter(p => p.orden === orden);
  sel.innerHTML = '<option value="">— Sin OPP / general —</option>' +
    piezas.map(p => `<option value="${p.op}" data-suborden="${p.suborden}">${p.suborden}. ${p.pieza || 'Pieza'}</option>`).join('');
  const hint = document.getElementById('r-pieza-hint');
  if(hint) hint.textContent = piezas.length ? '⚠️ elígela, o el avance de la orden no se va a actualizar' : '';
  sel.onchange = () => { if(hint) hint.textContent = (sel.value && piezas.length) ? '' : (piezas.length ? '⚠️ elígela, o el avance de la orden no se va a actualizar' : ''); };
}
function toggleSinOrden(){
  const sinOrden = document.getElementById('r-sin-orden').checked;
  document.getElementById('r-concepto-wrap').style.display = sinOrden ? '' : 'none';
  document.getElementById('r-orden').closest('.field').style.display = sinOrden ? 'none' : '';
  document.getElementById('r-pieza').closest('.field').style.display = sinOrden ? 'none' : '';
  if(sinOrden){
    document.getElementById('r-orden').value = '';
    document.getElementById('r-pieza').innerHTML = '<option value="">— Sin OPP / general —</option>';
    document.getElementById('r-orden').classList.remove('campo-requerido-error');
  } else {
    document.getElementById('r-concepto').value = '';
  }
}

function limpiarErrorCampo(el){ el.classList.remove('campo-requerido-error'); }

// Fuente de verdad: el maestro "Áreas" (con su orden por defecto). Se le
// suman las áreas de Máquinas/Actividades que todavía no estén cargadas
// ahí, para no perder ninguna que ya esté en uso — quedan al final,
// ordenadas alfabéticamente, hasta que alguien las agregue al maestro.
export function listaAreasDisponibles(){
  const nombres = Array.from(new Set([
    ...DB.areas.filter(a=>a.activo!==false).map(a=>a.nombre),
    ...DB.maquinas.map(m=>m.area),
    ...DB.actividades.filter(a=>a.activo!==false).map(a=>a.area)
  ])).filter(Boolean);
  const ordenMap = new Map(DB.areas.map(a => [a.nombre, a.orden ?? 999]));
  return nombres.sort((a,b) => (ordenMap.get(a) ?? 999) - (ordenMap.get(b) ?? 999) || a.localeCompare(b));
}

export function populateReg(){
  const opSel = document.getElementById('r-operario');
  opSel.innerHTML = '<option value="">Selecciona tu nombre…</option>' +
    DB.personal.filter(p=>p.activo).map(p=>`<option value="${p.nombre}" data-rate="${p.valor_hora||0}">${p.nombre} — ${p.cargo}</option>`).join('');

  const areas = listaAreasDisponibles();
  const areaSel = document.getElementById('r-area');
  const areaPrevia = areaSel.value;
  areaSel.innerHTML = areas.map(a=>`<option value="${a}">${a}</option>`).join('');
  if(areas.includes(areaPrevia)) areaSel.value = areaPrevia;
  populateActividadReg();
  populateMaquinaReg();
  populateSubprocesoReg();
  populateOrdenSelect();
}

// Arma el <select> de insumos disponibles para el área de esta actividad,
// con una opción "Otro" para cuando el insumo no está en el maestro todavía.
// El desplegable de "Insumo consumido" junta TRES fuentes, en este orden:
//   1) los materiales de la ORDEN — el papel de cualquiera de sus piezas
//      (materialesOrden), sin importar el área que se esté trabajando: si
//      estás en Plastificado o Terminado también puede hacer falta anotar
//      el papel de la orden, no solo en Guillotina/Corte inicial como era
//      antes.
//   2) las materias primas vinculadas a esta área desde Maestros >
//      Materias primas > "Áreas que consumen" (una materia prima puede
//      quedar disponible en varias áreas a la vez).
//   3) los insumos por defecto de esta área (Maestros > Materiales por
//      área — planchas, tinta, colbón, grapas, etc.).
export function materialSelectOptionsHTML(area, valorActual, materialesOrden){
  const opcionesInsumo = DB.insumos_area.filter(m => m.area === area && m.activo !== false)
    .map(m => ({ nombre: m.nombre, unidad: m.unidad }));
  const codigosVinculados = new Set(DB.materias_primas_areas.filter(x => x.area === area).map(x => x.materia_prima_codigo));
  const nombresYaListados = new Set(opcionesInsumo.map(m => m.nombre));
  const opcionesMPArea = DB.materias_primas.filter(m => codigosVinculados.has(m.codigo) && !nombresYaListados.has(m.nombre))
    .map(m => ({ nombre: m.nombre, unidad: m.unidad || 'pliegos' }));
  opcionesMPArea.forEach(m => nombresYaListados.add(m.nombre));

  const opcionesOrden = (materialesOrden || [])
    .filter(nombre => nombre && !nombresYaListados.has(nombre))
    .map(nombre => {
      const mat = DB.materias_primas.find(m => m.nombre === nombre);
      return { nombre, unidad: (mat && mat.unidad) || 'pliegos', deOrden: true };
    });

  const opciones = [...opcionesOrden, ...opcionesMPArea, ...opcionesInsumo];
  const coincide = opciones.some(m => m.nombre === valorActual);
  const otroSeleccionado = !!valorActual && !coincide;
  const opts = ['<option value="">— Sin insumo registrado —</option>'];
  opts.push(...opciones.map(m =>
    `<option value="${m.nombre}"${m.nombre===valorActual?' selected':''}>${m.nombre}${m.deOrden ? ' (de esta orden)' : (m.unidad?' ('+m.unidad+')':'')}</option>`
  ));
  opts.push(`<option value="__otro__"${otroSeleccionado?' selected':''}>Otro / no está en la lista…</option>`);
  return opts.join('');
}

export function parseCantidadConsumo(consumoMp){
  if(!consumoMp) return '';
  const m = String(consumoMp).match(/^([\d.,]+)/);
  return m ? m[1].replace(',', '.') : '';
}

// Unidad para pedir el consumo como NÚMERO (en vez de texto libre) — se
// necesita un número limpio para poder descontar del inventario (punto 13
// de AjustesERP). Mismo criterio de siempre para insumos_area (solo si
// tiene "unidad" configurada); se agrega el papel de "Materias primas"
// como fuente nueva, siempre con unidad (pliegos por defecto), porque ahí
// sí queremos llevar inventario sin depender de que alguien lo configure.
export function unidadNumericaDelMaterial(area, nombre){
  const insumo = DB.insumos_area.find(m => m.area === area && m.nombre === nombre);
  if(insumo) return insumo.unidad || null;
  const papel = DB.materias_primas.find(m => m.nombre === nombre);
  return papel ? (papel.unidad || 'pliegos') : null;
}

// Tarjeta de una actividad ASIGNADA por un jefe/gerente (ver "Prioridad de
// producción" en js/ordenes.js) que el operario todavía no empezó — no
// tiene hora_ini. Se ve de inmediato en "Tus actividades en curso" apenas
// se asigna, aunque no haya tiempos registrados todavía; el operario elige
// la actividad/máquina puntual y le da "Empezar" para que arranque el reloj.
function runningCardPendienteHTML(row){
  return `<div class="reg-running-card reg-running-pendiente" data-id="${row.id}" data-area="${row.area || ''}">
    <div class="reg-running-row"><span>Orden / Pieza</span><b>${row.orden || '—'}${row.op ? ' / ' + row.op : ''}</b></div>
    <div class="reg-running-row"><span>Área asignada</span><b>${row.area || '—'}</b></div>
    ${row.asignado_por ? `<div class="reg-running-row"><span>Asignada por</span><b>${row.asignado_por}</b></div>` : ''}
    <span class="estado-chip pending">📌 asignada, sin iniciar</span>
    <div class="form-row">
      <div class="field"><label>Actividad</label><select class="rc-actividad-select">${actividadOptionsHTML(row.area)}</select></div>
      <div class="field"><label>Máquina</label><select class="rc-maquina-select">${maquinaOptionsHTML(row.area)}</select></div>
    </div>
    ${subprocesosDeArea(row.area).length ? `<div class="form-row">
      <div class="field full"><label>Subproceso <span class="card-hint">(este proceso tiene varios pasos — elige cuál vas a hacer)</span></label><select class="rc-subproceso-select">${subprocesoOptionsHTML(row.area)}</select></div>
    </div>` : ''}
    <button type="button" class="btn-primary btn-clock rc-empezar">▶ Empezar esta actividad</button>
  </div>`;
}

function runningCardHTML(row){
  if(!row.hora_ini) return runningCardPendienteHTML(row);
  const otroSeleccionado = !!row.materia_prima && !DB.insumos_area.some(m => m.area === row.area && m.nombre === row.materia_prima);
  const unidadActual = row.materia_prima ? unidadNumericaDelMaterial(row.area, row.materia_prima) : null;
  // Todos los papeles/materias primas usados en CUALQUIER pieza de esta
  // orden — no solo el de la pieza puntual de este registro — para que
  // estén disponibles como insumo sin importar qué área se esté trabajando.
  const materialesOrden = row.orden != null
    ? [...new Set(DB.opp_piezas.filter(p => p.orden === row.orden).map(p => p.papel).filter(Boolean))]
    : [];
  return `<div class="reg-running-card" data-id="${row.id}" data-area="${row.area || ''}">
    <div class="reg-running-row"><span>Orden / Pieza</span><b>${row.orden || '—'}${row.op ? ' / ' + row.op : ''}</b></div>
    <div class="reg-running-row"><span>Actividad</span><b>${row.actividad || '—'}</b></div>
    <div class="reg-running-row"><span>Máquina</span><b>${row.maquina || 'Trabajo manual'}</b></div>
    <div class="reg-running-row"><span>Hora inicio</span><b>${row.hora_ini || '—'}</b></div>
    <div class="reg-timer" data-timer="${row.id}">00:00:00</div>
    <div class="form-row">
      <div class="field"><label>Cantidad producida</label><input type="number" class="rc-cantidad" min="0" value="${row.cantidad ?? ''}"></div>
      <div class="field"><label>¿Reproceso?</label><select class="rc-reproceso"><option value="No"${row.reproceso!=='Si'?' selected':''}>No</option><option value="Si"${row.reproceso==='Si'?' selected':''}>Sí</option></select></div>
    </div>
    <div class="form-row">
      <div class="field full">
        <label>¿Quedó terminado ${row.subproceso ? `este subproceso (${row.subproceso})` : `este proceso (${row.area || '—'})`}?</label>
        <select class="rc-proceso-completo">
          <option value="No">No, continuaré después</option>
          <option value="Si" selected>Sí, terminé este proceso</option>
        </select>
        <span class="card-hint">Si eliges "No", esta orden NO va a contar este proceso como terminado hasta que lo finalices de verdad. Un operario no puede tener dos actividades corriendo a la vez — pausa esta para poder iniciar otra.</span>
      </div>
    </div>
    <div class="form-row rc-motivo-pausa-wrap" style="display:none">
      <div class="field full"><label>Motivo de la pausa</label><select class="rc-motivo-pausa">${motivoPausaOptionsHTML()}</select></div>
    </div>
    <div class="form-row">
      <div class="field">
        <label>Insumo consumido <span class="card-hint">(del área ${row.area || '—'})</span></label>
        <select class="rc-materia-select">${materialSelectOptionsHTML(row.area, row.materia_prima, materialesOrden)}</select>
        <input type="text" class="rc-materia-otro" placeholder="especifica el insumo" style="display:${otroSeleccionado?'block':'none'};margin-top:5px" value="${otroSeleccionado ? row.materia_prima : ''}">
      </div>
      <div class="field">
        <label class="rc-consumo-label">Consumo${unidadActual ? ' (' + unidadActual + ')' : ''}</label>
        <input type="number" class="rc-consumo-num" min="0" step="0.01" placeholder="cantidad" data-unidad="${unidadActual || ''}" value="${unidadActual ? parseCantidadConsumo(row.consumo_mp) : ''}" style="display:${unidadActual ? 'block' : 'none'}">
        <input type="text" class="rc-consumo" placeholder="ej. 2 planchas, 150 g" value="${row.consumo_mp || ''}" style="display:${unidadActual ? 'none' : 'block'}">
      </div>
    </div>
    ${row.actividad === 'Remisión y Despacho' ? `<div class="form-row">
      <div class="field full"><label>Número de remisión <span class="card-hint">(al terminar esta actividad, la orden queda Cerrada)</span></label><input type="text" class="rc-numero-remision" placeholder="ej. REM-00123" value="${row.numero_remision || ''}"></div>
    </div>` : ''}
    <div class="field full"><label>Comentario</label><textarea class="rc-comentario" rows="2">${row.comentario || ''}</textarea></div>
    <button type="button" class="btn-primary btn-clock rc-finish">⏹ Finalizar esta actividad</button>
  </div>`;
}

// Muestra/oculta el motivo de pausa y cambia el texto del botón según lo
// que el operario elija en "¿Quedó terminado este proceso?".
function wirePausaToggle(card){
  const sel = card.querySelector('.rc-proceso-completo');
  const actualizar = () => {
    const esPausa = sel.value === 'No';
    card.querySelector('.rc-motivo-pausa-wrap').style.display = esPausa ? '' : 'none';
    card.querySelector('.rc-finish').textContent = esPausa ? '⏸ Pausar esta actividad' : '⏹ Finalizar esta actividad';
  };
  sel.addEventListener('change', actualizar);
  actualizar();
}

function wireMaterialSelect(card){
  const sel = card.querySelector('.rc-materia-select');
  const otro = card.querySelector('.rc-materia-otro');
  const consumoNum = card.querySelector('.rc-consumo-num');
  const consumoTxt = card.querySelector('.rc-consumo');
  const consumoLabel = card.querySelector('.rc-consumo-label');
  const area = card.dataset.area;
  sel.addEventListener('change', () => {
    otro.style.display = sel.value === '__otro__' ? 'block' : 'none';
    if(sel.value === '__otro__') otro.focus();
    const unidad = sel.value ? unidadNumericaDelMaterial(area, sel.value) : null;
    consumoNum.dataset.unidad = unidad || '';
    consumoNum.style.display = unidad ? 'block' : 'none';
    consumoTxt.style.display = unidad ? 'none' : 'block';
    if(consumoLabel) consumoLabel.textContent = 'Consumo' + (unidad ? ' (' + unidad + ')' : '');
  });
}

function startCardTimer(id, fecha, horaIni){
  const horaIniDate = new Date(fecha + 'T' + horaIni);
  const tick = () => {
    const el = document.querySelector(`[data-timer="${id}"]`);
    if(!el) return;
    const ms = Date.now() - horaIniDate.getTime();
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(totalSec/3600)).padStart(2,'0');
    const m = String(Math.floor((totalSec%3600)/60)).padStart(2,'0');
    const s = String(totalSec%60).padStart(2,'0');
    el.textContent = `${h}:${m}:${s}`;
  };
  tick();
  timerIntervals.set(id, setInterval(tick, 1000));
}

async function refreshRunningSessions(){
  timerIntervals.forEach(id => clearInterval(id));
  timerIntervals.clear();

  const nombre = document.getElementById('r-operario').value;
  const cont = document.getElementById('reg-running-list');
  if(!nombre){
    cont.innerHTML = '<p style="color:var(--ink-faint);font-size:13px">Selecciona tu nombre arriba para ver tus actividades en curso.</p>';
    document.getElementById('reg-hint').textContent = 'elige tu nombre';
    return;
  }
  const hoy = fechaHoyLocal();
  // Incluye tanto lo realmente en curso HOY (hora_ini seteada) como
  // cualquier actividad ASIGNADA que todavía no se ha empezado (hora_ini
  // null) sin importar qué día se asignó — así el operario la sigue
  // viendo hasta que la empiece, no solo el día que se la repartieron.
  const { data, error } = await sb.from('produccion').select('*')
    .eq('operario', nombre).is('hora_fin', null)
    .or(`fecha.eq.${hoy},hora_ini.is.null`)
    .order('id', { ascending: true });
  if(error){ console.error(error); toast('No se pudo consultar tus actividades en curso'); return; }

  const rate = parseFloat(document.getElementById('r-operario').selectedOptions[0]?.dataset.rate || 0);
  (data || []).forEach(row => sessionRates.set(row.id, rate));

  const enCurso = (data || []).filter(r => r.hora_ini).length;
  const asignadas = (data || []).length - enCurso;
  const partesHint = [];
  if(enCurso) partesHint.push(`${enCurso} en curso`);
  if(asignadas) partesHint.push(`${asignadas} asignada(s) sin iniciar`);
  document.getElementById('reg-hint').textContent = partesHint.length ? partesHint.join(' · ') : 'sin actividades en curso ahora';

  if(!data || !data.length){
    cont.innerHTML = '<p style="color:var(--ink-faint);font-size:13px">No tienes actividades en curso. Inicia una arriba.</p>';
    return;
  }
  cont.innerHTML = data.map(row => runningCardHTML(row)).join('');
  data.forEach(row => {
    const card = cont.querySelector(`[data-id="${row.id}"]`);
    if(row.hora_ini){
      card.querySelector('.rc-finish').addEventListener('click', () => finishActivity(row.id, row.hora_ini, row.fecha));
      wireMaterialSelect(card);
      wirePausaToggle(card);
      startCardTimer(row.id, row.fecha, row.hora_ini);
    } else {
      card.querySelector('.rc-empezar').addEventListener('click', () => empezarActividadAsignada(row.id));
    }
  });
}

// Un operario no puede tener tiempo corriendo en dos actividades a la vez
// — puede pausar la que tiene (ver rc-proceso-completo/rc-motivo-pausa) e
// ir a hacer otra, pero no las dos al mismo tiempo. Se consulta Supabase
// en vivo (no la memoria local) para cubrir el caso de que haya iniciado
// algo desde otro dispositivo/pestaña.
async function actividadEnCursoDelOperario(nombre){
  const { data, error } = await sb.from('produccion').select('id,actividad,area,orden,fecha,hora_ini')
    .eq('operario', nombre).is('hora_fin', null).not('hora_ini', 'is', null)
    .limit(1);
  if(error){ console.error(error); return null; } // no bloquear por un error de red, solo no se pudo verificar
  return (data && data[0]) || null;
}

// Mensaje de bloqueo con fecha/orden de la sesión que quedó abierta — para
// que se note de una si es de HOY (una actividad real que hay que pausar)
// o una sesión vieja olvidada (hay que pedirle a Jefe/Gerencia/Admin que
// la cierre desde "Corregir registro", en Operario).
function mensajeActividadEnCurso(enCurso){
  const cuando = enCurso.fecha === fechaHoyLocal() ? `hoy ${enCurso.hora_ini || ''}` : `el ${enCurso.fecha || '—'}`;
  return `Ya tienes "${enCurso.actividad || enCurso.area || 'una actividad'}" en curso desde ${cuando}${enCurso.orden ? ' (orden ' + enCurso.orden + ')' : ''} — finalízala o pausala antes de iniciar otra. Si es una sesión vieja que quedó olvidada, pídele a tu Jefe/Gerencia/Admin que la cierre desde "Corregir registro".`;
}

async function startActivity(){
  const nombre = document.getElementById('r-operario').value;
  if(!nombre){ toast('Selecciona tu nombre primero'); return; }

  const sinOrden = document.getElementById('r-sin-orden').checked;
  const ordenSel = document.getElementById('r-orden');
  const piezaSel = document.getElementById('r-pieza');
  limpiarErrorCampo(ordenSel);

  let concepto = null;
  if(sinOrden){
    concepto = document.getElementById('r-concepto').value.trim();
    if(!concepto){
      toast('Escribe el cliente o concepto del trabajo antes de iniciar');
      document.getElementById('r-concepto').focus();
      return;
    }
  } else {
    if(!ordenSel.value){
      toast('Selecciona una orden antes de iniciar — o marca "Trabajo sin orden asignada" si no aplica');
      ordenSel.classList.add('campo-requerido-error');
      ordenSel.focus();
      return;
    }
    const piezasDeEstaOrden = DB.opp_piezas.filter(p => p.orden === Number(ordenSel.value));
    if(piezasDeEstaOrden.length && !piezaSel.value){
      toast('Esta orden tiene piezas registradas — elige cuál estás trabajando');
      piezaSel.classList.add('campo-requerido-error');
      piezaSel.focus();
      return;
    }
  }

  const areaElegida = document.getElementById('r-area').value;
  const subprocesoSel = document.getElementById('r-subproceso');
  if(subprocesosDeArea(areaElegida).length && !subprocesoSel.value){
    toast('Este proceso tiene varios pasos — elige cuál subproceso vas a hacer');
    subprocesoSel.focus();
    return;
  }

  const btn = document.getElementById('r-start');
  btn.disabled = true; btn.textContent = 'Iniciando…';
  try{
    const enCurso = await actividadEnCursoDelOperario(nombre);
    if(enCurso){
      toast(mensajeActividadEnCurso(enCurso));
      document.getElementById('reg-running-list').scrollIntoView({ behavior:'smooth' });
      return;
    }
    const now = new Date();
    const fecha = fechaHoyLocal(now);
    const horaIni = now.toTimeString().slice(0,5);
    const ordenRaw = sinOrden ? '' : ordenSel.value;
    const orden = ordenRaw ? (isNaN(Number(ordenRaw)) ? null : Number(ordenRaw)) : null;
    const piezaOpt = piezaSel.selectedOptions[0];
    const opValue = sinOrden ? null : (piezaSel.value || null);
    const subordenSel = (!sinOrden && piezaOpt && piezaOpt.dataset.suborden) ? parseInt(piezaOpt.dataset.suborden, 10) : null;
    const ordenInfo = DB.opp_ordenes.find(o => o.orden === orden);

    const row = {
      fecha, operario: nombre, hora_ini: horaIni, hora_fin: null,
      actividad: document.getElementById('r-actividad').value,
      area: areaElegida,
      subproceso: subprocesoSel.value || null,
      maquina: document.getElementById('r-maquina').value || null,
      orden, suborden: subordenSel, op: opValue,
      cliente: sinOrden ? concepto : (ordenInfo ? ordenInfo.cliente : null),
      trabajo: sinOrden ? concepto : (piezaOpt && piezaOpt.value ? piezaOpt.textContent.replace(/^\d+\.\s*/, '') : null),
      opp: sinOrden ? null : (ordenRaw || null)
    };
    const { data, error } = await sb.from('produccion').insert([row]).select();
    if(error) throw error;
    if(!data || !data.length) throw new Error('Supabase no devolvió el registro creado');

    DB.produccion.unshift(normProd(data[0]));
    toast('Actividad iniciada · ' + horaIni);
    document.getElementById('r-sin-orden').checked = false;
    toggleSinOrden();
    document.getElementById('r-orden').value = '';
    document.getElementById('r-pieza').innerHTML = '<option value="">— Sin OPP / general —</option>';
    await refreshRunningSessions();
    renderRecentReg();
    if(onChangeCallback) onChangeCallback();
  }catch(err){
    console.error(err);
    toast('Error al iniciar — revisa la consola');
  }finally{
    btn.disabled = false; btn.textContent = '▶ Iniciar actividad';
  }
}

// El operario confirma/empieza una actividad que un jefe/gerente le asignó
// desde "Prioridad de producción" (ver js/ordenes.js) — el registro ya
// existía (hora_ini null), acá recién arranca el reloj. Elige la actividad
// y máquina puntuales porque quien asigna solo definió la orden/área.
async function empezarActividadAsignada(id){
  const card = document.querySelector(`.reg-running-card[data-id="${id}"]`);
  if(!card) return;
  const nombre = document.getElementById('r-operario').value;
  const actividadSel = card.querySelector('.rc-actividad-select');
  const maquinaSel = card.querySelector('.rc-maquina-select');
  const subprocesoSel = card.querySelector('.rc-subproceso-select');
  if(!actividadSel.value){
    toast('Elige qué actividad vas a hacer antes de empezar');
    actividadSel.focus();
    return;
  }
  if(subprocesoSel && !subprocesoSel.value){
    toast('Este proceso tiene varios pasos — elige cuál subproceso vas a hacer');
    subprocesoSel.focus();
    return;
  }

  const btn = card.querySelector('.rc-empezar');
  btn.disabled = true; btn.textContent = 'Empezando…';
  try{
    const enCurso = await actividadEnCursoDelOperario(nombre);
    if(enCurso){
      toast(mensajeActividadEnCurso(enCurso));
      return;
    }
    const now = new Date();
    const updates = {
      fecha: fechaHoyLocal(now),
      hora_ini: now.toTimeString().slice(0,5),
      actividad: actividadSel.value,
      maquina: maquinaSel.value || null,
      subproceso: subprocesoSel ? (subprocesoSel.value || null) : null
    };
    const { data, error } = await sb.from('produccion').update(updates).eq('id', id).select();
    if(error) throw error;
    if(!data || !data.length) throw new Error('Supabase no devolvió el registro actualizado');

    const idx = DB.produccion.findIndex(r => r.id === id);
    if(idx >= 0) DB.produccion[idx] = normProd(data[0]);
    toast('Actividad iniciada · ' + updates.hora_ini);
    await refreshRunningSessions();
    renderRecentReg();
    if(onChangeCallback) onChangeCallback();
  }catch(err){
    console.error(err);
    toast('Error al empezar — revisa la consola');
  }finally{
    btn.disabled = false; btn.textContent = '▶ Empezar esta actividad';
  }
}

// Encuentra en qué catálogo vive un material por nombre — insumos_area
// primero (más específico, por área), materias_primas después. Se usa
// tanto para descontar como para revertir, así los dos quedan consistentes.
function buscarMaterialPorNombre(area, nombre){
  const insumo = DB.insumos_area.find(m => m.area === area && m.nombre === nombre);
  if(insumo) return { tabla: 'insumos_area', mat: insumo, key: 'id' };
  const mp = DB.materias_primas.find(m => m.nombre === nombre);
  if(mp) return { tabla: 'materias_primas', mat: mp, key: 'codigo' };
  return null;
}

// Punto 13 de AjustesERP: cuando el consumo se capturó como número (papel
// de "Materias primas" o un insumo de "Materiales por área" con unidad
// configurada), se descuenta del inventario y se carga automáticamente
// como costo de la orden — así Rentabilidad por Orden refleja el costo
// real de material, no solo mano de obra (mismo mecanismo de orden/
// suborden asociada del punto 10). Si el material no tiene costo_unitario
// cargado, igual se descuenta el stock, solo no se genera el costo.
//
// produccionId queda guardado en el costos_movimientos que se genera —
// así, si Jefe de Producción/Gerencia corrige después ese registro
// (Operario > "Corregir registro"), se puede encontrar y revertir el
// costo exacto que había generado (ver revertirConsumoDeRegistro más
// abajo) en vez de dejarlo huérfano o duplicado.
//
// Devuelve un estado ({ descontado, costeado, motivo }) en vez de
// tragarse el resultado — antes, si el nombre escrito no coincidía EXACTO
// con ningún material del catálogo (típico al usar "Otro / no está en la
// lista…" y escribir el nombre distinto al real), no se descontaba nada Y
// nadie se enteraba; quien registró el consumo veía "Actividad finalizada"
// como si todo hubiera quedado bien. Los llamadores (finishActivity acá
// abajo, y guardarEdicionRegistro en dashboard.js) avisan con un toast
// cuando algo no se pudo reflejar.
export async function descontarInventarioYCargarCosto({ nombre, area, cantidad, orden, suborden, fecha, produccionId }){
  if(!nombre || !cantidad || cantidad <= 0) return { descontado:false, costeado:false, motivo:null };
  const encontrado = buscarMaterialPorNombre(area, nombre);
  if(!encontrado) return { descontado:false, costeado:false, motivo:'sin_catalogo' }; // "Otro" escrito a mano que no calza con ningún material real
  const { tabla, mat, key } = encontrado;

  try{
    const nuevoStock = (mat.stock_actual || 0) - cantidad;
    const { data, error } = await sb.from(tabla).update({ stock_actual: nuevoStock }).eq(key, mat[key]).select();
    if(error) throw error;
    Object.assign(mat, data[0]);
  }catch(err){
    console.error('No se pudo descontar del inventario:', err);
    return { descontado:false, costeado:false, motivo:'error_guardando' };
  }

  if(!mat.costo_unitario) return { descontado:true, costeado:false, motivo:'sin_costo_unitario' };
  const concepto = DB.costos_conceptos.find(c => c.nombre === 'Consumo de materia prima (automático)');
  if(!concepto) return { descontado:true, costeado:false, motivo:'sin_concepto' }; // migración no aplicada todavía — no bloquea el resto
  try{
    const row = {
      concepto_id: concepto.id, tipo: 'Variable', fecha: fecha || fechaHoyLocal(),
      valor: cantidad * mat.costo_unitario, proveedor: null,
      comentario: `Consumo automático — ${nombre} (${fmtNum(cantidad,2)})`,
      orden: orden ?? null, suborden: suborden ?? null, produccion_id: produccionId ?? null
    };
    const { data, error } = await sb.from('costos_movimientos').insert([row]).select();
    if(error) throw error;
    DB.costos_movimientos.unshift(data[0]);
  }catch(err){
    console.error('No se pudo cargar el costo del material consumido:', err);
    return { descontado:true, costeado:false, motivo:'error_guardando' };
  }
  return { descontado:true, costeado:true, motivo:null };
}

// Texto para avisarle a quien registró el consumo que algo no quedó
// reflejado — se agrega al toast de "Actividad finalizada"/"Registro
// corregido" en vez de perderse en la consola.
export function avisoConsumoNoReflejado(resultado, nombre){
  if(!resultado || !resultado.motivo) return '';
  if(resultado.motivo === 'sin_catalogo') return ` ⚠️ "${nombre}" no coincide exacto con ningún material del maestro — no se descontó del inventario. Corrígelo desde "Ajustar" en el Historial de la orden.`;
  if(resultado.motivo === 'sin_costo_unitario') return ` ⚠️ Se descontó del inventario, pero "${nombre}" no tiene costo por unidad configurado — este consumo no se refleja en los costos de la orden. Cárgale un costo en Maestros.`;
  if(resultado.motivo === 'error_guardando') return ` ⚠️ Hubo un error guardando el consumo de "${nombre}" — revisa la consola.`;
  return '';
}

// Contrario de descontarInventarioYCargarCosto: le devuelve la cantidad al
// stock del material y borra el costo automático que había generado ese
// registro puntual — se usa al CORREGIR el consumo de un registro ya
// guardado (Jefe de Producción/Gerencia/Admin), para no dejar el
// inventario ni los costos desfasados con lo que el registro dice ahora.
export async function revertirConsumoDeRegistro(nombre, area, cantidad, produccionId){
  if(!nombre || !cantidad || cantidad <= 0) return;
  const encontrado = buscarMaterialPorNombre(area, nombre);
  if(encontrado){
    try{
      const { tabla, mat, key } = encontrado;
      const nuevoStock = (mat.stock_actual || 0) + cantidad;
      const { data, error } = await sb.from(tabla).update({ stock_actual: nuevoStock }).eq(key, mat[key]).select();
      if(error) throw error;
      Object.assign(mat, data[0]);
    }catch(err){
      console.error('No se pudo devolver el consumo anterior al inventario:', err);
    }
  }
  if(produccionId == null) return;
  try{
    const { error } = await sb.from('costos_movimientos').delete()
      .eq('produccion_id', produccionId).ilike('comentario', 'Consumo automático%');
    if(error) throw error;
    let idx;
    while((idx = DB.costos_movimientos.findIndex(m => m.produccion_id === produccionId && (m.comentario||'').startsWith('Consumo automático'))) >= 0){
      DB.costos_movimientos.splice(idx, 1);
    }
  }catch(err){
    console.error('No se pudo borrar el costo automático anterior:', err);
  }
}

async function finishActivity(id, horaIni, fecha){
  const card = document.querySelector(`.reg-running-card[data-id="${id}"]`);
  const btn = card.querySelector('.rc-finish');
  const esPausa = card.querySelector('.rc-proceso-completo').value === 'No';
  const motivoPausa = esPausa ? card.querySelector('.rc-motivo-pausa').value : '';
  if(esPausa && !motivoPausa){
    toast('Elige el motivo de la pausa antes de guardar');
    card.querySelector('.rc-motivo-pausa').focus();
    return;
  }

  // "Remisión y Despacho" cierra la orden — se pide el número de remisión
  // acá mismo (por ahora manual; la generación automática de la remisión
  // completa queda pendiente para más adelante).
  const rowActual = DB.produccion.find(r => r.id === id);
  const esRemisionYDespacho = !!rowActual && rowActual.actividad === 'Remisión y Despacho';
  const remisionInput = card.querySelector('.rc-numero-remision');
  if(esRemisionYDespacho && !esPausa && (!remisionInput || !remisionInput.value.trim())){
    toast('Escribe el número de remisión antes de finalizar — esto cierra la orden');
    if(remisionInput) remisionInput.focus();
    return;
  }

  btn.disabled = true; btn.textContent = esPausa ? 'Pausando…' : 'Finalizando…';
  try{
    const now = new Date();
    const horaIniDate = new Date(fecha + 'T' + horaIni);
    const horaFin = now.toTimeString().slice(0,5);
    const hrs = Math.max(0, (now.getTime() - horaIniDate.getTime()) / 3600000);
    const rate = sessionRates.get(id) || 0;
    const selMaterial = card.querySelector('.rc-materia-select').value;
    const materiaPrima = selMaterial === '__otro__'
      ? (card.querySelector('.rc-materia-otro').value.trim() || null)
      : (selMaterial || null);
    const consumoNum = card.querySelector('.rc-consumo-num');
    const usaConsumoNumerico = consumoNum && consumoNum.style.display !== 'none';
    const consumoMp = usaConsumoNumerico
      ? (consumoNum.value ? consumoNum.value + (consumoNum.dataset.unidad ? ' ' + consumoNum.dataset.unidad : '') : null)
      : (card.querySelector('.rc-consumo').value.trim() || null);
    const numeroRemision = esRemisionYDespacho ? (remisionInput.value.trim() || null) : null;
    const updates = {
      hora_fin: horaFin,
      cantidad: parseFloat(card.querySelector('.rc-cantidad').value || 0),
      materia_prima: materiaPrima,
      consumo_mp: consumoMp,
      comentario: card.querySelector('.rc-comentario').value || null,
      reproceso: card.querySelector('.rc-reproceso').value,
      proceso_completo: !esPausa,
      motivo_pausa: esPausa ? motivoPausa : null,
      numero_remision: numeroRemision,
      tiempo_hr: hrs,
      valor_actividad: hrs * rate
    };
    const { data, error } = await sb.from('produccion').update(updates).eq('id', id).select();
    if(error) throw error;
    if(!data || !data.length) throw new Error('Supabase no devolvió el registro actualizado (revisa permisos RLS de UPDATE en produccion)');

    const idx = DB.produccion.findIndex(r => r.id === id);
    if(idx >= 0) DB.produccion[idx] = normProd(data[0]);

    let avisoConsumo = '';
    if(usaConsumoNumerico && materiaPrima){
      const cantidadConsumida = parseFloat(consumoNum.value);
      if(cantidadConsumida > 0){
        const resultado = await descontarInventarioYCargarCosto({
          nombre: materiaPrima, area: card.dataset.area, cantidad: cantidadConsumida,
          orden: data[0].orden, suborden: data[0].suborden, fecha: data[0].fecha, produccionId: data[0].id
        });
        avisoConsumo = avisoConsumoNoReflejado(resultado, materiaPrima);
      }
    }

    let avisoCierre = '';
    if(esRemisionYDespacho && !esPausa && numeroRemision && data[0].orden != null){
      try{
        const { error: errOrden } = await sb.from('opp_ordenes')
          .update({ estado: 'Cerrada', numero_remision: numeroRemision }).eq('orden', data[0].orden);
        if(errOrden) throw errOrden;
        const o = DB.opp_ordenes.find(x => x.orden === data[0].orden);
        if(o){ o.estado = 'Cerrada'; o.numero_remision = numeroRemision; }
        avisoCierre = ` · Orden ${data[0].orden} CERRADA (remisión ${numeroRemision})`;
      }catch(err){
        console.error('No se pudo cerrar la orden:', err);
        avisoCierre = ' · ⚠️ No se pudo cerrar la orden — revisa la consola';
      }
    }

    const avisoExtra = avisoConsumo + avisoCierre;
    toast((esPausa ? `Actividad pausada (${motivoPausa}) · ${fmtNum(hrs,2)} h registradas` : 'Actividad finalizada · ' + fmtNum(hrs,2) + ' h registradas') + avisoExtra, avisoExtra ? 7000 : undefined);

    clearInterval(timerIntervals.get(id));
    timerIntervals.delete(id);
    sessionRates.delete(id);
    card.remove();
    if(!document.querySelectorAll('.reg-running-card').length){
      document.getElementById('reg-running-list').innerHTML = '<p style="color:var(--ink-faint);font-size:13px">No tienes actividades en curso. Inicia una arriba.</p>';
      document.getElementById('reg-hint').textContent = 'sin actividades en curso ahora';
    }
    renderRecentReg();
    const note = document.getElementById('data-note');
    if(note) note.textContent = 'Conectado · ' + DB.produccion.length + ' registros';
    if(onChangeCallback) onChangeCallback();
  }catch(err){
    console.error(err);
    toast('Error al finalizar — revisa la consola');
  }finally{
    btn.disabled = false; btn.textContent = esPausa ? '⏸ Pausar esta actividad' : '⏹ Finalizar esta actividad';
  }
}

// onChange: función que la página llama después de iniciar/finalizar una
// actividad, para refrescar lo que sea propio de esa pantalla (tableros
// gerenciales en index.html, o solo la lista de órdenes vivas en registro.html).
export function initRegistrar(onChange){
  onChangeCallback = onChange || null;
  populateReg();
  document.getElementById('r-area').addEventListener('change', () => { populateActividadReg(); populateMaquinaReg(); populateSubprocesoReg(); });
  document.getElementById('r-orden').addEventListener('change', () => { populatePiezaReg(); limpiarErrorCampo(document.getElementById('r-orden')); });
  document.getElementById('r-pieza').addEventListener('change', () => limpiarErrorCampo(document.getElementById('r-pieza')));
  document.getElementById('r-sin-orden').addEventListener('change', toggleSinOrden);
  document.getElementById('r-operario').addEventListener('change', () => { refreshRunningSessions(); renderRecentReg(); });
  document.getElementById('r-start').addEventListener('click', startActivity);
  renderRecentReg();
}
