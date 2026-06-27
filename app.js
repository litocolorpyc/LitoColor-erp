(function(){
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const AREA_COLORS = {
    'Litografia': '#185FA5', 'Diseño':'#3C3489', 'Impresión Digital':'#3C3489',
    'Guillotina':'#854F0B', 'Troquelado':'#BA7517', 'Plastificado':'#0F6E56',
    'Engomadora':'#993556', 'Terminado':'#D85A30', 'General':'#5F5E5A'
  };
  function areaColor(a){ return AREA_COLORS[a] || '#5F5E5A'; }
  function fmtCOP(n){ if(n==null||isNaN(n)) return '—'; return '$' + Math.round(n).toLocaleString('es-CO'); }
  function fmtNum(n,d){ if(n==null||isNaN(n)) return '—'; return Number(n).toLocaleString('es-CO',{maximumFractionDigits:d==null?1:d}); }
  function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), 2200); }
  function setNote(msg, isError){
    const el = document.getElementById('data-note');
    el.textContent = msg;
    el.style.color = isError ? 'var(--bad)' : '';
  }

  let DB = { personal: [], maquinas: [], actividades: [], pedidos: [], produccion: [] };

  // normaliza filas de supabase (snake_case) al formato usado por el dashboard (camelCase)
  function normProd(r){
    return {
      id: r.id, fecha: r.fecha, operario: r.operario, horaIni: r.hora_ini, horaFin: r.hora_fin,
      actividad: r.actividad, area: r.area, maquina: r.maquina, cantidad: r.cantidad, orden: r.orden,
      suborden: r.suborden, op: r.op,
      cliente: r.cliente, trabajo: r.trabajo, materiaPrima: r.materia_prima,
      consumoMP: r.consumo_mp, comentario: r.comentario, tiempoHr: r.tiempo_hr,
      valorActividad: r.valor_actividad, despachado: r.despachado, inventario: r.inventario,
      reproceso: r.reproceso, opp: r.opp
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
    const [p1, p2, p3, p4] = await Promise.all([
      sb.from('personal').select('*'),
      sb.from('maquinas').select('*'),
      sb.from('actividades').select('*'),
      sb.from('pedidos').select('*')
    ]);
    const errors = [p1.error, p2.error, p3.error, p4.error].filter(Boolean);
    if(errors.length){
      console.error(errors);
      setNote('No se pudo conectar a Supabase. Revisa config.js', true);
      throw errors[0];
    }
    DB.personal = p1.data || [];
    DB.maquinas = p2.data || [];
    DB.actividades = p3.data || [];
    DB.pedidos = p4.data || [];
    DB.produccion = (await fetchAllProduccion()).map(normProd);
    setNote('Conectado · ' + DB.produccion.length + ' registros');
  }

  function buildCodeMap(){
    const m = {};
    DB.actividades.forEach(a => { m[String(a.codigo)] = a; });
    return m;
  }
  function codeFromLabel(label){
    if(!label) return null;
    const m = String(label).match(/(\d+)/);
    return m ? m[1] : null;
  }

  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-'+btn.dataset.tab).classList.add('active');
    });
  });

  let charts = {};
  function makeChart(id, config){
    const el = document.getElementById(id);
    if(charts[id]) charts[id].destroy();
    charts[id] = new Chart(el, config);
  }
  function baseBarOpts(stacked, horizontal){
    return { responsive:true, indexAxis: horizontal?'y':'x',
      plugins:{ legend:{ display: !horizontal, labels:{ boxWidth:10, font:{size:11} } } },
      scales:{ x:{ stacked: !!stacked, grid:{display:false}, ticks:{font:{size:10}} }, y:{ stacked: !!stacked, grid:{color:'rgba(150,150,150,.15)'}, ticks:{font:{size:10}} } } };
  }

  // ---------- GERENCIAL ----------
  function renderGerencial(){
    const ingresos = DB.pedidos.reduce((s,p)=>s+(p.total||0),0);
    const costoMO = DB.produccion.reduce((s,r)=>s+(r.valorActividad||0),0);
    const margen = ingresos - costoMO;
    const ordenes = new Set(DB.pedidos.map(p=>p.orden)).size;

    document.getElementById('ger-kpis').innerHTML = `
      <div class="kpi"><div class="lbl">Ingresos facturados</div><div class="val">${fmtCOP(ingresos)}</div><div class="sub">según pedidos con valor</div></div>
      <div class="kpi"><div class="lbl">Costo mano de obra</div><div class="val">${fmtCOP(costoMO)}</div><div class="sub">según bitácora de producción</div></div>
      <div class="kpi"><div class="lbl">Margen estimado</div><div class="val ${margen>=0?'pos':'neg'}">${fmtCOP(margen)}</div><div class="sub">ingresos − mano de obra</div></div>
      <div class="kpi"><div class="lbl">Órdenes con valor</div><div class="val">${ordenes}</div><div class="sub">registradas en pedidos</div></div>`;

    const mesesMap = {};
    DB.pedidos.forEach(p=>{ if(!p.fecha) return; const k=p.fecha.slice(0,7); mesesMap[k]=mesesMap[k]||{ing:0,cost:0}; mesesMap[k].ing+=(p.total||0); });
    DB.produccion.forEach(r=>{ if(!r.fecha) return; const k=r.fecha.slice(0,7); mesesMap[k]=mesesMap[k]||{ing:0,cost:0}; mesesMap[k].cost+=(r.valorActividad||0); });
    const meses = Object.keys(mesesMap).sort();
    makeChart('chart-ger-mes', { type:'bar', data:{ labels: meses,
      datasets:[
        {label:'Ingresos', data: meses.map(m=>mesesMap[m].ing), backgroundColor:'#185FA5'},
        {label:'Costo M.O.', data: meses.map(m=>mesesMap[m].cost), backgroundColor:'#C24A1F'}
      ]}, options: baseBarOpts(true) });

    const clMap = {};
    DB.pedidos.forEach(p=>{ clMap[p.cliente]=(clMap[p.cliente]||0)+(p.total||0); });
    const topCl = Object.entries(clMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
    makeChart('chart-ger-clientes', { type:'bar', data:{ labels: topCl.map(c=>c[0]),
      datasets:[{label:'Ingreso', data: topCl.map(c=>c[1]), backgroundColor:'#C24A1F'}]},
      options: baseBarOpts(false, true) });

    const ordIng = {}, ordCliente = {}, ordTrabajo = {};
    DB.pedidos.forEach(p=>{ ordIng[p.orden]=(ordIng[p.orden]||0)+(p.total||0); ordCliente[p.orden]=p.cliente; ordTrabajo[p.orden]=ordTrabajo[p.orden]||p.trabajo; });
    const ordCost = {};
    DB.produccion.forEach(r=>{ if(r.orden==null) return; ordCost[r.orden]=(ordCost[r.orden]||0)+(r.valorActividad||0); });
    const rows = Object.keys(ordIng).map(o=>({orden:o, cliente:ordCliente[o], trabajo:ordTrabajo[o], ing:ordIng[o], cost:ordCost[o]||0}))
      .sort((a,b)=>b.ing-a.ing).slice(0,15);
    document.querySelector('#tbl-ger-ordenes tbody').innerHTML = rows.map(r=>{
      const m=r.ing-r.cost;
      return `<tr><td>${r.orden}</td><td>${r.cliente||'—'}</td><td>${(r.trabajo||'—').toString().trim()}</td><td class="num">${fmtCOP(r.ing)}</td><td class="num">${fmtCOP(r.cost)}</td><td class="num" style="color:${m>=0?'var(--good)':'var(--bad)'}">${fmtCOP(m)}</td></tr>`;
    }).join('');
  }

  // ---------- PRODUCCION ----------
  function renderProduccion(){
    const codeMap = buildCodeMap();
    const horasTot = DB.produccion.reduce((s,r)=>s+(r.tiempoHr||0),0);
    const piezasTot = DB.produccion.reduce((s,r)=>s+(r.cantidad||0),0);
    const directaHrs = DB.produccion.reduce((s,r)=>{ const c=codeMap[codeFromLabel(r.actividad)]; return s + ((c&&c.categoria==='Directa')?(r.tiempoHr||0):0); },0);
    const eficiencia = horasTot>0 ? (directaHrs/horasTot*100) : 0;

    document.getElementById('prod-kpis').innerHTML = `
      <div class="kpi"><div class="lbl">Horas registradas</div><div class="val">${fmtNum(horasTot)}</div><div class="sub">${DB.produccion.length} registros</div></div>
      <div class="kpi"><div class="lbl">Piezas producidas</div><div class="val">${fmtNum(piezasTot,0)}</div><div class="sub">suma de cantidad producida</div></div>
      <div class="kpi"><div class="lbl">% tiempo directo</div><div class="val">${fmtNum(eficiencia,0)}%</div><div class="sub">horas directas / horas totales</div></div>`;

    const areaMap = {};
    DB.produccion.forEach(r=>{ const a=r.area||'General'; areaMap[a]=areaMap[a]||{h:0,p:0,c:0,n:0}; areaMap[a].h+=(r.tiempoHr||0); areaMap[a].p+=(r.cantidad||0); areaMap[a].c+=(r.valorActividad||0); areaMap[a].n+=1; });
    const areas = Object.keys(areaMap).sort((a,b)=>areaMap[b].h-areaMap[a].h);
    makeChart('chart-prod-area', { type:'bar', data:{ labels:areas,
      datasets:[{ label:'Horas', data: areas.map(a=>areaMap[a].h), backgroundColor: areas.map(a=>areaColor(a)) }]},
      options: baseBarOpts(false,true) });

    const catMap = {};
    DB.produccion.forEach(r=>{ const c=codeMap[codeFromLabel(r.actividad)]; const cat = c?c.categoria:'Sin clasificar'; catMap[cat]=(catMap[cat]||0)+(r.tiempoHr||0); });
    const cats = Object.keys(catMap);
    makeChart('chart-prod-categoria', { type:'doughnut', data:{ labels:cats, datasets:[{ data: cats.map(c=>catMap[c]),
      backgroundColor:['#185FA5','#BA7517','#A32D2D','#5F5E5A','#0F6E56'] }]},
      options:{ plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10, font:{size:11} } } } } });

    document.querySelector('#tbl-prod-area tbody').innerHTML = areas.map(a=>{
      const d=areaMap[a];
      return `<tr><td><span class="badge" style="background:${areaColor(a)}22;color:${areaColor(a)}">${a}</span></td><td class="num">${fmtNum(d.h)}</td><td class="num">${fmtNum(d.p,0)}</td><td class="num">${fmtCOP(d.c)}</td><td class="num">${d.n}</td></tr>`;
    }).join('');
  }

  // ---------- OPERARIO ----------
  function populateOperarioSelect(){
    const sel = document.getElementById('op-select');
    const names = new Set(DB.personal.filter(p=>p.activo).map(p=>p.nombre));
    DB.produccion.forEach(r=>{ if(r.operario) names.add(r.operario); });
    sel.innerHTML = '<option value="__ALL__">Todos los operarios</option>' + Array.from(names).sort().map(n=>`<option value="${n}">${n}</option>`).join('');
    sel.addEventListener('change', renderOperario);
  }
  function renderOperario(){
    const sel = document.getElementById('op-select').value;
    const recs = DB.produccion.filter(r=> sel==='__ALL__' ? true : (r.operario||'').trim().startsWith(sel.split(' ')[0]) || r.operario===sel );
    const horas = recs.reduce((s,r)=>s+(r.tiempoHr||0),0);
    const valor = recs.reduce((s,r)=>s+(r.valorActividad||0),0);
    document.getElementById('op-chart-hint').textContent = sel==='__ALL__' ? 'de toda la planta' : 'de '+sel;
    document.getElementById('op-kpis').innerHTML = `
      <div class="kpi"><div class="lbl">Horas trabajadas</div><div class="val">${fmtNum(horas)}</div><div class="sub">${recs.length} registros</div></div>
      <div class="kpi"><div class="lbl">Valor generado</div><div class="val">${fmtCOP(valor)}</div><div class="sub">costo de mano de obra</div></div>
      <div class="kpi"><div class="lbl">Promedio por registro</div><div class="val">${fmtNum(recs.length?horas/recs.length:0,2)} h</div><div class="sub">duración típica de actividad</div></div>`;

    const areaMap = {};
    recs.forEach(r=>{ const a=r.area||'General'; areaMap[a]=(areaMap[a]||0)+(r.tiempoHr||0); });
    const areas = Object.keys(areaMap).sort((a,b)=>areaMap[b]-areaMap[a]);
    makeChart('chart-op-area', { type:'bar', data:{ labels:areas, datasets:[{ label:'Horas', data:areas.map(a=>areaMap[a]), backgroundColor: areas.map(a=>areaColor(a)) }]},
      options: baseBarOpts(false,true) });

    const recent = recs.slice().sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')).slice(0,15);
    document.querySelector('#tbl-op-log tbody').innerHTML = recent.map(r=>`<tr><td>${(r.fecha||'').slice(0,10)}</td><td>${r.actividad||'—'}</td><td>${r.orden??'—'}</td><td class="num">${fmtNum(r.cantidad,0)}</td><td class="num">${fmtNum(r.tiempoHr,2)}</td><td class="num">${fmtCOP(r.valorActividad)}</td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Sin registros</td></tr>';
  }

  // ---------- REGISTRAR (reloj checador) ----------
  let currentSession = null; // { id, horaIniDate, rate }
  let timerInterval = null;

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
    opSel.addEventListener('change', checkOpenSession);
    document.getElementById('r-start').addEventListener('click', startActivity);
    document.getElementById('r-finish').addEventListener('click', finishActivity);
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
    const piezas = (DB.opp_piezas || []).filter(p => p.orden === orden);
    sel.innerHTML = '<option value="">— Sin OPP / general —</option>' +
      piezas.map(p => `<option value="${p.op}" data-suborden="${p.suborden}">${p.suborden}. ${p.pieza || 'Pieza'}</option>`).join('');
  }

  async function checkOpenSession(){
    const nombre = document.getElementById('r-operario').value;
    if(!nombre){ showSetupState(); return; }
    const { data, error } = await sb.from('produccion').select('*')
      .eq('operario', nombre).is('hora_fin', null)
      .order('id', { ascending: false }).limit(1);
    if(error){ console.error(error); return; }
    if(data && data.length){
      resumeSession(data[0]);
    } else {
      showSetupState();
    }
  }

  function showSetupState(){
    clearInterval(timerInterval);
    currentSession = null;
    document.getElementById('reg-setup').style.display = '';
    document.getElementById('reg-running').style.display = 'none';
    document.getElementById('reg-hint').textContent = 'elige tu nombre para comenzar';
  }

  function resumeSession(row){
    const opSel = document.getElementById('r-operario');
    const rate = parseFloat(opSel.selectedOptions[0]?.dataset.rate || 0);
    currentSession = { id: row.id, horaIniDate: new Date(row.fecha + 'T' + row.hora_ini), rate };
    document.getElementById('reg-setup').style.display = 'none';
    document.getElementById('reg-running').style.display = '';
    document.getElementById('reg-hint').textContent = 'tienes una actividad en curso';
    document.getElementById('rr-operario').textContent = row.operario || '—';
    document.getElementById('rr-orden').textContent = (row.orden || '—') + (row.op ? ' / ' + row.op : '');
    document.getElementById('rr-actividad').textContent = row.actividad || '—';
    document.getElementById('rr-maquina').textContent = row.maquina || 'Trabajo manual';
    document.getElementById('rr-inicio').textContent = row.hora_ini || '—';
    document.getElementById('r-cantidad').value = row.cantidad || '';
    document.getElementById('r-materia').value = row.materia_prima || '';
    document.getElementById('r-consumo').value = row.consumo_mp || '';
    document.getElementById('r-comentario').value = row.comentario || '';
    document.getElementById('r-reproceso').value = row.reproceso || 'No';
    startTimerDisplay();
  }

  function startTimerDisplay(){
    clearInterval(timerInterval);
    const tick = () => {
      const ms = Date.now() - currentSession.horaIniDate.getTime();
      const totalSec = Math.max(0, Math.floor(ms / 1000));
      const h = String(Math.floor(totalSec/3600)).padStart(2,'0');
      const m = String(Math.floor((totalSec%3600)/60)).padStart(2,'0');
      const s = String(totalSec%60).padStart(2,'0');
      document.getElementById('rr-timer').textContent = `${h}:${m}:${s}`;
    };
    tick();
    timerInterval = setInterval(tick, 1000);
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
      const ordenInfo = (DB.opp_ordenes || []).find(o => o.orden === orden);

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

      DB.produccion.unshift(normProd(data[0]));
      toast('Actividad iniciada · ' + horaIni);
      resumeSession(data[0]);
      renderRecentReg();
    }catch(err){
      console.error(err);
      toast('Error al iniciar — revisa la consola');
    }finally{
      btn.disabled = false; btn.textContent = '▶ Iniciar actividad';
    }
  }

  async function finishActivity(){
    if(!currentSession) return;
    const btn = document.getElementById('r-finish');
    btn.disabled = true; btn.textContent = 'Finalizando…';
    try{
      const now = new Date();
      const horaFin = now.toTimeString().slice(0,5);
      const hrs = Math.max(0, (now.getTime() - currentSession.horaIniDate.getTime()) / 3600000);
      const updates = {
        hora_fin: horaFin,
        cantidad: parseFloat(document.getElementById('r-cantidad').value || 0),
        materia_prima: document.getElementById('r-materia').value || null,
        consumo_mp: document.getElementById('r-consumo').value || null,
        comentario: document.getElementById('r-comentario').value || null,
        reproceso: document.getElementById('r-reproceso').value,
        tiempo_hr: hrs,
        valor_actividad: hrs * currentSession.rate
      };
      const { data, error } = await sb.from('produccion').update(updates).eq('id', currentSession.id).select();
      if(error) throw error;

      const idx = DB.produccion.findIndex(r => r.id === currentSession.id);
      if(idx >= 0) DB.produccion[idx] = normProd(data[0]);
      toast('Actividad finalizada · ' + fmtNum(hrs,2) + ' h registradas');

      clearInterval(timerInterval);
      currentSession = null;
      document.getElementById('r-orden').value = '';
      document.getElementById('r-pieza').innerHTML = '<option value="">— Sin OPP / general —</option>';
      showSetupState();
      renderRecentReg();
      renderGerencial();
      renderProduccion();
      renderOperario();
      renderEstadoOrdenes();
      document.getElementById('data-note').textContent = 'Conectado · ' + DB.produccion.length + ' registros';
    }catch(err){
      console.error(err);
      toast('Error al finalizar — revisa la consola');
    }finally{
      btn.disabled = false; btn.textContent = '⏹ Finalizar actividad';
    }
  }

  function renderRecentReg(){
    const recent = DB.produccion.slice(0,12);
    document.querySelector('#tbl-reg-recent tbody').innerHTML = recent.map(r=>{
      const estado = r.horaFin ? '<span class="estado-chip done">✓ Completo</span>' : '<span class="estado-chip estado-chip-warn">⏱ En curso</span>';
      return `<tr><td>${(r.fecha||'').slice(0,10)}</td><td>${r.operario||'—'}</td><td>${r.actividad||'—'}</td><td>${r.orden??'—'}</td><td>${estado}</td></tr>`;
    }).join('');
  }

  // ========================================================
  // ORDENES (OPP)
  // ========================================================
  let oppPiezaCount = 0;

  function calcPorPliego(pliegoW, pliegoH, piezaW, piezaH){
    if(!pliegoW || !pliegoH || !piezaW || !piezaH) return 0;
    const a = Math.floor(pliegoW / piezaW) * Math.floor(pliegoH / piezaH);
    const b = Math.floor(pliegoW / piezaH) * Math.floor(pliegoH / piezaW);
    return Math.max(a, b);
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
    recalcPieza(node);
    updateOppPreview();
    return node;
  }

  function recalcPieza(node){
    const cantidad = parseFloat(node.querySelector('.f-cantidad').value) || 0;
    const unidadesMontaje = parseFloat(node.querySelector('.f-unidades-montaje').value) || 1;
    const tamAncho = parseFloat(node.querySelector('.f-tam-ancho').value) || 0;
    const tamAlto = parseFloat(node.querySelector('.f-tam-alto').value) || 0;
    const pliego = node.querySelector('.f-pliego').value.split('x').map(Number);
    const medidaAnchoEl = node.querySelector('.f-medida-ancho');
    const medidaAltoEl = node.querySelector('.f-medida-alto');

    // sugerir medida con margen (tamaño + 5cm) solo si el campo está vacío
    if(!medidaAnchoEl.dataset.touched && tamAncho){
      medidaAnchoEl.value = (tamAncho + 5).toFixed(1);
    }
    if(!medidaAltoEl.dataset.touched && tamAlto){
      medidaAltoEl.value = (tamAlto + 5).toFixed(1);
    }
    medidaAnchoEl.oninput = () => medidaAnchoEl.dataset.touched = '1';
    medidaAltoEl.oninput = () => medidaAltoEl.dataset.touched = '1';

    const medidaAncho = parseFloat(medidaAnchoEl.value) || 0;
    const medidaAlto = parseFloat(medidaAltoEl.value) || 0;

    const tamSolicitados = unidadesMontaje > 0 ? Math.ceil(cantidad / unidadesMontaje) : cantidad;
    node.querySelector('.f-tam-solicitados').value = tamSolicitados || 0;

    const porPliegoEl = node.querySelector('.f-tam-por-pliego');
    if(!porPliegoEl.dataset.touched){
      porPliegoEl.value = calcPorPliego(pliego[0], pliego[1], medidaAncho, medidaAlto) || '';
    }
    porPliegoEl.oninput = () => porPliegoEl.dataset.touched = '1';

    const programadosEl = node.querySelector('.f-tam-programados');
    if(!programadosEl.dataset.touched){
      programadosEl.value = tamSolicitados ? Math.round(tamSolicitados * 1.10) : '';
    }
    programadosEl.oninput = () => programadosEl.dataset.touched = '1';

    const porPliego = parseFloat(porPliegoEl.value) || 0;
    const programados = parseFloat(programadosEl.value) || 0;
    const pliegos = porPliego > 0 ? Math.ceil(programados / porPliego) : 0;
    node.querySelector('.f-pliegos-result').textContent = pliegos ? fmtNum(pliegos, 0) : '—';

    // auto-marcar procesos requeridos según los acabados ya seleccionados
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
      ...(DB.pedidos || []).map(p => p.orden),
      ...(DB.opp_ordenes || []).map(o => o.orden)
    ].filter(n => typeof n === 'number');
    const max = all.length ? Math.max(...all) : 5938;
    return max + 1;
  }

  async function loadOpp(){
    const [o1, o2] = await Promise.all([
      sb.from('opp_ordenes').select('*').order('orden', { ascending: false }),
      sb.from('opp_piezas').select('*')
    ]);
    DB.opp_ordenes = o1.data || [];
    DB.opp_piezas = o2.data || [];
    renderOppRecent();
  }

  function renderOppRecent(){
    const conteo = {};
    (DB.opp_piezas || []).forEach(p => { conteo[p.orden] = (conteo[p.orden] || 0) + 1; });
    const rows = (DB.opp_ordenes || []).slice(0, 20);
    document.querySelector('#tbl-opp-recent tbody').innerHTML = rows.map(o =>
      `<tr><td>${o.orden}</td><td>${o.cliente || '—'}</td><td>${o.producto || '—'}</td><td class="num">${conteo[o.orden] || 0}</td><td>${(o.fecha || '').slice(0,10)}</td></tr>`
    ).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">Sin órdenes registradas</td></tr>';
    renderEstadoOrdenes();
  }

  function areasCompletadasPorPieza(pieza){
    const recs = (DB.produccion || []).filter(r => r.op === pieza.op || (r.orden === pieza.orden && r.suborden === pieza.suborden));
    return new Set(recs.map(r => r.area).filter(Boolean));
  }

  function renderEstadoOrdenes(){
    const ordenes = (DB.opp_ordenes || []).slice(0, 15);
    const cont = document.getElementById('opp-estado-list');
    if(!ordenes.length){
      cont.innerHTML = '<p style="color:var(--ink-faint);font-size:13px">Aún no hay órdenes guardadas.</p>';
      return;
    }
    cont.innerHTML = ordenes.map(o => {
      const piezas = (DB.opp_piezas || []).filter(p => p.orden === o.orden);
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
      return `<div class="estado-orden">
        <div class="estado-orden-head"><b>Orden ${o.orden} — ${o.cliente || ''}</b><span class="card-hint">${o.producto || ''}</span></div>
        ${filas}
      </div>`;
    }).join('') || '<p style="color:var(--ink-faint);font-size:13px">Sin piezas asociadas todavía.</p>';
  }

  function resetOppForm(nextOrden){
    document.getElementById('opp-piezas-list').innerHTML = '';
    oppPiezaCount = 0;
    document.getElementById('opp-cliente').value = '';
    document.getElementById('opp-producto').value = '';
    document.getElementById('opp-orden').value = nextOrden != null ? nextOrden : suggestNextOrden();
    document.getElementById('opp-fecha').value = new Date().toISOString().slice(0,10);
    addPiezaCard();
  }

  function initOppForm(){
    document.getElementById('opp-orden').value = suggestNextOrden();
    document.getElementById('opp-fecha').value = new Date().toISOString().slice(0,10);
    document.getElementById('opp-add-pieza').addEventListener('click', () => addPiezaCard());
    document.getElementById('opp-save').addEventListener('click', saveOpp);
    document.getElementById('opp-reset').addEventListener('click', () => resetOppForm());
    addPiezaCard(); // arranca con 1 pieza lista para llenar
  }

  async function saveOpp(){
    const btn = document.getElementById('opp-save');
    const orden = parseInt(document.getElementById('opp-orden').value, 10);
    const cliente = document.getElementById('opp-cliente').value.trim();
    const cards = document.querySelectorAll('#opp-piezas-list .opp-pieza-card');

    if(!orden || !cliente){
      toast('Falta el número de orden o el cliente');
      return;
    }
    if(cards.length === 0){
      toast('Agrega al menos una pieza');
      return;
    }

    btn.disabled = true; btn.textContent = 'Guardando…';
    try{
      const { error: errOrden } = await sb.from('opp_ordenes').insert([{
        orden,
        cliente,
        producto: document.getElementById('opp-producto').value.trim() || null,
        fecha: document.getElementById('opp-fecha').value
      }]);
      if(errOrden) throw errOrden;

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

      toast('Orden ' + orden + ' guardada con ' + piezasPayload.length + ' pieza(s)');
      resetOppForm(orden + 1);
      await loadOpp();
    }catch(err){
      console.error(err);
      toast('Error al guardar la orden — revisa la consola');
    }finally{
      btn.disabled = false; btn.textContent = 'Guardar orden completa';
    }
  }

  (async function init(){
    try{
      await loadAll();
    }catch(e){
      return; // ya se mostró el error en setNote
    }
    populateOperarioSelect();
    populateReg();
    renderRecentReg();
    renderGerencial();
    renderProduccion();
    renderOperario();
    await loadOpp();
    initOppForm();
  })();
})();
