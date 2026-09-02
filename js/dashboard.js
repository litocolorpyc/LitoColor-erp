import { sb } from './supabase-client.js';
import { DB, normProd } from './store.js';
import { fmtCOP, fmtNum, areaColor, rangoFechas, rangoAnterior, deltaBadge, exportarExcel, toast } from './helpers.js';
import { mostrarDetalleOrden, tipoTrabajoLabel, renderOppRecent, subprocesosDeArea, getOrdenDetalleActual } from './ordenes.js';
import { puedeEditarProduccion } from './auth.js';
import { listaAreasDisponibles, materialSelectOptionsHTML, unidadNumericaDelMaterial, parseCantidadConsumo, descontarInventarioYCargarCosto, revertirConsumoDeRegistro, avisoConsumoNoReflejado } from './registrar.js';
import { renderInventario } from './inventario.js';

// Cambia a la pestaña de Órdenes y abre el detalle completo de una orden —
// se usa desde las tablas del Gerencial donde se puede hacer click en una
// fila para ver de qué se trata esa orden.
function irAOrdenYVerDetalle(orden){
  const btnTab = document.querySelector('.tab-btn[data-tab="ordenes"]');
  if(!btnTab){ return; }
  btnTab.click();
  // pequeña espera para que el panel de Órdenes ya esté visible antes de
  // desplazarse y abrir el detalle.
  setTimeout(() => mostrarDetalleOrden(orden), 50);
}

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
let ultimaRentabilidadProducto = [];

function calcularGerencial(desde, hasta){
  const pedidos = DB.pedidos.filter(p => enRango(p.fecha, desde, hasta));
  const produccion = DB.produccion.filter(r => enRango(r.fecha, desde, hasta));
  const costosMov = DB.costos_movimientos.filter(m => enRango(m.fecha, desde, hasta));
  const ingresos = pedidos.reduce((s,p)=>s+(p.total||0),0);
  const costoMO = produccion.reduce((s,r)=>s+(r.valorActividad||0),0);
  const costosFijos = costosMov.filter(m=>m.tipo==='Fijo').reduce((s,m)=>s+(m.valor||0),0);
  const costosVariables = costosMov.filter(m=>m.tipo==='Variable').reduce((s,m)=>s+(m.valor||0),0);
  const otrosCostos = costosFijos + costosVariables;

  // Ingreso presupuestado (precio_venta_antes_iva de presupuesto_orden) — SIEMPRE
  // separado del ingreso facturado. presupuesto_orden no tiene fecha propia, así
  // que se filtra por la fecha de la orden (opp_ordenes) a la que pertenece.
  const ordenesEnRango = new Set(DB.opp_ordenes.filter(o => enRango(o.fecha, desde, hasta)).map(o => o.orden));
  const ingresosPresupuestados = DB.presupuesto_orden
    .filter(p => ordenesEnRango.has(p.orden))
    .reduce((s,p)=>s+(p.precio_venta_antes_iva||0),0);

  return { ingresos, ingresosPresupuestados, costoMO, otrosCostos, costosFijos, costosVariables,
    margen: ingresos - costoMO - otrosCostos,
    ordenes: new Set(pedidos.map(p=>p.orden)).size, pedidos, produccion, costosMov };
}

export function renderGerencial(){
  const { desde, hasta } = rangoGer;
  const esTodo = desde === '2024-01-01';
  const actual = calcularGerencial(desde, hasta);
  const ant = rangoAnterior(desde, hasta);
  const anterior = esTodo
    ? { ingresos:null, ingresosPresupuestados:null, costoMO:null, otrosCostos:null, margen:null, ordenes:null }
    : calcularGerencial(ant.desde, ant.hasta);

  document.getElementById('ger-kpis').innerHTML = `
    <div class="kpi"><div class="lbl">Ingresos facturados</div><div class="val">${fmtCOP(actual.ingresos)} ${deltaBadge(actual.ingresos, anterior.ingresos)}</div><div class="sub">según pedidos con valor</div></div>
    <div class="kpi"><div class="lbl">Ingresos presupuestados</div><div class="val">${fmtCOP(actual.ingresosPresupuestados)} ${deltaBadge(actual.ingresosPresupuestados, anterior.ingresosPresupuestados)}</div><div class="sub">precio venta antes de IVA de órdenes con presupuesto</div></div>
    <div class="kpi"><div class="lbl">Costo mano de obra</div><div class="val">${fmtCOP(actual.costoMO)} ${deltaBadge(actual.costoMO, anterior.costoMO)}</div><div class="sub">según bitácora de producción</div></div>
    <div class="kpi"><div class="lbl">Otros costos (fijos + variables)</div><div class="val">${fmtCOP(actual.otrosCostos)} ${deltaBadge(actual.otrosCostos, anterior.otrosCostos)}</div><div class="sub">arriendo, nómina, materia prima, impuestos…</div></div>
    <div class="kpi"><div class="lbl">Margen estimado</div><div class="val ${actual.margen>=0?'pos':'neg'}">${fmtCOP(actual.margen)} ${deltaBadge(actual.margen, anterior.margen)}</div><div class="sub">ingresos − mano de obra − otros costos</div></div>
    <div class="kpi"><div class="lbl">Órdenes con valor</div><div class="val">${actual.ordenes} ${deltaBadge(actual.ordenes, anterior.ordenes)}</div><div class="sub">vs. periodo anterior equivalente</div></div>`;

  const mesesMap = {};
  actual.pedidos.forEach(p=>{ if(!p.fecha) return; const k=p.fecha.slice(0,7); mesesMap[k]=mesesMap[k]||{ing:0,cost:0}; mesesMap[k].ing+=(p.total||0); });
  actual.produccion.forEach(r=>{ if(!r.fecha) return; const k=r.fecha.slice(0,7); mesesMap[k]=mesesMap[k]||{ing:0,cost:0}; mesesMap[k].cost+=(r.valorActividad||0); });
  DB.costos_movimientos.forEach(m=>{ if(!m.fecha || !enRango(m.fecha, desde, hasta)) return; const k=m.fecha.slice(0,7); mesesMap[k]=mesesMap[k]||{ing:0,cost:0}; mesesMap[k].cost+=(m.valor||0); });
  const meses = Object.keys(mesesMap).sort();
  makeChart('chart-ger-mes', { type:'bar', data:{ labels: meses,
    datasets:[
      {label:'Ingresos', data: meses.map(m=>mesesMap[m].ing), backgroundColor:'#2E8FC0'},
      {label:'Costos totales (M.O. + otros)', data: meses.map(m=>mesesMap[m].cost), backgroundColor:'#D8854A'}
    ]}, options: baseBarOpts(true) });

  const ordIng = {}, ordCliente = {}, ordTrabajo = {};
  actual.pedidos.forEach(p=>{ ordIng[p.orden]=(ordIng[p.orden]||0)+(p.total||0); ordCliente[p.orden]=p.cliente; ordTrabajo[p.orden]=ordTrabajo[p.orden]||p.trabajo; });
  const ordCost = {};
  actual.produccion.forEach(r=>{ if(r.orden==null) return; ordCost[r.orden]=(ordCost[r.orden]||0)+(r.valorActividad||0); });

  // Costos (fijos+variables) que ya tienen una orden asociada (ej. una
  // compra de materia prima cargada desde Costos o desde un recibo
  // importado con el número de OP) van 100% a ESA orden, en vez de
  // prorratearse entre todas como antes — antes esta tabla ignoraba por
  // completo el campo "orden" de costos_movimientos (ver punto 10 de
  // AjustesERP). Solo el resto (arriendo, nómina, servicios — sin orden
  // asociada) se reparte proporcional al ingreso, como se hacía antes.
  const ordCostoDirecto = {};
  let costosMovSinOrden = 0;
  actual.costosMov.forEach(m => {
    if(m.orden != null) ordCostoDirecto[m.orden] = (ordCostoDirecto[m.orden] || 0) + (m.valor || 0);
    else costosMovSinOrden += (m.valor || 0);
  });
  const tasaOtros = actual.ingresos > 0 ? (costosMovSinOrden / actual.ingresos) : 0;

  // Ingreso presupuestado por orden — SIEMPRE separado del ingreso facturado.
  // presupuesto_orden no tiene fecha propia, así que se filtra por la fecha
  // de la orden (opp_ordenes) dueña de ese presupuesto.
  const ordIngPresupuestado = {};
  DB.presupuesto_orden.forEach(p => {
    const ordenOpp = DB.opp_ordenes.find(x => x.orden === p.orden);
    if(!ordenOpp || !enRango(ordenOpp.fecha, desde, hasta)) return;
    ordIngPresupuestado[p.orden] = p.precio_venta_antes_iva || 0;
    if(!ordCliente[p.orden]) ordCliente[p.orden] = ordenOpp.cliente;
    if(!ordTrabajo[p.orden]) ordTrabajo[p.orden] = ordenOpp.producto || tipoTrabajoLabel(ordenOpp);
  });

  // Clientes principales por ingreso — mismo criterio que Rentabilidad por
  // Orden: si la orden todavía no tiene ingreso facturado, se usa el
  // presupuestado, para no dejar fuera a los clientes cuyas órdenes son
  // nuevas (creadas por OPP, sin pedido en el Excel histórico).
  const clMap = {};
  new Set([...Object.keys(ordIng), ...Object.keys(ordIngPresupuestado)]).forEach(o => {
    const ing = ordIng[o] || 0;
    const ingPres = ordIngPresupuestado[o] != null ? ordIngPresupuestado[o] : null;
    const ingresoBase = ing > 0 ? ing : (ingPres || 0);
    const cliente = ordCliente[o] || 'Sin cliente';
    clMap[cliente] = (clMap[cliente] || 0) + ingresoBase;
  });
  const topCl = Object.entries(clMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
  makeChart('chart-ger-clientes', { type:'bar', data:{ labels: topCl.map(c=>c[0]),
    datasets:[{label:'Ingreso', data: topCl.map(c=>c[1]), backgroundColor:'#C24A1F'}]},
    options: baseBarOpts(false, true) });

  // El ingreso "facturado" (tabla pedidos, solo viene del Excel histórico
  // migrado) se queda en 0 para siempre en cualquier orden nueva creada
  // desde OPP — nada la vuelve a llenar. Antes el margen de esas órdenes
  // salía negativo por esto, aunque el ingreso presupuestado sí estuviera
  // bien cargado (ver punto 3 de AjustesERP). Ahora, si no hay ingreso
  // facturado, se usa el presupuestado como mejor estimación disponible.
  function filaOrden(o){
    const ing = ordIng[o] || 0;
    const ingPres = ordIngPresupuestado[o] != null ? ordIngPresupuestado[o] : null;
    const ingresoBase = ing > 0 ? ing : (ingPres || 0);
    const otrosDirecto = ordCostoDirecto[o] || 0;
    const otros = otrosDirecto + ingresoBase * tasaOtros;
    return { orden:o, cliente:ordCliente[o], trabajo:ordTrabajo[o], ing, ingPres, cost: ordCost[o]||0, otros, otrosDirecto };
  }

  const rows = Object.keys(ordIng).map(filaOrden).sort((a,b)=>b.ing-a.ing).slice(0,15);

  // Órdenes que tienen presupuesto pero todavía no tienen pedido (ingreso
  // facturado) — antes no aparecían en esta tabla en absoluto. Se agregan
  // aparte, sin contar contra el tope de las 15 con más ingreso facturado.
  const ordenesPresupuestoSinPedido = Object.keys(ordIngPresupuestado).filter(o => !(o in ordIng));
  ordenesPresupuestoSinPedido.forEach(o => rows.push(filaOrden(o)));

  // Órdenes que solo tienen un costo con orden asociada (sin pedido ni
  // presupuesto) — sin esto, ese costo desaparecía de la tabla aunque sí
  // contaba en el total de "otros costos" del periodo.
  const ordenesSoloConCostoDirecto = Object.keys(ordCostoDirecto).filter(o => !(o in ordIng) && !(o in ordIngPresupuestado));
  ordenesSoloConCostoDirecto.forEach(o => {
    if(!ordCliente[o]){
      const ordenOpp = DB.opp_ordenes.find(x => String(x.orden) === String(o));
      if(ordenOpp){ ordCliente[o] = ordenOpp.cliente; ordTrabajo[o] = ordenOpp.producto || tipoTrabajoLabel(ordenOpp); }
    }
    rows.push(filaOrden(o));
  });

  ultimaRentabilidad = rows;
  document.querySelector('#tbl-ger-ordenes tbody').innerHTML = rows.map(r=>{
    const ingresoBase = r.ing > 0 ? r.ing : (r.ingPres || 0);
    const m = ingresoBase - r.cost - r.otros;
    const otrosTitle = r.otrosDirecto > 0
      ? `Incluye ${fmtCOP(r.otrosDirecto)} de costos con esta orden asociada directamente`
      : 'Prorrateado según el ingreso de esta orden';
    return `<tr class="fila-clicable" data-orden="${r.orden}"><td>${r.orden}</td><td>${r.cliente||'—'}</td><td>${(r.trabajo||'—').toString().trim()}</td><td class="num">${fmtCOP(r.ing)}</td><td class="num">${r.ingPres!=null?fmtCOP(r.ingPres):'—'}</td><td class="num">${fmtCOP(r.cost)}</td><td class="num" title="${otrosTitle}">${fmtCOP(r.otros)}</td><td class="num" style="color:${m>=0?'var(--good)':'var(--bad)'}">${fmtCOP(m)}</td></tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--ink-faint)">Sin datos en este rango</td></tr>';
  document.querySelectorAll('#tbl-ger-ordenes tbody tr[data-orden]').forEach(tr => {
    tr.addEventListener('click', () => irAOrdenYVerDetalle(parseInt(tr.dataset.orden, 10)));
  });

  // ---- rentabilidad por tipo de producto ----
  const ordProducto = {};
  actual.pedidos.forEach(p => { if(!ordProducto[p.orden]) ordProducto[p.orden] = p.producto || 'Sin producto'; });
  // Completa con el producto de la orden (OPP) para las que no vienen del
  // Excel histórico — mismo criterio que la tabla de rentabilidad por orden:
  // sin esto, toda orden nueva quedaba fuera de este reporte por completo.
  Object.keys(ordIngPresupuestado).forEach(o => {
    if(ordProducto[o]) return;
    const ordenOpp = DB.opp_ordenes.find(x => String(x.orden) === String(o));
    if(ordenOpp) ordProducto[o] = ordenOpp.producto || tipoTrabajoLabel(ordenOpp);
  });

  const ordenesConValor = new Set([...Object.keys(ordIng), ...Object.keys(ordIngPresupuestado)]);
  const prodMap = {};
  ordenesConValor.forEach(o => {
    const prod = ordProducto[o] || 'Sin producto';
    const ing = ordIng[o] || 0;
    const ingPres = ordIngPresupuestado[o] != null ? ordIngPresupuestado[o] : null;
    const ingresoBase = ing > 0 ? ing : (ingPres || 0);
    prodMap[prod] = prodMap[prod] || { ing:0, cost:0, otrosDirecto:0, ordenes:new Set() };
    prodMap[prod].ing += ingresoBase;
    prodMap[prod].cost += (ordCost[o] || 0);
    prodMap[prod].otrosDirecto += (ordCostoDirecto[o] || 0);
    prodMap[prod].ordenes.add(o);
  });
  const filasProducto = Object.entries(prodMap)
    .map(([prod, v]) => {
      const otros = v.otrosDirecto + v.ing * tasaOtros;
      const margen = v.ing - v.cost - otros;
      return { producto: prod, ordenes: v.ordenes.size, ing: v.ing, cost: v.cost, otros, margen, margenPct: v.ing>0 ? (margen/v.ing*100) : 0 };
    })
    .sort((a,b) => b.margen - a.margen);
  ultimaRentabilidadProducto = filasProducto;

  document.querySelector('#tbl-ger-productos tbody').innerHTML = filasProducto.slice(0,20).map(f => `<tr>
    <td>${f.producto}</td><td class="num">${f.ordenes}</td><td class="num">${fmtCOP(f.ing)}</td><td class="num">${fmtCOP(f.cost)}</td><td class="num">${fmtCOP(f.otros)}</td>
    <td class="num" style="color:${f.margen>=0?'var(--good)':'var(--bad)'}">${fmtCOP(f.margen)}</td>
    <td class="num">${fmtNum(f.margenPct,0)}%</td>
  </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--ink-faint)">Sin datos en este rango</td></tr>';

  const topProd = filasProducto.slice(0,12).sort((a,b) => b.margen - a.margen);

  makeChart('chart-ger-productos', {
    type: 'bar',
    data: {
      labels: topProd.map(f => `${f.producto}  (${fmtNum(f.margenPct,0)}%)`),
      datasets: [
        { label: 'Margen', data: topProd.map(f=>f.margen), backgroundColor: '#2E8FC0', stack: 's' },
        { label: 'Costo de mano de obra', data: topProd.map(f=>f.cost), backgroundColor: '#D8854A', stack: 's' },
        { label: 'Otros costos', data: topProd.map(f=>f.otros), backgroundColor: '#AC2478', stack: 's' }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: (ctx) => {
            const f = topProd[ctx.dataIndex];
            if(ctx.dataset.label === 'Margen') return `Margen: ${fmtCOP(f.margen)} (${fmtNum(f.margenPct,0)}%)`;
            if(ctx.dataset.label === 'Costo de mano de obra') return `Costo de mano de obra: ${fmtCOP(f.cost)}`;
            return `Otros costos (prorrateado): ${fmtCOP(f.otros)}`;
          },
          footer: (items) => `Ingreso total: ${fmtCOP(topProd[items[0].dataIndex].ing)}`
        } }
      },
      scales: {
        x: { stacked: true, grid:{ color:'rgba(150,150,150,.15)' }, ticks:{ font:{size:10} } },
        y: { stacked: true, grid:{ display:false }, ticks:{ font:{size:10} } }
      }
    }
  });
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
  const esTodo = desde === '2024-01-01';
  // Días del rango elegido (incluye ambos extremos) — para "Horas
  // prom./día" en la tabla de abajo. Se usan los días DEL RANGO, no solo
  // los que tuvieron movimiento, para poder comparar áreas entre sí.
  const diasEnRango = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1);
  const codeMap = buildCodeMap();
  const produccion = DB.produccion.filter(r => enRango(r.fecha, desde, hasta));
  const ant = rangoAnterior(desde, hasta);
  const produccionAnt = esTodo ? [] : DB.produccion.filter(r => enRango(r.fecha, ant.desde, ant.hasta));
  const horasAntBase = esTodo ? null : produccionAnt.reduce((s,r)=>s+(r.tiempoHr||0),0);
  const ordenesAntBase = esTodo ? null : new Set(produccionAnt.filter(r=>r.orden!=null).map(r=>r.orden)).size;

  const horasTot = produccion.reduce((s,r)=>s+(r.tiempoHr||0),0);
  // Antes había un KPI de "Piezas producidas" que sumaba la cantidad de TODOS
  // los registros sin importar el área — eso mezclaba papel inicial, pliegos
  // impresos y piezas ya cortadas/terminadas (unidades distintas de una misma
  // orden en cada etapa), dando un total sin sentido (ver punto 4 de
  // AjustesERP). Se reemplaza por "Órdenes con movimiento", que sí es un
  // conteo correcto y útil para este rango de fechas.
  const ordenesConMovimiento = new Set(produccion.filter(r=>r.orden!=null).map(r=>r.orden)).size;
  const directaHrs = produccion.reduce((s,r)=>{ const c=codeMap[codeFromLabel(r.actividad)]; return s + ((c&&c.categoria==='Directa')?(r.tiempoHr||0):0); },0);
  const eficiencia = horasTot>0 ? (directaHrs/horasTot*100) : 0;

  document.getElementById('prod-kpis').innerHTML = `
    <div class="kpi"><div class="lbl">Horas registradas</div><div class="val">${fmtNum(horasTot)} ${deltaBadge(horasTot, horasAntBase)}</div><div class="sub">${produccion.length} registros</div></div>
    <div class="kpi"><div class="lbl">Órdenes con movimiento</div><div class="val">${ordenesConMovimiento} ${deltaBadge(ordenesConMovimiento, ordenesAntBase)}</div><div class="sub">órdenes con al menos un registro en el rango</div></div>
    <div class="kpi"><div class="lbl">% tiempo directo</div><div class="val">${fmtNum(eficiencia,0)}%</div><div class="sub">horas directas / horas totales</div></div>`;

  const areaMap = {};
  produccion.forEach(r=>{ const a=r.area||'General'; areaMap[a]=areaMap[a]||{h:0,p:0,c:0,n:0}; areaMap[a].h+=(r.tiempoHr||0); areaMap[a].p+=(r.cantidad||0); areaMap[a].c+=(r.valorActividad||0); areaMap[a].n+=1; });
  const areas = Object.keys(areaMap).sort((a,b)=>areaMap[b].h-areaMap[a].h);
  ultimaProduccionArea = areas.map(a => ({ area:a, horas:areaMap[a].h, piezas:areaMap[a].p, costo:areaMap[a].c, registros:areaMap[a].n }));

  // Qué órdenes/subórdenes componen cada barra de "Horas por área" — para
  // poder desplegarlas al hacer click (ver mostrarDetalleProduccionArea).
  // El registro "sin orden" (trabajo suelto) no se puede abrir en detalle
  // de orden, así que no entra en este desglose.
  const detallePorAreaAcumulado = {};
  produccion.forEach(r => {
    if(r.orden == null) return;
    const a = r.area || 'General';
    const key = r.orden + '-' + (r.suborden ?? '');
    detallePorAreaAcumulado[a] = detallePorAreaAcumulado[a] || {};
    const grp = detallePorAreaAcumulado[a][key] = detallePorAreaAcumulado[a][key] ||
      { orden: r.orden, suborden: r.suborden ?? null, cliente: r.cliente || null, pieza: r.trabajo || null, horas:0, cantidad:0, registros:0 };
    grp.horas += (r.tiempoHr||0);
    grp.cantidad += (r.cantidad||0);
    grp.registros += 1;
    if(!grp.cliente && r.cliente) grp.cliente = r.cliente;
    if(!grp.pieza && r.trabajo) grp.pieza = r.trabajo;
  });
  detalleProdPorArea = Object.fromEntries(Object.entries(detallePorAreaAcumulado)
    .map(([a, byKey]) => [a, Object.values(byKey).sort((x,y) => y.horas - x.horas)]));

  makeChart('chart-prod-area', { type:'bar', data:{ labels:areas,
    datasets:[{ label:'Horas', data: areas.map(a=>areaMap[a].h), backgroundColor: areas.map(a=>areaColor(a)) }]},
    options: { ...baseBarOpts(false,true),
      onClick: (evt, elements) => { if(elements.length) mostrarDetalleProduccionArea(areas[elements[0].index]); },
      onHover: (evt, elements, chart) => { chart.canvas.style.cursor = elements.length ? 'pointer' : 'default'; }
    } });

  const catMap = {};
  produccion.forEach(r=>{ const c=codeMap[codeFromLabel(r.actividad)]; const cat = c?c.categoria:'Sin clasificar'; catMap[cat]=(catMap[cat]||0)+(r.tiempoHr||0); });
  const cats = Object.keys(catMap);
  makeChart('chart-prod-categoria', { type:'doughnut', data:{ labels:cats, datasets:[{ data: cats.map(c=>catMap[c]),
    backgroundColor:['#185FA5','#BA7517','#A32D2D','#5F5E5A','#0F6E56'] }]},
    options:{ plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10, font:{size:11} } } } } });

  document.querySelector('#tbl-prod-area tbody').innerHTML = areas.map(a=>{
    const d=areaMap[a];
    const promDia = d.h / diasEnRango;
    const promRegistro = d.n > 0 ? d.h / d.n : 0;
    return `<tr class="fila-clicable" data-area="${a}"><td><span class="badge" style="background:${areaColor(a)}22;color:${areaColor(a)}">${a}</span></td><td class="num">${fmtNum(d.h)}</td><td class="num">${fmtNum(d.p,0)}</td><td class="num">${fmtCOP(d.c)}</td><td class="num">${d.n}</td><td class="num">${fmtNum(promDia,2)}</td><td class="num">${fmtNum(promRegistro,2)}</td></tr>`;
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--ink-faint)">Sin datos en este rango</td></tr>';
  document.querySelectorAll('#tbl-prod-area [data-area]').forEach(tr => {
    tr.addEventListener('click', () => mostrarDetalleProduccionArea(tr.dataset.area));
  });
}

// Pedido: "que cuando se presione la barra del área, despliegue una
// pantalla con los datos de las órdenes y subórdenes asociadas y que
// cuando presione una orden, toda la información de la orden" — se
// arma con detalleProdPorArea (calculado arriba, en el mismo rango de
// fechas elegido) y reutiliza mostrarDetalleOrden para el detalle completo.
let detalleProdPorArea = {};
function mostrarDetalleProduccionArea(area){
  const filas = detalleProdPorArea[area] || [];
  document.getElementById('prod-area-detalle-titulo').textContent = `Órdenes de ${area}`;
  document.querySelector('#tbl-prod-area-detalle tbody').innerHTML = filas.map(f => `<tr class="fila-clicable" data-orden="${f.orden}">
      <td>${f.orden}${f.suborden!=null ? '-' + f.suborden : ''}</td>
      <td>${f.cliente || '—'}</td>
      <td>${f.pieza || '—'}</td>
      <td class="num">${fmtNum(f.horas,2)}</td>
      <td class="num">${fmtNum(f.cantidad,0)}</td>
      <td class="num">${f.registros}</td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Sin órdenes asociadas en este rango (puede ser trabajo "sin orden asignada")</td></tr>';

  document.querySelectorAll('#tbl-prod-area-detalle [data-orden]').forEach(tr => {
    tr.addEventListener('click', () => irAOrdenYVerDetalle(parseInt(tr.dataset.orden, 10)));
  });

  const card = document.getElementById('prod-area-detalle-card');
  card.style.display = '';
  card.scrollIntoView({ behavior:'smooth' });
}

// ---------- OPERARIO ----------
let rangoOp = rangoFechas('todo');
export function populateOperarioSelect(){
  const sel = document.getElementById('op-select');
  const names = new Set(DB.personal.filter(p=>p.activo).map(p=>p.nombre));
  DB.produccion.forEach(r=>{ if(r.operario) names.add(r.operario); });
  sel.innerHTML = '<option value="__ALL__">Todos los operarios</option>' + Array.from(names).sort().map(n=>`<option value="${n}">${n}</option>`).join('');
  sel.addEventListener('change', renderOperario);
}
export function renderOperario(){
  const sel = document.getElementById('op-select').value;
  const { desde, hasta } = rangoOp;
  // Pedido: "el jefe de producción debe ver TODOS los registros de un
  // operario y poder filtrarlos por rango de fechas" — para poder
  // encontrar y ajustar (Editar) cualquiera, no solo los últimos 15.
  const recs = DB.produccion.filter(r =>
    (sel==='__ALL__' ? true : (r.operario||'').trim().startsWith(sel.split(' ')[0]) || r.operario===sel)
    && enRango(r.fecha, desde, hasta)
  );
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

  const puedeEditar = puedeEditarProduccion();
  document.getElementById('op-log-th-acciones').style.display = puedeEditar ? '' : 'none';

  const ordenados = recs.slice().sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'') || (b.horaIni||'').localeCompare(a.horaIni||''));
  const TOPE = 500; // no debería llegar acá en uso normal — solo evita renderizar miles de filas de una vez si el rango es enorme
  const recent = ordenados.slice(0, TOPE);
  const hint = document.getElementById('op-log-hint');
  if(hint) hint.textContent = ordenados.length > TOPE
    ? `mostrando ${TOPE} de ${ordenados.length} — angosta el rango de fechas para ver el resto`
    : `${ordenados.length} registro(s) del rango elegido arriba`;
  document.querySelector('#tbl-op-log tbody').innerHTML = recent.map(r=>{
    const acciones = puedeEditar ? `<td><div class="row-actions">
        <button type="button" class="row-btn" data-editar-reg="${r.id}">Editar</button>
        <button type="button" class="row-btn row-btn-danger" data-eliminar-reg="${r.id}">Eliminar</button>
      </div></td>` : '';
    return `<tr><td>${(r.fecha||'').slice(0,10)}</td><td>${r.actividad||'—'}</td><td class="${r.orden!=null?'fila-clicable':''}" data-orden="${r.orden??''}">${r.orden??'—'}</td><td class="num">${fmtNum(r.cantidad,0)}</td><td class="num">${fmtNum(r.tiempoHr,2)}</td><td class="num">${fmtCOP(r.valorActividad)}</td>${acciones}</tr>`;
  }).join('') || `<tr><td colspan="${puedeEditar?7:6}" style="text-align:center;color:var(--ink-faint)">Sin registros en este rango</td></tr>`;

  document.querySelectorAll('#tbl-op-log tbody td[data-orden]').forEach(td => {
    if(!td.dataset.orden) return;
    td.addEventListener('click', () => irAOrdenYVerDetalle(parseInt(td.dataset.orden, 10)));
  });
  if(puedeEditar){
    document.querySelectorAll('#tbl-op-log [data-editar-reg]').forEach(b => b.addEventListener('click', () => abrirEdicionRegistro(parseInt(b.dataset.editarReg, 10))));
    document.querySelectorAll('#tbl-op-log [data-eliminar-reg]').forEach(b => b.addEventListener('click', () => eliminarRegistroLog(parseInt(b.dataset.eliminarReg, 10))));
  }
}

// ---------- corregir / borrar un registro de producción (solo Admin/Gerente/Jefe de Producción) ----------
function poblarSelectActividadEdicion(area, valorActual){
  const sel = document.getElementById('ole-actividad');
  const acts = DB.actividades.filter(a=>a.area===area);
  sel.innerHTML = acts.map(a=>`<option value="${a.etiqueta}"${a.etiqueta===valorActual?' selected':''}>${a.etiqueta}</option>`).join('') || `<option value="${valorActual||''}">${valorActual||'—'}</option>`;
}
function poblarSelectMaquinaEdicion(area, valorActual){
  const sel = document.getElementById('ole-maquina');
  const maqs = DB.maquinas.filter(m=>m.area===area && m.activo!==false);
  sel.innerHTML = '<option value="">Trabajo manual (sin máquina)</option>' +
    maqs.map(m=>`<option value="${m.nombre}"${m.nombre===valorActual?' selected':''}>${m.nombre}</option>`).join('');
  if(valorActual && !maqs.some(m=>m.nombre===valorActual)) sel.value = '';
}

function poblarSelectSubprocesoEdicion(area, valorActual){
  const wrap = document.getElementById('ole-subproceso-wrap');
  const subs = subprocesosDeArea(area);
  wrap.style.display = subs.length ? '' : 'none';
  document.getElementById('ole-subproceso').innerHTML = '<option value="">— elige el subproceso —</option>' +
    subs.map(s=>`<option value="${s.nombre}"${s.nombre===valorActual?' selected':''}>${s.nombre}</option>`).join('');
}

function poblarSelectMotivoPausaEdicion(valorActual){
  const sel = document.getElementById('ole-motivo-pausa');
  const motivos = DB.motivos_pausa.filter(m=>m.activo!==false);
  sel.innerHTML = '<option value="">— elige un motivo —</option>' +
    motivos.map(m=>`<option value="${m.nombre}"${m.nombre===valorActual?' selected':''}>${m.nombre}</option>`).join('');
}
function actualizarWrapMotivoPausa(){
  const esPausa = document.getElementById('ole-proceso-completo').value === 'No';
  document.getElementById('ole-motivo-pausa-wrap').style.display = esPausa ? '' : 'none';
}

// Insumo consumido + Consumo — mismo desplegable y misma lógica que usa
// Registrar (ver js/registrar.js), reutilizados acá para que Jefe de
// Producción/Gerencia/Admin puedan AJUSTAR el consumo de materia prima de
// un registro ya guardado (pedido: "debe existir una correlación entre
// inventarios, insumos por área y materia prima" — ver guardarEdicionRegistro,
// que revierte el descuento anterior y aplica el nuevo).
function materialesDeOrdenPara(orden){
  return orden != null
    ? [...new Set(DB.opp_piezas.filter(p => p.orden === orden).map(p => p.papel).filter(Boolean))]
    : [];
}
function poblarMaterialEdicion(area, valorActual, consumoActualTexto, materialesOrden){
  const sel = document.getElementById('ole-materia-select');
  const otro = document.getElementById('ole-materia-otro');
  const consumoNum = document.getElementById('ole-consumo-num');
  const consumoTxt = document.getElementById('ole-consumo');
  const consumoLabel = document.getElementById('ole-consumo-label');
  sel.innerHTML = materialSelectOptionsHTML(area, valorActual, materialesOrden);
  const otroSeleccionado = sel.value === '__otro__';
  otro.style.display = otroSeleccionado ? 'block' : 'none';
  otro.value = otroSeleccionado ? (valorActual || '') : '';

  const unidad = valorActual ? unidadNumericaDelMaterial(area, valorActual) : null;
  consumoLabel.textContent = 'Consumo' + (unidad ? ' (' + unidad + ')' : '');
  consumoNum.dataset.unidad = unidad || '';
  consumoNum.style.display = unidad ? 'block' : 'none';
  consumoTxt.style.display = unidad ? 'none' : 'block';
  consumoNum.value = unidad ? parseCantidadConsumo(consumoActualTexto) : '';
  consumoTxt.value = unidad ? '' : (consumoActualTexto || '');
}
function wireMaterialSelectEdicion(){
  const sel = document.getElementById('ole-materia-select');
  const otro = document.getElementById('ole-materia-otro');
  const consumoNum = document.getElementById('ole-consumo-num');
  const consumoTxt = document.getElementById('ole-consumo');
  const consumoLabel = document.getElementById('ole-consumo-label');
  sel.onchange = () => {
    otro.style.display = sel.value === '__otro__' ? 'block' : 'none';
    if(sel.value === '__otro__') otro.focus();
    const areaActual = document.getElementById('ole-area').value;
    const unidad = (sel.value && sel.value !== '__otro__') ? unidadNumericaDelMaterial(areaActual, sel.value) : null;
    consumoNum.dataset.unidad = unidad || '';
    consumoNum.style.display = unidad ? 'block' : 'none';
    consumoTxt.style.display = unidad ? 'none' : 'block';
    consumoLabel.textContent = 'Consumo' + (unidad ? ' (' + unidad + ')' : '');
  };
}

// El operario a veces elige mal la suborden/pieza al registrar (o registra
// "sin OPP / general" pudiendo elegir una) — esto arma el mismo desplegable
// que usa Registrar (ver js/registrar.js, populatePiezaReg) para poder
// corregir a qué pieza de la orden queda ligado el registro, no solo el
// área/actividad. Antes esto no se podía tocar desde "Corregir registro".
function poblarSelectPiezaEdicion(orden, opActual){
  const sel = document.getElementById('ole-pieza');
  const hint = document.getElementById('ole-pieza-hint');
  const piezas = orden != null ? DB.opp_piezas.filter(p => p.orden === orden).sort((a,b)=>a.suborden-b.suborden) : [];
  sel.innerHTML = '<option value="">— Sin OPP / general —</option>' +
    piezas.map(p => `<option value="${p.op}" data-suborden="${p.suborden}"${p.op===opActual?' selected':''}>${p.suborden}. ${p.pieza || 'Pieza'}</option>`).join('');
  if(!piezas.length){ sel.disabled = true; hint.textContent = orden != null ? '(esta orden no tiene piezas en OPP)' : '(registro sin orden)'; }
  else { sel.disabled = false; hint.textContent = `(de la orden ${orden})`; }
}

// Todas las órdenes de OPP (no solo las "en curso" como en Registrar,
// getOrdenesSeleccionables) — desde acá se puede estar corrigiendo un
// registro viejo, y la orden correcta a la que había que moverlo bien
// puede ya estar cerrada.
function poblarSelectOrdenEdicion(ordenActual){
  const sel = document.getElementById('ole-orden');
  const ordenadas = [...DB.opp_ordenes].sort((a,b) => b.orden - a.orden);
  sel.innerHTML = '<option value="">— Sin orden (trabajo sin orden asignada) —</option>' +
    ordenadas.map(o => `<option value="${o.orden}"${o.orden===ordenActual?' selected':''}>${o.orden} — ${o.cliente || ''}${o.producto ? ' · ' + o.producto : ''}</option>`).join('');
  if(ordenActual != null && !ordenadas.some(o => o.orden === ordenActual)){
    sel.insertAdjacentHTML('afterbegin', `<option value="${ordenActual}" selected>${ordenActual} — (orden no encontrada en OPP)</option>`);
  }
}

function abrirEdicionRegistro(id){
  const row = DB.produccion.find(r => r.id === id);
  if(!row){ toast('No se encontró ese registro'); return; }

  const areaSel = document.getElementById('ole-area');
  areaSel.innerHTML = listaAreasDisponibles().map(a=>`<option value="${a}"${a===row.area?' selected':''}>${a}</option>`).join('');
  poblarSelectActividadEdicion(row.area, row.actividad);
  poblarSelectMaquinaEdicion(row.area, row.maquina);
  document.getElementById('ole-fecha').value = (row.fecha || '').slice(0,10);
  const ordenSel = document.getElementById('ole-orden');
  poblarSelectOrdenEdicion(row.orden);
  poblarSelectPiezaEdicion(row.orden, row.op);
  poblarSelectSubprocesoEdicion(row.area, row.subproceso);
  let materialesOrden = materialesDeOrdenPara(row.orden);
  poblarMaterialEdicion(row.area, row.materiaPrima, row.consumoMP, materialesOrden);
  wireMaterialSelectEdicion();
  areaSel.onchange = () => {
    poblarSelectActividadEdicion(areaSel.value, null);
    poblarSelectMaquinaEdicion(areaSel.value, null);
    poblarSelectSubprocesoEdicion(areaSel.value, null);
    poblarMaterialEdicion(areaSel.value, null, null, materialesOrden);
  };
  // Si se cambia la orden (ej. el operario había marcado la que no era),
  // la Suborden/Pieza y los materiales "de esta orden" del desplegable de
  // Insumo consumido tienen que refrescarse para la orden nueva — si no,
  // quedarían apuntando a la pieza/papel de la orden vieja.
  ordenSel.onchange = () => {
    const nuevaOrden = ordenSel.value ? parseInt(ordenSel.value, 10) : null;
    poblarSelectPiezaEdicion(nuevaOrden, null);
    materialesOrden = materialesDeOrdenPara(nuevaOrden);
    poblarMaterialEdicion(areaSel.value, null, null, materialesOrden);
  };

  document.getElementById('ole-hora-ini').value = row.horaIni || '';
  document.getElementById('ole-hora-fin').value = row.horaFin || '';
  document.getElementById('ole-hora-fin-hint').textContent = (row.horaIni && !row.horaFin) ? '⚠️ está vacía — esta actividad sigue bloqueando al operario' : '';
  document.getElementById('ole-cantidad').value = row.cantidad ?? '';
  document.getElementById('ole-horas').value = row.tiempoHr ?? '';
  document.getElementById('ole-comentario').value = row.comentario || '';
  document.getElementById('ole-reproceso').value = row.reproceso === 'Si' ? 'Si' : 'No';
  document.getElementById('ole-proceso-completo').value = row.procesoCompleto === false ? 'No' : 'Si';
  document.getElementById('ole-terminado-label').textContent = row.subproceso
    ? `¿Quedó terminado este subproceso (${row.subproceso})?`
    : `¿Quedó terminado este proceso (${row.area || '—'})?`;
  poblarSelectMotivoPausaEdicion(row.motivoPausa || null);
  actualizarWrapMotivoPausa();
  document.getElementById('ole-proceso-completo').onchange = actualizarWrapMotivoPausa;
  document.getElementById('ole-guardar').dataset.id = id;
  document.getElementById('op-log-editar-info').textContent = `Registro del ${(row.fecha||'').slice(0,10)} — ${row.operario || '—'} — Orden ${row.orden ?? '—'}${row.suborden!=null ? ' / suborden ' + row.suborden : ''}`;

  const card = document.getElementById('op-log-editar-card');
  card.style.display = '';
  card.scrollIntoView({ behavior:'smooth' });
}

function cerrarEdicionRegistro(){
  document.getElementById('op-log-editar-card').style.display = 'none';
}

// "Horas trabajadas" (tiempo_hr) es un campo aparte de Hora inicio/Hora fin
// — normalmente lo calcula solo registrar.js al finalizar la actividad
// (finishActivity), pero acá en "Corregir registro" quedaba desconectado:
// si el Jefe de Producción corregía Hora inicio u Hora fin a mano, el
// campo Horas trabajadas se quedaba con el valor viejo y había que
// recalcularlo y tipearlo aparte. Esto lo recalcula solo, igual que hace
// registrar.js, cada vez que cambia alguna de las dos horas.
function recalcularHorasEdicion(){
  const fecha = document.getElementById('ole-fecha').value;
  const horaIni = document.getElementById('ole-hora-ini').value;
  const horaFin = document.getElementById('ole-hora-fin').value;
  if(!fecha || !horaIni || !horaFin) return;
  const ini = new Date(fecha + 'T' + horaIni);
  const fin = new Date(fecha + 'T' + horaFin);
  const hrs = Math.max(0, (fin.getTime() - ini.getTime()) / 3600000);
  document.getElementById('ole-horas').value = hrs.toFixed(2);
}

async function guardarEdicionRegistro(){
  const btn = document.getElementById('ole-guardar');
  const id = parseInt(btn.dataset.id, 10);
  const row = DB.produccion.find(r => r.id === id);
  if(!row) return;

  const horas = parseFloat(document.getElementById('ole-horas').value || 0);
  const persona = DB.personal.find(p => p.nombre === row.operario);
  const rate = persona ? (persona.valor_hora || 0) : (row.tiempoHr ? (row.valorActividad || 0) / row.tiempoHr : 0);

  const piezaSel = document.getElementById('ole-pieza');
  const piezaOpt = piezaSel.selectedOptions[0];
  const opValue = piezaSel.value || null;
  const subordenValue = (opValue && piezaOpt && piezaOpt.dataset.suborden) ? parseInt(piezaOpt.dataset.suborden, 10) : null;
  const ordenSelValue = document.getElementById('ole-orden').value;
  const ordenValue = ordenSelValue ? parseInt(ordenSelValue, 10) : null;
  const fechaValue = document.getElementById('ole-fecha').value || null;

  if(!fechaValue){
    toast('La fecha no puede quedar vacía');
    document.getElementById('ole-fecha').focus();
    return;
  }

  const esPausa = document.getElementById('ole-proceso-completo').value === 'No';
  const motivoPausa = document.getElementById('ole-motivo-pausa').value;
  if(esPausa && !motivoPausa){
    toast('Elige el motivo de la pausa antes de guardar');
    document.getElementById('ole-motivo-pausa').focus();
    return;
  }
  const areaEditada = document.getElementById('ole-area').value;
  const subprocesoSel = document.getElementById('ole-subproceso');
  if(subprocesosDeArea(areaEditada).length && !subprocesoSel.value){
    toast('Este proceso tiene varios pasos — elige el subproceso antes de guardar');
    subprocesoSel.focus();
    return;
  }

  // Insumo consumido / Consumo — lo que YA estaba guardado en el registro
  // (para revertirlo del inventario) y lo que queda en el formulario
  // (para aplicarlo). Ver poblarMaterialEdicion/wireMaterialSelectEdicion.
  const unidadAnterior = row.materiaPrima ? unidadNumericaDelMaterial(row.area, row.materiaPrima) : null;
  const cantidadAnterior = unidadAnterior ? parseFloat(parseCantidadConsumo(row.consumoMP)) : NaN;

  const materiaSel = document.getElementById('ole-materia-select');
  const materiaNueva = materiaSel.value === '__otro__'
    ? (document.getElementById('ole-materia-otro').value.trim() || null)
    : (materiaSel.value || null);
  const consumoNumEl = document.getElementById('ole-consumo-num');
  const usaConsumoNumericoNuevo = consumoNumEl && consumoNumEl.style.display !== 'none';
  const consumoNuevoTexto = usaConsumoNumericoNuevo
    ? (consumoNumEl.value ? consumoNumEl.value + (consumoNumEl.dataset.unidad ? ' ' + consumoNumEl.dataset.unidad : '') : null)
    : (document.getElementById('ole-consumo').value.trim() || null);

  // Una actividad ASIGNADA (todavía no iniciada) puede tener las dos horas
  // vacías — eso es normal. Lo que no vale es tener Hora fin sin Hora
  // inicio (no puede haber terminado algo que nunca empezó).
  const horaIniVal = document.getElementById('ole-hora-ini').value || null;
  const horaFinVal = document.getElementById('ole-hora-fin').value || null;
  if(horaFinVal && !horaIniVal){
    toast('No puede haber Hora fin sin Hora inicio');
    document.getElementById('ole-hora-ini').focus();
    return;
  }
  // Este es justo el error que dejó a Teresa bloqueada el 14ago26: alguien
  // marcó "Sí, terminé este proceso" pero dejó Hora fin vacía, así que el
  // registro seguía viéndose "en curso" para Registrar. Si vas a marcar el
  // proceso como terminado y la actividad ya tiene Hora inicio, exigimos
  // Hora fin para no volver a dejar la misma trampa.
  if(!esPausa && horaIniVal && !horaFinVal){
    toast('Marcaste "Sí, terminé este proceso" pero Hora fin quedó vacía — complétala (o usa el botón "Usar hora actual") antes de guardar, si no, el operario sigue bloqueado');
    document.getElementById('ole-hora-fin').focus();
    return;
  }

  // "cliente"/"trabajo" quedan GUARDADOS en cada fila de producción (no se
  // calculan al vuelo desde la orden) — ver registrar.js, donde se llenan
  // al crear el registro. Si acá se corrige la Orden (el caso del
  // documento: "un operario coloco la orden que no era"), hay que
  // recalcularlos igual que hace Registrar, si no, el historial seguiría
  // mostrando el cliente/pieza de la orden VIEJA. Si la Orden NO cambió, se
  // dejan intactos — un registro "sin orden" trae ahí el texto libre que
  // escribió el operario (concepto) y este editor no tiene cómo re-teclear
  // eso, así que tocarlo solo por abrir/guardar el formulario lo borraría.
  let clienteNuevo = row.cliente, trabajoNuevo = row.trabajo;
  if(ordenValue !== row.orden){
    const ordenInfoNueva = ordenValue != null ? DB.opp_ordenes.find(o => o.orden === ordenValue) : null;
    clienteNuevo = ordenValue != null ? (ordenInfoNueva ? ordenInfoNueva.cliente : null) : null;
    trabajoNuevo = ordenValue != null ? (opValue ? piezaOpt.textContent.replace(/^\d+\.\s*/, '') : null) : null;
  }

  const updates = {
    fecha: fechaValue,
    orden: ordenValue,
    cliente: clienteNuevo,
    trabajo: trabajoNuevo,
    hora_ini: horaIniVal,
    hora_fin: horaFinVal,
    area: areaEditada,
    actividad: document.getElementById('ole-actividad').value,
    maquina: document.getElementById('ole-maquina').value || null,
    subproceso: subprocesoSel.value || null,
    cantidad: parseFloat(document.getElementById('ole-cantidad').value || 0),
    materia_prima: materiaNueva,
    consumo_mp: consumoNuevoTexto,
    comentario: document.getElementById('ole-comentario').value || null,
    reproceso: document.getElementById('ole-reproceso').value,
    proceso_completo: !esPausa,
    motivo_pausa: esPausa ? motivoPausa : null,
    tiempo_hr: horas,
    valor_actividad: horas * rate,
    op: opValue,
    suborden: subordenValue
  };

  btn.disabled = true; btn.textContent = 'Guardando…';
  try{
    const { data, error } = await sb.from('produccion').update(updates).eq('id', id).select();
    if(error) throw error;
    if(!data || !data.length) throw new Error('Supabase no devolvió el registro actualizado (revisa permisos RLS de UPDATE en produccion)');
    const idx = DB.produccion.findIndex(r => r.id === id);
    if(idx >= 0) DB.produccion[idx] = normProd(data[0]);

    // Mantiene correlacionados produccion / inventario (materias_primas o
    // insumos_area) / costos_movimientos: primero devuelve lo que este
    // registro ya había descontado con el material/área ANTERIOR, después
    // aplica el consumo NUEVO. Si el material no cambió, es prácticamente
    // un neteo; si cambió de material o de área, cada uno queda correcto.
    if(row.materiaPrima && !isNaN(cantidadAnterior) && cantidadAnterior > 0){
      await revertirConsumoDeRegistro(row.materiaPrima, row.area, cantidadAnterior, id);
    }
    let avisoConsumo = '';
    if(usaConsumoNumericoNuevo && materiaNueva){
      const cantidadNueva = parseFloat(consumoNumEl.value);
      if(cantidadNueva > 0){
        const resultado = await descontarInventarioYCargarCosto({
          nombre: materiaNueva, area: areaEditada, cantidad: cantidadNueva,
          orden: data[0].orden, suborden: data[0].suborden, fecha: data[0].fecha, produccionId: id
        });
        avisoConsumo = avisoConsumoNoReflejado(resultado, materiaNueva);
      }
    }

    toast('Registro corregido' + avisoConsumo, avisoConsumo ? 7000 : undefined);
    cerrarEdicionRegistro();
    renderOperario();
    renderProduccion();
    renderGerencial();
    renderOppRecent();
    renderInventario();
    refrescarDetalleOrdenSiEstaAbierta(data[0].orden);
    // Si además la corrección MOVIÓ el registro a otra orden (campo Orden
    // nuevo en "Corregir registro"), la orden de la que salió también
    // cambió sus totales — si estaba abierta esa, hay que refrescarla igual.
    if(row.orden !== data[0].orden) refrescarDetalleOrdenSiEstaAbierta(row.orden);
  }catch(err){
    console.error(err);
    toast('Error al guardar la corrección — revisa la consola');
  }finally{
    btn.disabled = false; btn.textContent = 'Guardar cambios';
  }
}

// Corregir/eliminar un registro (arriba) recalcula solo el estado en
// memoria (DB.produccion, DB.costos_movimientos, stock) — pero si el
// usuario tenía abierto el Detalle de esa misma orden (Órdenes > Historial
// de producción), ese panel no se repintaba solo: había que F5 para verlo
// reflejado. Esto lo refresca automático, sin tocar el detalle si es de
// OTRA orden distinta a la que se acaba de corregir.
function refrescarDetalleOrdenSiEstaAbierta(orden){
  if(orden != null && getOrdenDetalleActual() === orden) mostrarDetalleOrden(orden);
}

async function eliminarRegistroLog(id){
  const row = DB.produccion.find(r => r.id === id);
  if(!row) return;
  const ok = confirm(`¿Eliminar este registro de ${row.operario || 'operario'} (${row.actividad || 'actividad'}, orden ${row.orden ?? '—'})? Esta acción no se puede deshacer.`);
  if(!ok) return;
  try{
    // Si este registro había descontado un material, se le devuelve al
    // inventario antes de borrarlo — si no, el stock queda decontado para
    // siempre por un registro que ya ni existe.
    const unidad = row.materiaPrima ? unidadNumericaDelMaterial(row.area, row.materiaPrima) : null;
    const cantidad = unidad ? parseFloat(parseCantidadConsumo(row.consumoMP)) : NaN;
    if(row.materiaPrima && !isNaN(cantidad) && cantidad > 0){
      await revertirConsumoDeRegistro(row.materiaPrima, row.area, cantidad, id);
    }

    const { error } = await sb.from('produccion').delete().eq('id', id);
    if(error) throw error;
    const idx = DB.produccion.findIndex(r => r.id === id);
    if(idx >= 0) DB.produccion.splice(idx, 1);
    toast('Registro eliminado');
    renderOperario();
    renderProduccion();
    renderGerencial();
    renderOppRecent();
    renderInventario();
    refrescarDetalleOrdenSiEstaAbierta(row.orden);
  }catch(err){
    console.error(err);
    toast('Error al eliminar — revisa la consola');
  }
}

function wireEdicionRegistro(){
  const btnCancelar = document.getElementById('ole-cancelar');
  const btnGuardar = document.getElementById('ole-guardar');
  const btnHoraFinAhora = document.getElementById('ole-hora-fin-ahora');
  if(btnCancelar) btnCancelar.addEventListener('click', cerrarEdicionRegistro);
  if(btnGuardar) btnGuardar.addEventListener('click', guardarEdicionRegistro);
  // Atajo para cerrar una labor que quedó abierta sin tener que saber/calcular
  // la hora exacta — pone la hora de ahora mismo en el campo Hora fin.
  if(btnHoraFinAhora) btnHoraFinAhora.addEventListener('click', () => {
    document.getElementById('ole-hora-fin').value = new Date().toTimeString().slice(0,5);
    recalcularHorasEdicion();
  });
  const horaIniInput = document.getElementById('ole-hora-ini');
  const horaFinInput = document.getElementById('ole-hora-fin');
  if(horaIniInput) horaIniInput.addEventListener('change', recalcularHorasEdicion);
  if(horaFinInput) horaFinInput.addEventListener('change', recalcularHorasEdicion);
}

// La Bitácora del Operario puede tener cientos de registros (con el filtro
// "Todo") y la página entera es la que hace scroll — sin esto, moverse del
// primer al último registro (o volver) significaba arrastrar la barra de
// scroll a mano. "Ir al final" está arriba de la tabla (útil antes de
// bajar) y "Ir al inicio" queda debajo de la tabla (útil una vez que ya se
// llegó abajo), cada uno donde hace falta.
function wireScrollBitacora(){
  const btnFinal = document.getElementById('op-log-ir-final');
  const btnInicio = document.getElementById('op-log-ir-inicio');
  if(btnFinal) btnFinal.addEventListener('click', () => {
    const tabla = document.getElementById('tbl-op-log');
    const filas = tabla ? tabla.querySelectorAll('tbody tr') : [];
    const ultima = filas.length ? filas[filas.length - 1] : tabla;
    if(ultima) ultima.scrollIntoView({ behavior:'smooth', block:'end' });
  });
  if(btnInicio) btnInicio.addEventListener('click', () => {
    const card = document.getElementById('op-log-card');
    if(card) card.scrollIntoView({ behavior:'smooth', block:'start' });
  });
}

// Botón "Ajustar" del Historial de producción (Detalle de la orden, en
// Órdenes) — cambia a la pestaña Operario y abre "Corregir registro" para
// ese registro puntual. Se inyecta en ordenes.js desde app.js (ver
// setAjustarConsumoHandler) porque ordenes.js no puede importar este
// módulo sin generar un ciclo (dashboard.js ya importa de ordenes.js).
export function abrirEdicionRegistroDesdeOrden(id){
  const btnTab = document.querySelector('.tab-btn[data-tab="operario"]');
  if(!btnTab) return;
  btnTab.click();
  setTimeout(() => abrirEdicionRegistro(id), 60);
}

export function initDashboardFilters(){
  wireRangePresets('ger-presets', 'ger-desde', 'ger-hasta', () => rangoGer, r => rangoGer = r, renderGerencial);
  wireRangePresets('prod-presets', 'prod-desde', 'prod-hasta', () => rangoProd, r => rangoProd = r, renderProduccion);
  wireRangePresets('op-presets', 'op-desde', 'op-hasta', () => rangoOp, r => rangoOp = r, renderOperario);
  wireExportButtons();
  wireEdicionRegistro();
  wireScrollBitacora();
  const btnCerrarProdArea = document.getElementById('prod-area-detalle-cerrar');
  if(btnCerrarProdArea) btnCerrarProdArea.addEventListener('click', () => {
    document.getElementById('prod-area-detalle-card').style.display = 'none';
  });
}

function wireExportButtons(){
  const btnRent = document.getElementById('export-rentabilidad');
  if(btnRent) btnRent.addEventListener('click', () => {
    exportarExcel('LitoColor_rentabilidad_por_orden.xlsx', [{
      nombre: 'Rentabilidad',
      filas: ultimaRentabilidad.map(r => { const base = r.ing > 0 ? r.ing : (r.ingPres || 0); return { Orden: r.orden, Cliente: r.cliente, Trabajo: r.trabajo, Ingreso: r.ing, 'Ingreso presupuestado': r.ingPres != null ? r.ingPres : '', 'Costo M.O.': r.cost, 'Otros costos (directos + prorrateado)': Math.round(r.otros), Margen: Math.round(base - r.cost - r.otros) }; })
    }]);
  });

  const btnRentProd = document.getElementById('export-rentabilidad-producto');
  if(btnRentProd) btnRentProd.addEventListener('click', () => {
    exportarExcel('LitoColor_rentabilidad_por_producto.xlsx', [{
      nombre: 'Rentabilidad por producto',
      filas: ultimaRentabilidadProducto.map(f => ({ Producto: f.producto, Órdenes: f.ordenes, Ingreso: f.ing, 'Costo M.O.': f.cost, 'Otros costos (prorrateado)': Math.round(f.otros), Margen: Math.round(f.margen), 'Margen %': Math.round(f.margenPct) }))
    }]);
  });

  const btnProd = document.getElementById('export-produccion');
  if(btnProd) btnProd.addEventListener('click', () => {
    exportarExcel('LitoColor_produccion_por_area.xlsx', [{
      nombre: 'Producción por área',
      filas: ultimaProduccionArea.map(r => ({ Área: r.area, Horas: r.horas, 'Cantidad reportada': r.piezas, 'Costo M.O.': r.costo, Registros: r.registros }))
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
      { nombre: 'Clientes', filas: DB.clientes.map(c => ({ Nombre:c.nombre, NIT:c.nit, Teléfono:c.telefono, Correo:c.email, Ciudad:c.ciudad })) },
      { nombre: 'Costos', filas: DB.costos_movimientos.map(m => {
        const c = DB.costos_conceptos.find(x=>x.id===m.concepto_id);
        return { Fecha:m.fecha, Tipo:m.tipo, Concepto:c?c.nombre:'—', Proveedor:m.proveedor, Valor:m.valor, Comentario:m.comentario };
      }) }
    ]);
  });
}
