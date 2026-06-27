(function(){
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function fmtCOP(n){ if(n==null||isNaN(n)) return '—'; return '$' + Math.round(n).toLocaleString('es-CO'); }
  function fmtNum(n,d){ if(n==null||isNaN(n)) return '—'; return Number(n).toLocaleString('es-CO',{maximumFractionDigits:d==null?1:d}); }
  function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), 2200); }
  function setNote(msg, isError){
    const el = document.getElementById('data-note');
    el.textContent = msg;
    el.style.color = isError ? 'var(--bad)' : '';
  }

  let DB = { personal: [], maquinas: [], actividades: [], opp_ordenes: [], opp_piezas: [], produccion: [] };

  function normProd(r){
    return {
      id: r.id, fecha: r.fecha, operario: r.operario, horaIni: r.hora_ini, horaFin: r.hora_fin,
      actividad: r.actividad, area: r.area, maquina: r.maquina, cantidad: r.cantidad, orden: r.orden,
      suborden: r.suborden, op: r.op,
      cliente: r.cliente, trabajo: r.trabajo, materiaPrima: r.materia_prima,
      consumoMP: r.consumo_mp, comentario: r.comentario, tiempoHr: r.tiempo_hr,
      valorActividad: r.valor_actividad, reproceso: r.reproceso, opp: r.opp
    };
  }

  async function fetchAllProduccion(){
    let all = [];
    let from = 0;
    const pageSize = 1000;
    while(true){
      const { data, error } = await sb.from('produccion').select('*')
        .order('fecha', { ascending: false })
        .range(from, from + pageSize - 1);
      if(error) throw error;
      all = all.concat(data || []);
      if(!data || data.length < pageSize) break;
      from += pageSize;
    }
    return all;
  }

  async function loadAll(){
    setNote('Cargando datos desde Supabase…');
    const [p1, p2, p3, p4, p5] = await Promise.all([
      sb.from('personal').select('*'),
      sb.from('maquinas').select('*'),
      sb.from('actividades').select('*'),
      sb.from('opp_ordenes').select('*'),
      sb.from('opp_piezas').select('*')
    ]);
    const errors = [p1.error, p2.error, p3.error, p4.error, p5.error].filter(Boolean);
    if(errors.length){
      console.error(errors);
      setNote('No se pudo conectar a Supabase. Revisa config.js', true);
      throw errors[0];
    }
    DB.personal = p1.data || [];
    DB.maquinas = p2.data || [];
    DB.actividades = p3.data || [];
    DB.opp_ordenes = p4.data || [];
    DB.opp_piezas = p5.data || [];
    DB.produccion = (await fetchAllProduccion()).map(normProd);
    setNote('Conectado · ' + DB.produccion.length + ' registros');
  }

  function areasCompletadasPorPieza(pieza){
    const recs = DB.produccion.filter(r => r.op === pieza.op || (r.orden === pieza.orden && r.suborden === pieza.suborden));
    return new Set(recs.map(r => r.area).filter(Boolean));
  }

  function renderOrdenesVivas(){
    const tbody = document.querySelector('#tbl-ordenes-vivas tbody');
    if(!tbody) return;
    const filas = [];
    DB.opp_ordenes.forEach(o => {
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

  function renderRecentReg(){
    const recent = DB.produccion.slice(0,12);
    document.querySelector('#tbl-reg-recent tbody').innerHTML = recent.map(r=>{
      const estado = r.horaFin ? '<span class="estado-chip done">✓ Completo</span>' : '<span class="estado-chip estado-chip-warn">⏱ En curso</span>';
      return `<tr><td>${(r.fecha||'').slice(0,10)}</td><td>${r.operario||'—'}</td><td>${r.actividad||'—'}</td><td>${r.orden??'—'}</td><td>${estado}</td></tr>`;
    }).join('');
  }

  // ---------- REGISTRAR (reloj checador, multi-actividad) ----------
  const timerIntervals = new Map();
  const sessionRates = new Map();

  function populateReg(){
    const opSel = document.getElementById('r-operario');
    opSel.innerHTML = '<option value="">Selecciona tu nombre…</option>' +
      DB.personal.filter(p=>p.activo).map(p=>`<option value="${p.nombre}" data-rate="${p.valor_hora||0}">${p.nombre} — ${p.cargo}</option>`).join('');

    const areas = Array.from(new Set([
      ...DB.maquinas.map(m=>m.area),
      ...DB.actividades.map(a=>a.area)
    ])).filter(Boolean).sort();
    const areaSel = document.getElementById('r-area');
    areaSel.innerHTML = areas.map(a=>`<option value="${a}">${a}</option>`).join('');
    areaSel.addEventListener('change', () => { populateActividadReg(); populateMaquinaReg(); });
    populateActividadReg();
    populateMaquinaReg();

    document.getElementById('r-orden').addEventListener('input', populatePiezaReg);
    opSel.addEventListener('change', refreshRunningSessions);
    document.getElementById('r-start').addEventListener('click', startActivity);
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
    const maqs = DB.maquinas.filter(m=>m.area===area);
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
    const el = document.querySelector(`[data-timer="${id}"]`);
    const tick = () => {
      const ms = Date.now() - horaIniDate.getTime();
      const totalSec = Math.max(0, Math.floor(ms / 1000));
      const h = String(Math.floor(totalSec/3600)).padStart(2,'0');
      const m = String(Math.floor((totalSec%3600)/60)).padStart(2,'0');
      const s = String(totalSec%60).padStart(2,'0');
      if(el) el.textContent = `${h}:${m}:${s}`;
    };
    tick();
    timerIntervals.set(id, setInterval(tick, 1000));
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
      renderOrdenesVivas();
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
      if(!data || !data.length) throw new Error('Supabase no devolvió el registro actualizado (revisa los permisos RLS de UPDATE en produccion)');

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
      renderOrdenesVivas();
      document.getElementById('data-note').textContent = 'Conectado · ' + DB.produccion.length + ' registros';
    }catch(err){
      console.error(err);
      toast('Error al finalizar — revisa la consola');
    }finally{
      btn.disabled = false; btn.textContent = '⏹ Finalizar esta actividad';
    }
  }

  (async function init(){
    try{ await loadAll(); }catch(e){ return; }
    populateReg();
    renderRecentReg();
    renderOrdenesVivas();
  })();
})();
