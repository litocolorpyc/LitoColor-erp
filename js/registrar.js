// Módulo del reloj checador. Lo usan TANTO index.html como registro.html,
// así que cualquier corrección aquí aplica a las dos pantallas a la vez.
import { sb } from './supabase-client.js';
import { DB, normProd } from './store.js';
import { toast, fmtNum } from './helpers.js';
import { getOrdenesSeleccionables } from './ordenes.js';

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
    const estado = r.horaFin ? '<span class="estado-chip done">✓ Completo</span>' : '<span class="estado-chip estado-chip-warn">⏱ En curso</span>';
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

function populateActividadReg(){
  const area = document.getElementById('r-area').value;
  const actSel = document.getElementById('r-actividad');
  const acts = DB.actividades.filter(a=>a.area===area);
  actSel.innerHTML = acts.map(a=>`<option value="${a.etiqueta}">${a.etiqueta}</option>`).join('') || '<option value="">Sin actividades para esta área</option>';
}
function populateMaquinaReg(){
  const area = document.getElementById('r-area').value;
  const maqSel = document.getElementById('r-maquina');
  const maqs = DB.maquinas.filter(m=>m.area===area && m.activo!==false);
  maqSel.innerHTML = '<option value="">Trabajo manual (sin máquina)</option>' +
    maqs.map(m=>`<option value="${m.nombre}">${m.nombre}</option>`).join('');
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

export function populateReg(){
  const opSel = document.getElementById('r-operario');
  opSel.innerHTML = '<option value="">Selecciona tu nombre…</option>' +
    DB.personal.filter(p=>p.activo).map(p=>`<option value="${p.nombre}" data-rate="${p.valor_hora||0}">${p.nombre} — ${p.cargo}</option>`).join('');

  const areas = Array.from(new Set([
    ...DB.maquinas.map(m=>m.area),
    ...DB.actividades.map(a=>a.area)
  ])).filter(Boolean).sort();
  const areaSel = document.getElementById('r-area');
  const areaPrevia = areaSel.value;
  areaSel.innerHTML = areas.map(a=>`<option value="${a}">${a}</option>`).join('');
  if(areas.includes(areaPrevia)) areaSel.value = areaPrevia;
  populateActividadReg();
  populateMaquinaReg();
  populateOrdenSelect();
}

// Arma el <select> de insumos disponibles para el área de esta actividad,
// con una opción "Otro" para cuando el insumo no está en el maestro todavía.
function materialSelectOptionsHTML(area, valorActual){
  const opciones = DB.insumos_area.filter(m => m.area === area && m.activo !== false);
  const coincide = opciones.some(m => m.nombre === valorActual);
  const otroSeleccionado = !!valorActual && !coincide;
  const opts = ['<option value="">— Sin insumo registrado —</option>']
    .concat(opciones.map(m => `<option value="${m.nombre}"${m.nombre===valorActual?' selected':''}>${m.nombre}${m.unidad?' ('+m.unidad+')':''}</option>`))
    .concat([`<option value="__otro__"${otroSeleccionado?' selected':''}>Otro / no está en la lista…</option>`]);
  return opts.join('');
}

function parseCantidadConsumo(consumoMp){
  if(!consumoMp) return '';
  const m = String(consumoMp).match(/^([\d.,]+)/);
  return m ? m[1].replace(',', '.') : '';
}

function runningCardHTML(row){
  const otroSeleccionado = !!row.materia_prima && !DB.insumos_area.some(m => m.area === row.area && m.nombre === row.materia_prima);
  const insumoActual = DB.insumos_area.find(m => m.area === row.area && m.nombre === row.materia_prima);
  const unidadActual = insumoActual ? insumoActual.unidad : null;
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
      <div class="field">
        <label>Insumo consumido <span class="card-hint">(del área ${row.area || '—'})</span></label>
        <select class="rc-materia-select">${materialSelectOptionsHTML(row.area, row.materia_prima)}</select>
        <input type="text" class="rc-materia-otro" placeholder="especifica el insumo" style="display:${otroSeleccionado?'block':'none'};margin-top:5px" value="${otroSeleccionado ? row.materia_prima : ''}">
      </div>
      <div class="field">
        <label class="rc-consumo-label">Consumo${unidadActual ? ' (' + unidadActual + ')' : ''}</label>
        <input type="number" class="rc-consumo-num" min="0" step="0.01" placeholder="cantidad" data-unidad="${unidadActual || ''}" value="${unidadActual ? parseCantidadConsumo(row.consumo_mp) : ''}" style="display:${unidadActual ? 'block' : 'none'}">
        <input type="text" class="rc-consumo" placeholder="ej. 2 planchas, 150 g" value="${row.consumo_mp || ''}" style="display:${unidadActual ? 'none' : 'block'}">
      </div>
    </div>
    <div class="field full"><label>Comentario</label><textarea class="rc-comentario" rows="2">${row.comentario || ''}</textarea></div>
    <button type="button" class="btn-primary btn-clock rc-finish">⏹ Finalizar esta actividad</button>
  </div>`;
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
    const insumo = DB.insumos_area.find(m => m.area === area && m.nombre === sel.value);
    const unidad = insumo ? insumo.unidad : null;
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
  const hoy = new Date().toISOString().slice(0,10);
  const { data, error } = await sb.from('produccion').select('*')
    .eq('operario', nombre).eq('fecha', hoy).is('hora_fin', null)
    .order('id', { ascending: true });
  if(error){ console.error(error); toast('No se pudo consultar tus actividades en curso'); return; }

  const rate = parseFloat(document.getElementById('r-operario').selectedOptions[0]?.dataset.rate || 0);
  (data || []).forEach(row => sessionRates.set(row.id, rate));

  document.getElementById('reg-hint').textContent = data && data.length ? `${data.length} actividad(es) en curso` : 'sin actividades en curso ahora';

  if(!data || !data.length){
    cont.innerHTML = '<p style="color:var(--ink-faint);font-size:13px">No tienes actividades en curso. Inicia una arriba.</p>';
    return;
  }
  cont.innerHTML = data.map(row => runningCardHTML(row)).join('');
  data.forEach(row => {
    const card = cont.querySelector(`[data-id="${row.id}"]`);
    card.querySelector('.rc-finish').addEventListener('click', () => finishActivity(row.id, row.hora_ini, row.fecha));
    wireMaterialSelect(card);
    startCardTimer(row.id, row.fecha, row.hora_ini);
  });
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

  const btn = document.getElementById('r-start');
  btn.disabled = true; btn.textContent = 'Iniciando…';
  try{
    const now = new Date();
    const fecha = now.toISOString().slice(0,10);
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
      area: document.getElementById('r-area').value,
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

async function finishActivity(id, horaIni, fecha){
  const card = document.querySelector(`.reg-running-card[data-id="${id}"]`);
  const btn = card.querySelector('.rc-finish');
  btn.disabled = true; btn.textContent = 'Finalizando…';
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
    const updates = {
      hora_fin: horaFin,
      cantidad: parseFloat(card.querySelector('.rc-cantidad').value || 0),
      materia_prima: materiaPrima,
      consumo_mp: consumoMp,
      comentario: card.querySelector('.rc-comentario').value || null,
      reproceso: card.querySelector('.rc-reproceso').value,
      tiempo_hr: hrs,
      valor_actividad: hrs * rate
    };
    const { data, error } = await sb.from('produccion').update(updates).eq('id', id).select();
    if(error) throw error;
    if(!data || !data.length) throw new Error('Supabase no devolvió el registro actualizado (revisa permisos RLS de UPDATE en produccion)');

    const idx = DB.produccion.findIndex(r => r.id === id);
    if(idx >= 0) DB.produccion[idx] = normProd(data[0]);
    toast('Actividad finalizada · ' + fmtNum(hrs,2) + ' h registradas');

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
    btn.disabled = false; btn.textContent = '⏹ Finalizar esta actividad';
  }
}

// onChange: función que la página llama después de iniciar/finalizar una
// actividad, para refrescar lo que sea propio de esa pantalla (tableros
// gerenciales en index.html, o solo la lista de órdenes vivas en registro.html).
export function initRegistrar(onChange){
  onChangeCallback = onChange || null;
  populateReg();
  document.getElementById('r-area').addEventListener('change', () => { populateActividadReg(); populateMaquinaReg(); });
  document.getElementById('r-orden').addEventListener('change', () => { populatePiezaReg(); limpiarErrorCampo(document.getElementById('r-orden')); });
  document.getElementById('r-pieza').addEventListener('change', () => limpiarErrorCampo(document.getElementById('r-pieza')));
  document.getElementById('r-sin-orden').addEventListener('change', toggleSinOrden);
  document.getElementById('r-operario').addEventListener('change', () => { refreshRunningSessions(); renderRecentReg(); });
  document.getElementById('r-start').addEventListener('click', startActivity);
  renderRecentReg();
}
