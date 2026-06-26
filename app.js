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
      fecha: r.fecha, operario: r.operario, horaIni: r.hora_ini, horaFin: r.hora_fin,
      actividad: r.actividad, area: r.area, cantidad: r.cantidad, orden: r.orden,
      cliente: r.cliente, trabajo: r.trabajo, materiaPrima: r.materia_prima,
      consumoMP: r.consumo_mp, comentario: r.comentario, tiempoHr: r.tiempo_hr,
      valorActividad: r.valor_actividad, despachado: r.despachado, inventario: r.inventario,
      reproceso: r.reproceso, opp: r.opp
    };
  }

  async function loadAll(){
    setNote('Cargando datos desde Supabase…');
    const [p1, p2, p3, p4, p5] = await Promise.all([
      sb.from('personal').select('*'),
      sb.from('maquinas').select('*'),
      sb.from('actividades').select('*'),
      sb.from('pedidos').select('*'),
      sb.from('produccion').select('*').order('fecha', { ascending: false }).limit(5000)
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
    DB.pedidos = p4.data || [];
    DB.produccion = (p5.data || []).map(normProd);
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

  // ---------- REGISTRAR ----------
  function populateForm(){
    const opSel = document.getElementById('f-operario');
    opSel.innerHTML = DB.personal.filter(p=>p.activo).map(p=>`<option value="${p.nombre}" data-rate="${p.valor_hora||0}">${p.nombre} — ${p.cargo}</option>`).join('');

    const areas = Array.from(new Set([
      ...DB.maquinas.map(m=>m.area),
      ...DB.actividades.map(a=>a.area)
    ])).filter(Boolean).sort();
    const areaSel = document.getElementById('f-area');
    areaSel.innerHTML = areas.map(a=>`<option value="${a}">${a}</option>`).join('');
    areaSel.addEventListener('change', populateActividadSelect);
    populateActividadSelect();

    document.getElementById('f-fecha').value = new Date().toISOString().slice(0,10);
    ['f-horaini','f-horafin','f-operario'].forEach(id=>document.getElementById(id).addEventListener('input', updatePreview));
  }
  function populateActividadSelect(){
    const area = document.getElementById('f-area').value;
    const actSel = document.getElementById('f-actividad');
    const acts = DB.actividades.filter(a=>a.area===area);
    actSel.innerHTML = acts.map(a=>`<option value="${a.etiqueta}">${a.etiqueta}</option>`).join('') || '<option value="">Sin actividades para esta área</option>';
  }
  function updatePreview(){
    const ini = document.getElementById('f-horaini').value;
    const fin = document.getElementById('f-horafin').value;
    const opSel = document.getElementById('f-operario');
    const rate = parseFloat(opSel.selectedOptions[0]?.dataset.rate || 0);
    let txt = 'Tiempo: — · Costo estimado: —';
    if(ini && fin){
      const [h1,m1]=ini.split(':').map(Number), [h2,m2]=fin.split(':').map(Number);
      let mins=(h2*60+m2)-(h1*60+m1); if(mins<0) mins+=24*60;
      const hrs = mins/60;
      txt = `Tiempo: ${hrs.toFixed(2)} h · Costo estimado: ${fmtCOP(hrs*rate)}`;
    }
    document.getElementById('f-preview').textContent = txt;
  }

  async function handleSubmit(ev){
    ev.preventDefault();
    const btn = ev.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try{
      const ini = document.getElementById('f-horaini').value, fin = document.getElementById('f-horafin').value;
      const [h1,m1]=ini.split(':').map(Number), [h2,m2]=fin.split(':').map(Number);
      let mins=(h2*60+m2)-(h1*60+m1); if(mins<0) mins+=24*60;
      const hrs = mins/60;
      const opSel = document.getElementById('f-operario');
      const rate = parseFloat(opSel.selectedOptions[0]?.dataset.rate || 0);
      const ordenRaw = document.getElementById('f-orden').value;
      const orden = ordenRaw ? (isNaN(Number(ordenRaw)) ? null : Number(ordenRaw)) : null;

      const row = {
        fecha: document.getElementById('f-fecha').value,
        operario: opSel.value,
        hora_ini: ini, hora_fin: fin,
        actividad: document.getElementById('f-actividad').value,
        area: document.getElementById('f-area').value,
        cantidad: parseFloat(document.getElementById('f-cantidad').value || 0),
        orden: orden,
        cliente: document.getElementById('f-cliente').value || null,
        trabajo: document.getElementById('f-trabajo').value || null,
        materia_prima: document.getElementById('f-materia').value || null,
        consumo_mp: document.getElementById('f-consumo').value || null,
        comentario: document.getElementById('f-comentario').value || null,
        tiempo_hr: hrs,
        valor_actividad: hrs * rate,
        reproceso: 'No',
        opp: ordenRaw || null
      };

      const { data, error } = await sb.from('produccion').insert([row]).select();
      if(error) throw error;

      DB.produccion.unshift(normProd(data[0]));
      toast('Registro guardado para todo el equipo');
      document.getElementById('form-registro').reset();
      document.getElementById('f-fecha').value = new Date().toISOString().slice(0,10);
      document.getElementById('f-preview').textContent = 'Tiempo: — · Costo estimado: —';
      renderRecentReg();
      renderGerencial();
      renderProduccion();
      renderOperario();
      document.getElementById('data-note').textContent = 'Conectado · ' + DB.produccion.length + ' registros';
    }catch(err){
      console.error(err);
      toast('Error al guardar — revisa la consola');
    }finally{
      btn.disabled = false; btn.textContent = 'Guardar registro';
    }
  }
  function renderRecentReg(){
    const recent = DB.produccion.slice(0,12);
    document.querySelector('#tbl-reg-recent tbody').innerHTML = recent.map(r=>`<tr><td>${(r.fecha||'').slice(0,10)}</td><td>${r.operario||'—'}</td><td>${r.actividad||'—'}</td><td>${r.orden??'—'}</td></tr>`).join('');
  }

  (async function init(){
    try{
      await loadAll();
    }catch(e){
      return; // ya se mostró el error en setNote
    }
    populateOperarioSelect();
    populateForm();
    document.getElementById('form-registro').addEventListener('submit', handleSubmit);
    renderRecentReg();
    renderGerencial();
    renderProduccion();
    renderOperario();
  })();
})();
