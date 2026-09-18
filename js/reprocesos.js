import { sb } from './supabase-client.js';
import { DB, normProd } from './store.js';
import { toast, fmtCOP, fmtNum, fechaHoyLocal, exportarExcel } from './helpers.js';
import { getCurrentUser } from './auth.js';
import { areasCompletadasPorPieza, mostrarDetalleOrden } from './ordenes.js';

// "Reprocesos" (pedido 17-18sep26): reabrir un proceso YA completado de
// una suborden, con motivo/responsable/costo adicional — se guarda como
// un registro de `produccion` más (reproceso:'Si'), "asignado, sin
// iniciar" (mismo mecanismo que "Prioridad por área" en ordenes.js), así
// que el operario lo ve en Registrar, lo empieza y lo termina como
// cualquier actividad: el tiempo y el costo de mano de obra salen solos
// (valor_actividad = horas × valor_hora), sin lógica nueva para eso.

let charts = {};
function makeChart(id, config){
  const el = document.getElementById(id);
  if(!el) return;
  if(charts[id]) charts[id].destroy();
  charts[id] = new Chart(el, config);
}

function irAOrdenYVerDetalle(orden){
  const btnTab = document.querySelector('.tab-btn[data-tab="ordenes"]');
  if(!btnTab) return;
  btnTab.click();
  setTimeout(() => mostrarDetalleOrden(orden), 50);
}

// ---------- "Nuevo reproceso" ----------
function mostrarCrearCard(){ document.getElementById('rep-crear-card').style.display = ''; }
function ocultarCrearCard(){ document.getElementById('rep-crear-card').style.display = 'none'; }

function limpiarFormularioReproceso(){
  document.getElementById('rep-orden').value = '';
  poblarPiezasRep(null);
  document.getElementById('rep-responsable').value = '';
  document.getElementById('rep-costo-adicional').value = '';
  document.getElementById('rep-comentario').value = '';
  const motivoSel = document.getElementById('rep-motivo');
  if(motivoSel.options.length) motivoSel.selectedIndex = 0;
}

export function poblarOperarioRep(){
  const sel = document.getElementById('rep-operario');
  if(!sel) return;
  sel.innerHTML = '<option value="">— elige el operario —</option>' +
    DB.personal.filter(p=>p.activo).map(p=>`<option value="${p.nombre}">${p.nombre} — ${p.cargo||''}</option>`).join('');
}
export function poblarMotivoRep(){
  const sel = document.getElementById('rep-motivo');
  if(!sel) return;
  const motivos = DB.motivos_reproceso.filter(m=>m.activo!==false);
  sel.innerHTML = '<option value="">— elige un motivo —</option>' +
    motivos.map(m=>`<option value="${m.nombre}">${m.nombre}</option>`).join('');
}

function poblarPiezasRep(ordenPreseleccionada, subordenPreseleccionada){
  const sel = document.getElementById('rep-pieza');
  const orden = ordenPreseleccionada != null ? ordenPreseleccionada : (parseInt(document.getElementById('rep-orden').value, 10) || null);
  if(!orden){
    sel.innerHTML = '<option value="">— elige la orden primero —</option>';
    sel.disabled = true;
    poblarAreasRep(null);
    return;
  }
  const piezas = DB.opp_piezas.filter(p => p.orden === orden).sort((a,b)=>(a.suborden||0)-(b.suborden||0));
  if(!piezas.length){
    sel.innerHTML = '<option value="">— esta orden no tiene piezas —</option>';
    sel.disabled = true;
    poblarAreasRep(null);
    toast('La orden ' + orden + ' no tiene piezas cargadas en OPP');
    return;
  }
  sel.disabled = false;
  sel.innerHTML = piezas.map(p => `<option value="${p.suborden}"${p.suborden===subordenPreseleccionada?' selected':''}>${p.suborden}. ${p.pieza || 'Pieza'}</option>`).join('');
  poblarAreasRep(orden, sel.value ? parseInt(sel.value,10) : piezas[0].suborden);
}

function poblarAreasRep(orden, suborden, areaPreseleccionada){
  const sel = document.getElementById('rep-area');
  const hint = document.getElementById('rep-area-hint');
  if(orden == null || suborden == null){
    sel.innerHTML = '<option value="">— elige la pieza primero —</option>';
    sel.disabled = true;
    return;
  }
  const pieza = DB.opp_piezas.find(p => p.orden === orden && p.suborden === suborden);
  const requeridos = pieza && Array.isArray(pieza.procesos_requeridos) ? pieza.procesos_requeridos : [];
  const completados = pieza ? areasCompletadasPorPieza(pieza) : new Set();
  const disponibles = requeridos.filter(a => completados.has(a));
  if(!disponibles.length){
    sel.innerHTML = '<option value="">— sin procesos completados todavía —</option>';
    sel.disabled = true;
    hint.textContent = 'Esta pieza todavía no tiene ningún proceso terminado — no hay nada que reprocesar aún.';
    return;
  }
  sel.disabled = false;
  hint.textContent = 'Solo se listan los procesos que esa pieza ya tiene marcados como terminados.';
  sel.innerHTML = disponibles.map(a => `<option value="${a}"${a===areaPreseleccionada?' selected':''}>${a}</option>`).join('');
}

async function crearReproceso(){
  const orden = parseInt(document.getElementById('rep-orden').value, 10) || null;
  const suborden = document.getElementById('rep-pieza').value ? parseInt(document.getElementById('rep-pieza').value, 10) : null;
  const area = document.getElementById('rep-area').value || null;
  const operario = document.getElementById('rep-operario').value || null;
  const motivo = document.getElementById('rep-motivo').value || null;
  const responsable = document.getElementById('rep-responsable').value.trim() || null;
  const costoAdicional = parseFloat(document.getElementById('rep-costo-adicional').value) || null;
  const comentario = document.getElementById('rep-comentario').value.trim() || null;

  if(!orden || !suborden || !area){ toast('Elige orden, suborden y área antes de crear el reproceso'); return; }
  if(!operario){ toast('Elige a quién se le asigna el reproceso'); return; }
  if(!motivo){ toast('Elige el motivo del reproceso'); return; }

  const o = DB.opp_ordenes.find(x => x.orden === orden);
  const pieza = DB.opp_piezas.find(p => p.orden === orden && p.suborden === suborden);
  const user = getCurrentUser();

  const btn = document.getElementById('rep-guardar');
  btn.disabled = true; btn.textContent = 'Creando…';
  try{
    const row = {
      fecha: fechaHoyLocal(), operario, hora_ini: null, hora_fin: null,
      area, actividad: null, maquina: null,
      orden, suborden, op: pieza ? pieza.op : null,
      cliente: o ? o.cliente : null, trabajo: pieza ? (pieza.pieza || null) : null,
      opp: (pieza && pieza.op) || String(orden),
      asignado_por: user ? user.nombre : null,
      reproceso: 'Si', motivo_reproceso: motivo, responsable_reproceso: responsable,
      costo_adicional_reproceso: costoAdicional, comentario
    };
    const { data, error } = await sb.from('produccion').insert([row]).select();
    if(error) throw error;
    DB.produccion.unshift(normProd(data[0]));
    toast(`Reproceso creado — ${operario} · ${area} · orden ${orden}`);
    limpiarFormularioReproceso();
    ocultarCrearCard();
    renderListadoReprocesos();
    renderInformeReprocesos();
  }catch(err){
    console.error(err);
    toast('No se pudo crear el reproceso — revisa la consola');
  }finally{
    btn.disabled = false; btn.textContent = 'Crear reproceso';
  }
}

// Botón "↺" del detalle de la orden (ordenes.js, vía setReprocesarHandler
// inyectado en app.js) — abre esta pestaña con orden/suborden/área ya
// elegidas, listas para asignar operario y motivo.
export function abrirNuevoReprocesoDesdeOrden(orden, suborden, op, area){
  const btnTab = document.querySelector('.tab-btn[data-tab="reprocesos"]');
  if(!btnTab) return;
  btnTab.click();
  setTimeout(() => {
    mostrarCrearCard();
    document.getElementById('rep-orden').value = orden;
    poblarPiezasRep(orden, suborden);
    poblarAreasRep(orden, suborden, area);
    document.getElementById('rep-crear-card').scrollIntoView({ behavior:'smooth', block:'start' });
    document.getElementById('rep-operario').focus();
  }, 60);
}

// ---------- listado ----------
function estadoReproceso(r){
  if(!r.horaIni) return 'Pendiente';
  if(!r.horaFin) return 'En curso';
  if(r.procesoCompleto === false) return 'Pausado';
  return 'Terminado';
}

function reprocesosDeProduccion(){
  return DB.produccion.filter(r => r.reproceso === 'Si');
}

export function renderListadoReprocesos(){
  const tbody = document.querySelector('#tbl-rep-listado tbody');
  if(!tbody) return;

  const fOrden = document.getElementById('rep-f-orden').value ? parseInt(document.getElementById('rep-f-orden').value, 10) : null;
  const fArea = document.getElementById('rep-f-area').value.trim().toLowerCase();
  const fMotivo = document.getElementById('rep-f-motivo').value.trim().toLowerCase();
  const fPersona = document.getElementById('rep-f-persona').value.trim().toLowerCase();
  const fDesde = document.getElementById('rep-f-desde').value;
  const fHasta = document.getElementById('rep-f-hasta').value;

  let filas = reprocesosDeProduccion();
  if(fOrden != null) filas = filas.filter(r => r.orden === fOrden);
  if(fArea) filas = filas.filter(r => (r.area||'').toLowerCase().includes(fArea));
  if(fMotivo) filas = filas.filter(r => (r.motivoReproceso||'').toLowerCase().includes(fMotivo));
  if(fPersona) filas = filas.filter(r => (r.operario||'').toLowerCase().includes(fPersona) || (r.responsableReproceso||'').toLowerCase().includes(fPersona));
  if(fDesde) filas = filas.filter(r => (r.fecha||'') >= fDesde);
  if(fHasta) filas = filas.filter(r => (r.fecha||'') <= fHasta);
  filas = filas.slice().sort((a,b) => (b.fecha||'').localeCompare(a.fecha||''));

  tbody.innerHTML = filas.slice(0, 200).map(r => `<tr data-orden="${r.orden ?? ''}">
    <td>${(r.fecha||'').slice(0,10) || '—'}</td>
    <td>${r.orden ?? '—'}${r.suborden!=null ? ' / ' + r.suborden : ''}</td>
    <td>${r.area || '—'}</td>
    <td>${r.operario || '—'}</td>
    <td>${estadoReproceso(r)}</td>
    <td>${r.motivoReproceso || '—'}</td>
    <td>${r.responsableReproceso || '—'}</td>
    <td class="num">${fmtCOP(r.valorActividad||0)}</td>
    <td class="num">${fmtCOP(r.costoAdicionalReproceso||0)}</td>
    <td>${r.orden!=null ? '<button type="button" class="row-btn" data-ver-orden-rep>Ver orden</button>' : ''}</td>
  </tr>`).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--ink-faint)">Sin reprocesos registrados todavía</td></tr>';

  tbody.querySelectorAll('[data-ver-orden-rep]').forEach(btn => {
    btn.addEventListener('click', () => {
      const orden = parseInt(btn.closest('tr').dataset.orden, 10);
      if(!isNaN(orden)) irAOrdenYVerDetalle(orden);
    });
  });
}

// ---------- informe ----------
export function renderInformeReprocesos(){
  const kpis = document.getElementById('rep-inf-kpis');
  if(!kpis) return;

  const desde = document.getElementById('rep-inf-desde').value || '2024-01-01';
  const hasta = document.getElementById('rep-inf-hasta').value || fechaHoyLocal();
  const filas = reprocesosDeProduccion().filter(r => (r.fecha||'') >= desde && (r.fecha||'') <= hasta);

  const costoMOTotal = filas.reduce((s,r)=>s+(r.valorActividad||0),0);
  const costoAdicTotal = filas.reduce((s,r)=>s+(r.costoAdicionalReproceso||0),0);

  const porArea = {}, porMotivo = {}, porPersona = {};
  filas.forEach(r => {
    const area = r.area || 'Sin área';
    porArea[area] = (porArea[area]||0) + 1;
    const motivo = r.motivoReproceso || 'Sin motivo';
    porMotivo[motivo] = (porMotivo[motivo]||0) + 1;
    const persona = r.operario || 'Sin operario';
    if(!porPersona[persona]) porPersona[persona] = { operario: persona, responsables: new Set(), n:0, mo:0, adic:0 };
    porPersona[persona].n++;
    porPersona[persona].mo += (r.valorActividad||0);
    porPersona[persona].adic += (r.costoAdicionalReproceso||0);
    if(r.responsableReproceso) porPersona[persona].responsables.add(r.responsableReproceso);
  });

  const areaTop = Object.entries(porArea).sort((a,b)=>b[1]-a[1])[0];
  const motivoTop = Object.entries(porMotivo).sort((a,b)=>b[1]-a[1])[0];

  kpis.innerHTML = `
    <div class="kpi"><div class="lbl">Reprocesos en el periodo</div><div class="val">${filas.length}</div><div class="sub">${desde} a ${hasta}</div></div>
    <div class="kpi"><div class="lbl">Costo mano de obra</div><div class="val">${fmtCOP(costoMOTotal)}</div><div class="sub">horas × valor/hora del operario</div></div>
    <div class="kpi"><div class="lbl">Costo adicional</div><div class="val">${fmtCOP(costoAdicTotal)}</div><div class="sub">registrado al crear/finalizar</div></div>
    <div class="kpi"><div class="lbl">Costo total de reprocesos</div><div class="val">${fmtCOP(costoMOTotal+costoAdicTotal)}</div></div>
    <div class="kpi"><div class="lbl">Área con más reprocesos</div><div class="val" style="font-size:16px">${areaTop ? areaTop[0] : '—'}</div><div class="sub">${areaTop ? areaTop[1] + ' reproceso(s)' : ''}</div></div>
    <div class="kpi"><div class="lbl">Motivo más frecuente</div><div class="val" style="font-size:16px">${motivoTop ? motivoTop[0] : '—'}</div><div class="sub">${motivoTop ? motivoTop[1] + ' reproceso(s)' : ''}</div></div>`;

  const areasOrdenadas = Object.entries(porArea).sort((a,b)=>b[1]-a[1]).slice(0,10);
  makeChart('chart-rep-area', { type:'bar', data:{ labels: areasOrdenadas.map(a=>a[0]),
    datasets:[{ label:'Reprocesos', data: areasOrdenadas.map(a=>a[1]), backgroundColor:'#C24A1F' }]},
    options:{ indexAxis:'y', responsive:true, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}},y:{grid:{display:false}}} } });

  const motivosOrdenados = Object.entries(porMotivo).sort((a,b)=>b[1]-a[1]).slice(0,10);
  makeChart('chart-rep-motivo', { type:'bar', data:{ labels: motivosOrdenados.map(a=>a[0]),
    datasets:[{ label:'Reprocesos', data: motivosOrdenados.map(a=>a[1]), backgroundColor:'#2E8FC0' }]},
    options:{ indexAxis:'y', responsive:true, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}},y:{grid:{display:false}}} } });

  const filasPersona = Object.values(porPersona).sort((a,b)=>b.n-a.n);
  document.querySelector('#tbl-rep-por-operario tbody').innerHTML = filasPersona.map(p => `<tr>
    <td>${p.operario}</td>
    <td>${[...p.responsables].join(', ') || '—'}</td>
    <td class="num">${p.n}</td>
    <td class="num">${fmtCOP(p.mo)}</td>
    <td class="num">${fmtCOP(p.adic)}</td>
    <td class="num">${fmtCOP(p.mo+p.adic)}</td>
  </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Sin datos en este rango</td></tr>';
}

function imprimirInformeReprocesos(){
  const desde = document.getElementById('rep-inf-desde').value || '2024-01-01';
  const hasta = document.getElementById('rep-inf-hasta').value || fechaHoyLocal();
  const filas = reprocesosDeProduccion().filter(r => (r.fecha||'') >= desde && (r.fecha||'') <= hasta)
    .sort((a,b) => (b.fecha||'').localeCompare(a.fecha||''));
  const costoMOTotal = filas.reduce((s,r)=>s+(r.valorActividad||0),0);
  const costoAdicTotal = filas.reduce((s,r)=>s+(r.costoAdicionalReproceso||0),0);

  const filasHTML = filas.map(r => `<tr>
    <td>${(r.fecha||'').slice(0,10)}</td><td>${r.orden ?? '—'}${r.suborden!=null?'/'+r.suborden:''}</td>
    <td>${r.area||''}</td><td>${r.operario||''}</td><td>${r.motivoReproceso||''}</td><td>${r.responsableReproceso||''}</td>
    <td class="num">${fmtCOP(r.valorActividad||0)}</td><td class="num">${fmtCOP(r.costoAdicionalReproceso||0)}</td>
  </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Informe de reprocesos</title>
<style>
  body{ font-family: Arial, Helvetica, sans-serif; color:#111; margin:20px; }
  h1{ font-size:20px; margin:0 0 2px; } .sub{ color:#444; font-size:13px; margin-bottom:16px; }
  table{ border-collapse:collapse; width:100%; margin-bottom:14px; font-size:12px; }
  td, th{ border:1px solid #ccc; padding:5px 7px; text-align:left; } th{ background:#f2f2f2; }
  .num{ text-align:right; }
</style></head><body>
  <h1>Informe de reprocesos</h1>
  <div class="sub">${desde} a ${hasta} · ${filas.length} reproceso(s) · Costo mano de obra ${fmtCOP(costoMOTotal)} · Costo adicional ${fmtCOP(costoAdicTotal)} · Total ${fmtCOP(costoMOTotal+costoAdicTotal)}</div>
  <table>
    <thead><tr><th>Fecha</th><th>Orden/Suborden</th><th>Área</th><th>Operario</th><th>Motivo</th><th>Responsable</th><th class="num">Costo M.O.</th><th class="num">Costo adicional</th></tr></thead>
    <tbody>${filasHTML || '<tr><td colspan="8" style="text-align:center">Sin datos en este rango</td></tr>'}</tbody>
  </table>
</body></html>`;

  const w = window.open('', '_blank');
  if(!w){ toast('El navegador bloqueó la ventana de impresión — permite ventanas emergentes para este sitio'); return; }
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => w.print(), 300);
}

function exportarInformeReprocesos(){
  const desde = document.getElementById('rep-inf-desde').value || '2024-01-01';
  const hasta = document.getElementById('rep-inf-hasta').value || fechaHoyLocal();
  const filas = reprocesosDeProduccion().filter(r => (r.fecha||'') >= desde && (r.fecha||'') <= hasta);
  exportarExcel(`reprocesos_${desde}_a_${hasta}.xlsx`, [{
    nombre: 'Reprocesos',
    filas: filas.map(r => ({
      Fecha: (r.fecha||'').slice(0,10), Orden: r.orden, Suborden: r.suborden, Área: r.area,
      Operario: r.operario, Estado: estadoReproceso(r), Motivo: r.motivoReproceso, Responsable: r.responsableReproceso,
      'Costo M.O.': r.valorActividad||0, 'Costo adicional': r.costoAdicionalReproceso||0, Comentario: r.comentario
    }))
  }]);
}

// ---------- init ----------
export function initReprocesos(){
  const btnAbrir = document.getElementById('rep-abrir-crear');
  if(!btnAbrir) return; // esta pestaña no existe para este rol/página

  poblarOperarioRep();
  poblarMotivoRep();

  btnAbrir.addEventListener('click', () => {
    mostrarCrearCard();
    document.getElementById('rep-crear-card').scrollIntoView({ behavior:'smooth', block:'start' });
    document.getElementById('rep-orden').focus();
  });
  document.getElementById('rep-cancelar').addEventListener('click', () => {
    limpiarFormularioReproceso();
    ocultarCrearCard();
  });
  document.getElementById('rep-orden').addEventListener('change', () => poblarPiezasRep(null));
  document.getElementById('rep-pieza').addEventListener('change', () => {
    const orden = parseInt(document.getElementById('rep-orden').value, 10) || null;
    const suborden = document.getElementById('rep-pieza').value ? parseInt(document.getElementById('rep-pieza').value, 10) : null;
    poblarAreasRep(orden, suborden);
  });
  document.getElementById('rep-guardar').addEventListener('click', crearReproceso);

  document.getElementById('rep-f-buscar').addEventListener('click', renderListadoReprocesos);
  document.getElementById('rep-f-limpiar').addEventListener('click', () => {
    ['rep-f-orden','rep-f-area','rep-f-motivo','rep-f-persona','rep-f-desde','rep-f-hasta'].forEach(id => document.getElementById(id).value = '');
    renderListadoReprocesos();
  });

  document.getElementById('rep-inf-desde').addEventListener('change', renderInformeReprocesos);
  document.getElementById('rep-inf-hasta').addEventListener('change', renderInformeReprocesos);
  document.getElementById('rep-inf-imprimir').addEventListener('click', imprimirInformeReprocesos);
  document.getElementById('rep-inf-exportar').addEventListener('click', exportarInformeReprocesos);

  poblarPiezasRep(null);
  renderListadoReprocesos();
  renderInformeReprocesos();
}
