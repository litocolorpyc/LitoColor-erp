// Módulo del reloj checador. Lo usan TANTO index.html como registro.html,
// así que cualquier corrección aquí aplica a las dos pantallas a la vez.
import { sb } from './supabase-client.js';
import { DB, normProd } from './store.js';
import { toast, fmtNum } from './helpers.js';

const timerIntervals = new Map();
const sessionRates = new Map();
let onChangeCallback = null; // lo define quien inicialice este módulo

function renderRecentReg(){
  const tbody = document.querySelector('#tbl-reg-recent tbody');
  if(!tbody) return;
  const recent = DB.produccion.slice(0,12);
  tbody.innerHTML = recent.map(r=>{
    const estado = r.horaFin ? '<span class="estado-chip done">✓ Completo</span>' : '<span class="estado-chip estado-chip-warn">⏱ En curso</span>';
    return `<tr><td>${(r.fecha||'').slice(0,10)}</td><td>${r.operario||'—'}</td><td>${r.actividad||'—'}</td><td>${r.orden??'—'}</td><td>${estado}</td></tr>`;
  }).join('');
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
}

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
}

function runningCardHTML(row){
  return `<div class="reg-running-card" data-id="${row.id}">
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
      <div class="field"><label>Materia prima</label><input type="text" class="rc-materia" value="${row.materia_prima || ''}"></div>
      <div class="field"><label>Consumo</label><input type="text" class="rc-consumo" value="${row.consumo_mp || ''}"></div>
    </div>
    <div class="field full"><label>Comentario</label><textarea class="rc-comentario" rows="2">${row.comentario || ''}</textarea></div>
    <button type="button" class="btn-primary btn-clock rc-finish">⏹ Finalizar esta actividad</button>
  </div>`;
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
    startCardTimer(row.id, row.fecha, row.hora_ini);
  });
}

async function startActivity(){
  const nombre = document.getElementById('r-operario').value;
  if(!nombre){ toast('Selecciona tu nombre primero'); return; }
  const btn = document.getElementById('r-start');
  btn.disabled = true; btn.textContent = 'Iniciando…';
  try{
    const now = new Date();
    const fecha = now.toISOString().slice(0,10);
    const horaIni = now.toTimeString().slice(0,5);
    const ordenRaw = document.getElementById('r-orden').value;
    const orden = ordenRaw ? (isNaN(Number(ordenRaw)) ? null : Number(ordenRaw)) : null;
    const piezaOpt = document.getElementById('r-pieza').selectedOptions[0];
    const opValue = document.getElementById('r-pieza').value || null;
    const subordenSel = piezaOpt && piezaOpt.dataset.suborden ? parseInt(piezaOpt.dataset.suborden, 10) : null;
    const ordenInfo = DB.opp_ordenes.find(o => o.orden === orden);

    const row = {
      fecha, operario: nombre, hora_ini: horaIni, hora_fin: null,
      actividad: document.getElementById('r-actividad').value,
      area: document.getElementById('r-area').value,
      maquina: document.getElementById('r-maquina').value || null,
      orden, suborden: subordenSel, op: opValue,
      cliente: ordenInfo ? ordenInfo.cliente : null,
      trabajo: piezaOpt && piezaOpt.value ? piezaOpt.textContent.replace(/^\d+\.\s*/, '') : null,
      opp: ordenRaw || null
    };
    const { data, error } = await sb.from('produccion').insert([row]).select();
    if(error) throw error;
    if(!data || !data.length) throw new Error('Supabase no devolvió el registro creado');

    DB.produccion.unshift(normProd(data[0]));
    toast('Actividad iniciada · ' + horaIni);
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
    const updates = {
      hora_fin: horaFin,
      cantidad: parseFloat(card.querySelector('.rc-cantidad').value || 0),
      materia_prima: card.querySelector('.rc-materia').value || null,
      consumo_mp: card.querySelector('.rc-consumo').value || null,
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
  document.getElementById('r-orden').addEventListener('input', populatePiezaReg);
  document.getElementById('r-operario').addEventListener('change', refreshRunningSessions);
  document.getElementById('r-start').addEventListener('click', startActivity);
  renderRecentReg();
}
