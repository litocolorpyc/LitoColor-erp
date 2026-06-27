import { DB } from './store.js';
import { fmtCOP, fmtNum, areaColor, rangoFechas, rangoAnterior, deltaBadge, exportarExcel } from './helpers.js';

let charts = {};
function makeChart(id, config){
  const el = document.getElementById(id);
  if(!el) return;
  if(charts[id]) charts[id].destroy();
  charts[id] = new Chart(el, config);
}
function baseBarOpts(stacked, horizontal){
  return { responsive:true, indexAxis: horizontal?'y':'x',
    plugins:{ legend:{ display: !horizontal, labels:{ boxWidth:10, font:{size:11} } } },
    scales:{ x:{ stacked: !!stacked, grid:{display:false}, ticks:{font:{size:10}} }, y:{ stacked: !!stacked, grid:{color:'rgba(150,150,150,.15)'}, ticks:{font:{size:10}} } } };
}

function enRango(fecha, desde, hasta){
  if(!fecha) return false;
  const f = fecha.slice(0,10);
  return f >= desde && f <= hasta;
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

// ---------- GERENCIAL ----------
let rangoGer = rangoFechas('todo');
let ultimaRentabilidad = [];

function calcularGerencial(desde, hasta){
  const pedidos = DB.pedidos.filter(p => enRango(p.fecha, desde, hasta));
  const produccion = DB.produccion.filter(r => enRango(r.fecha, desde, hasta));
  const ingresos = pedidos.reduce((s,p)=>s+(p.total||0),0);
  const costoMO = produccion.reduce((s,r)=>s+(r.valorActividad||0),0);
  return { ingresos, costoMO, margen: ingresos - costoMO, ordenes: new Set(pedidos.map(p=>p.orden)).size, pedidos, produccion };
}

export function renderGerencial(){
  const { desde, hasta } = rangoGer;
  const esTodo = desde === '2000-01-01';
  const actual = calcularGerencial(desde, hasta);
  const ant = rangoAnterior(desde, hasta);
  const anterior = esTodo
    ? { ingresos:null, costoMO:null, margen:null, ordenes:null }
    : calcularGerencial(ant.desde, ant.hasta);

  document.getElementById('ger-kpis').innerHTML = `
    <div class="kpi"><div class="lbl">Ingresos facturados</div><div class="val">${fmtCOP(actual.ingresos)} ${deltaBadge(actual.ingresos, anterior.ingresos)}</div><div class="sub">según pedidos con valor</div></div>
    <div class="kpi"><div class="lbl">Costo mano de obra</div><div class="val">${fmtCOP(actual.costoMO)} ${deltaBadge(actual.costoMO, anterior.costoMO)}</div><div class="sub">según bitácora de producción</div></div>
    <div class="kpi"><div class="lbl">Margen estimado</div><div class="val ${actual.margen>=0?'pos':'neg'}">${fmtCOP(actual.margen)} ${deltaBadge(actual.margen, anterior.margen)}</div><div class="sub">ingresos − mano de obra</div></div>
    <div class="kpi"><div class="lbl">Órdenes con valor</div><div class="val">${actual.ordenes} ${deltaBadge(actual.ordenes, anterior.ordenes)}</div><div class="sub">vs. periodo anterior equivalente</div></div>`;

  const mesesMap = {};
  actual.pedidos.forEach(p=>{ if(!p.fecha) return; const k=p.fecha.slice(0,7); mesesMap[k]=mesesMap[k]||{ing:0,cost:0}; mesesMap[k].ing+=(p.total||0); });
  actual.produccion.forEach(r=>{ if(!r.fecha) return; const k=r.fecha.slice(0,7); mesesMap[k]=mesesMap[k]||{ing:0,cost:0}; mesesMap[k].cost+=(r.valorActividad||0); });
  const meses = Object.keys(mesesMap).sort();
  makeChart('chart-ger-mes', { type:'bar', data:{ labels: meses,
    datasets:[
      {label:'Ingresos', data: meses.map(m=>mesesMap[m].ing), backgroundColor:'#185FA5'},
      {label:'Costo M.O.', data: meses.map(m=>mesesMap[m].cost), backgroundColor:'#C24A1F'}
    ]}, options: baseBarOpts(true) });

  const clMap = {};
  actual.pedidos.forEach(p=>{ clMap[p.cliente]=(clMap[p.cliente]||0)+(p.total||0); });
  const topCl = Object.entries(clMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
  makeChart('chart-ger-clientes', { type:'bar', data:{ labels: topCl.map(c=>c[0]),
    datasets:[{label:'Ingreso', data: topCl.map(c=>c[1]), backgroundColor:'#C24A1F'}]},
    options: baseBarOpts(false, true) });

  const ordIng = {}, ordCliente = {}, ordTrabajo = {};
  actual.pedidos.forEach(p=>{ ordIng[p.orden]=(ordIng[p.orden]||0)+(p.total||0); ordCliente[p.orden]=p.cliente; ordTrabajo[p.orden]=ordTrabajo[p.orden]||p.trabajo; });
  const ordCost = {};
  actual.produccion.forEach(r=>{ if(r.orden==null) return; ordCost[r.orden]=(ordCost[r.orden]||0)+(r.valorActividad||0); });
  const rows = Object.keys(ordIng).map(o=>({orden:o, cliente:ordCliente[o], trabajo:ordTrabajo[o], ing:ordIng[o], cost:ordCost[o]||0}))
    .sort((a,b)=>b.ing-a.ing).slice(0,15);
  ultimaRentabilidad = rows;
  document.querySelector('#tbl-ger-ordenes tbody').innerHTML = rows.map(r=>{
    const m=r.ing-r.cost;
    return `<tr><td>${r.orden}</td><td>${r.cliente||'—'}</td><td>${(r.trabajo||'—').toString().trim()}</td><td class="num">${fmtCOP(r.ing)}</td><td class="num">${fmtCOP(r.cost)}</td><td class="num" style="color:${m>=0?'var(--good)':'var(--bad)'}">${fmtCOP(m)}</td></tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Sin datos en este rango</td></tr>';
}

function wireRangePresets(presetContainerId, desdeId, hastaId, getRango, setRango, onApply){
  const cont = document.getElementById(presetContainerId);
  if(!cont) return;
  cont.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      cont.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const r = rangoFechas(btn.dataset.preset);
      setRango(r);
      document.getElementById(desdeId).value = r.desde;
      document.getElementById(hastaId).value = r.hasta;
      onApply();
    });
  });
  [desdeId, hastaId].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      cont.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('active'));
      const desde = document.getElementById(desdeId).value;
      const hasta = document.getElementById(hastaId).value;
      if(desde && hasta){ setRango({desde, hasta}); onApply(); }
    });
  });
  const r = getRango();
  document.getElementById(desdeId).value = r.desde;
  document.getElementById(hastaId).value = r.hasta;
}

// ---------- PRODUCCION ----------
let rangoProd = rangoFechas('todo');
let ultimaProduccionArea = [];

export function renderProduccion(){
  const { desde, hasta } = rangoProd;
  const esTodo = desde === '2000-01-01';
  const codeMap = buildCodeMap();
  const produccion = DB.produccion.filter(r => enRango(r.fecha, desde, hasta));
  const ant = rangoAnterior(desde, hasta);
  const produccionAnt = esTodo ? [] : DB.produccion.filter(r => enRango(r.fecha, ant.desde, ant.hasta));
  const horasAntBase = esTodo ? null : produccionAnt.reduce((s,r)=>s+(r.tiempoHr||0),0);
  const piezasAntBase = esTodo ? null : produccionAnt.reduce((s,r)=>s+(r.cantidad||0),0);

  const horasTot = produccion.reduce((s,r)=>s+(r.tiempoHr||0),0);
  const piezasTot = produccion.reduce((s,r)=>s+(r.cantidad||0),0);
  const directaHrs = produccion.reduce((s,r)=>{ const c=codeMap[codeFromLabel(r.actividad)]; return s + ((c&&c.categoria==='Directa')?(r.tiempoHr||0):0); },0);
  const eficiencia = horasTot>0 ? (directaHrs/horasTot*100) : 0;

  document.getElementById('prod-kpis').innerHTML = `
    <div class="kpi"><div class="lbl">Horas registradas</div><div class="val">${fmtNum(horasTot)} ${deltaBadge(horasTot, horasAntBase)}</div><div class="sub">${produccion.length} registros</div></div>
    <div class="kpi"><div class="lbl">Piezas producidas</div><div class="val">${fmtNum(piezasTot,0)} ${deltaBadge(piezasTot, piezasAntBase)}</div><div class="sub">suma de cantidad producida</div></div>
    <div class="kpi"><div class="lbl">% tiempo directo</div><div class="val">${fmtNum(eficiencia,0)}%</div><div class="sub">horas directas / horas totales</div></div>`;

  const areaMap = {};
  produccion.forEach(r=>{ const a=r.area||'General'; areaMap[a]=areaMap[a]||{h:0,p:0,c:0,n:0}; areaMap[a].h+=(r.tiempoHr||0); areaMap[a].p+=(r.cantidad||0); areaMap[a].c+=(r.valorActividad||0); areaMap[a].n+=1; });
  const areas = Object.keys(areaMap).sort((a,b)=>areaMap[b].h-areaMap[a].h);
  ultimaProduccionArea = areas.map(a => ({ area:a, horas:areaMap[a].h, piezas:areaMap[a].p, costo:areaMap[a].c, registros:areaMap[a].n }));
  makeChart('chart-prod-area', { type:'bar', data:{ labels:areas,
    datasets:[{ label:'Horas', data: areas.map(a=>areaMap[a].h), backgroundColor: areas.map(a=>areaColor(a)) }]},
    options: baseBarOpts(false,true) });

  const catMap = {};
  produccion.forEach(r=>{ const c=codeMap[codeFromLabel(r.actividad)]; const cat = c?c.categoria:'Sin clasificar'; catMap[cat]=(catMap[cat]||0)+(r.tiempoHr||0); });
  const cats = Object.keys(catMap);
  makeChart('chart-prod-categoria', { type:'doughnut', data:{ labels:cats, datasets:[{ data: cats.map(c=>catMap[c]),
    backgroundColor:['#185FA5','#BA7517','#A32D2D','#5F5E5A','#0F6E56'] }]},
    options:{ plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10, font:{size:11} } } } } });

  document.querySelector('#tbl-prod-area tbody').innerHTML = areas.map(a=>{
    const d=areaMap[a];
    return `<tr><td><span class="badge" style="background:${areaColor(a)}22;color:${areaColor(a)}">${a}</span></td><td class="num">${fmtNum(d.h)}</td><td class="num">${fmtNum(d.p,0)}</td><td class="num">${fmtCOP(d.c)}</td><td class="num">${d.n}</td></tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">Sin datos en este rango</td></tr>';
}

// ---------- OPERARIO ----------
export function populateOperarioSelect(){
  const sel = document.getElementById('op-select');
  const names = new Set(DB.personal.filter(p=>p.activo).map(p=>p.nombre));
  DB.produccion.forEach(r=>{ if(r.operario) names.add(r.operario); });
  sel.innerHTML = '<option value="__ALL__">Todos los operarios</option>' + Array.from(names).sort().map(n=>`<option value="${n}">${n}</option>`).join('');
  sel.addEventListener('change', renderOperario);
}
export function renderOperario(){
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

export function initDashboardFilters(){
  wireRangePresets('ger-presets', 'ger-desde', 'ger-hasta', () => rangoGer, r => rangoGer = r, renderGerencial);
  wireRangePresets('prod-presets', 'prod-desde', 'prod-hasta', () => rangoProd, r => rangoProd = r, renderProduccion);
  wireExportButtons();
}

function wireExportButtons(){
  const btnRent = document.getElementById('export-rentabilidad');
  if(btnRent) btnRent.addEventListener('click', () => {
    exportarExcel('LitoColor_rentabilidad_por_orden.xlsx', [{
      nombre: 'Rentabilidad',
      filas: ultimaRentabilidad.map(r => ({ Orden: r.orden, Cliente: r.cliente, Trabajo: r.trabajo, Ingreso: r.ing, 'Costo M.O.': r.cost, Margen: r.ing - r.cost }))
    }]);
  });

  const btnProd = document.getElementById('export-produccion');
  if(btnProd) btnProd.addEventListener('click', () => {
    exportarExcel('LitoColor_produccion_por_area.xlsx', [{
      nombre: 'Producción por área',
      filas: ultimaProduccionArea.map(r => ({ Área: r.area, Horas: r.horas, Piezas: r.piezas, 'Costo M.O.': r.costo, Registros: r.registros }))
    }]);
  });

  const btnRespaldo = document.getElementById('export-respaldo');
  if(btnRespaldo) btnRespaldo.addEventListener('click', () => {
    exportarExcel('LitoColor_respaldo_completo.xlsx', [
      { nombre: 'Pedidos', filas: DB.pedidos.map(p => ({ OPP:p.opp, Fecha:p.fecha, Orden:p.orden, Suborden:p.suborden, Cliente:p.cliente, Producto:p.producto, Trabajo:p.trabajo, Pedido:p.pedido, Valor:p.valor, Total:p.total })) },
      { nombre: 'Producción', filas: DB.produccion.map(r => ({ Fecha:r.fecha, Operario:r.operario, HoraIni:r.horaIni, HoraFin:r.horaFin, Actividad:r.actividad, Área:r.area, Máquina:r.maquina, Cantidad:r.cantidad, Orden:r.orden, Pieza:r.op, Cliente:r.cliente, Trabajo:r.trabajo, TiempoHr:r.tiempoHr, ValorActividad:r.valorActividad })) },
      { nombre: 'Órdenes', filas: DB.opp_ordenes.map(o => ({ Orden:o.orden, Cliente:o.cliente, Producto:o.producto, Fecha:o.fecha, Estado:o.estado })) },
      { nombre: 'Empleados', filas: DB.personal.map(p => ({ Nombre:p.nombre, Cargo:p.cargo, 'Valor/hora':p.valor_hora, Activo:p.activo })) },
      { nombre: 'Máquinas', filas: DB.maquinas.map(m => ({ Código:m.codigo, Nombre:m.nombre, Área:m.area })) },
      { nombre: 'Clientes', filas: DB.clientes.map(c => ({ Nombre:c.nombre, NIT:c.nit, Teléfono:c.telefono, Correo:c.email, Ciudad:c.ciudad })) }
    ]);
  });
}
