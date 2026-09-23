import { sb } from './supabase-client.js';
import { DB, normProd } from './store.js';
import { toast, fmtCOP, fmtNum, fechaHoyLocal, exportarExcel, agregarBotonExcelVentana, etiquetaOrden, parseOrden } from './helpers.js';
import { getCurrentUser } from './auth.js';
import { areasCompletadasPorPieza, mostrarDetalleOrden } from './ordenes.js';
import { listaAreasDisponibles } from './registrar.js';
import { movimientosPorProduccion, agruparReprocesosPorOP, claseDeMovimiento, sumarCostos } from './reproceso-costos.js';

// "Reprocesos" (pedido 17-18sep26): reabrir un proceso YA completado de
// una suborden, con motivo/responsable/costo adicional — se guarda como
// un registro de `produccion` más (reproceso:'Si'), "asignado, sin
// iniciar" (mismo mecanismo que "Prioridad por área" en ordenes.js), así
// que el operario lo ve en Registrar, lo empieza y lo termina como
// cualquier actividad: el tiempo y el costo de mano de obra salen solos
// (valor_actividad = horas × valor_hora), sin lógica nueva para eso.
//
// Ajuste 23sep26 (pedido de gerencia):
//  - Para ESTADÍSTICAS un reproceso es por OP: todos los registros de
//    reproceso de la misma orden cuentan como UNO (ej. OP 5972 tenía 13
//    registros porque se rehicieron todos los procesos, pero es un solo
//    reproceso). Se registra además el ÁREA QUE LO GENERÓ.
//  - Para COSTOS se suma cada proceso involucrado: mano de obra, materia
//    prima, insumos y otros costos (ver js/reproceso-costos.js). Desde el
//    detalle de cada OP se pueden agregar consumos de material y otros
//    costos, y marcar como parte del reproceso otros procesos de la OP que
//    se rehicieron pero el operario no marcó como reproceso.

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

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

function reprocesosDeProduccion(){
  return DB.produccion.filter(r => r.reproceso === 'Si');
}

function reprocesosDeLaOrden(orden){
  return reprocesosDeProduccion().filter(r => r.orden === orden);
}

function estadoReproceso(r){
  if(!r.horaIni) return 'Pendiente';
  if(!r.horaFin) return 'En curso';
  if(r.procesoCompleto === false) return 'Pausado';
  return 'Terminado';
}

function estadoGrupo(g){
  const estados = g.registros.map(estadoReproceso);
  if(estados.includes('En curso')) return 'En curso';
  if(estados.includes('Pendiente')) return 'Pendiente';
  if(estados.includes('Pausado')) return 'Pausado';
  return 'Terminado';
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
  const origenSel = document.getElementById('rep-area-origen');
  if(origenSel && origenSel.options.length) origenSel.selectedIndex = 0;
  mostrarHintOPExistente(null);
}

export function poblarOperarioRep(){
  const sel = document.getElementById('rep-operario');
  if(!sel) return;
  sel.innerHTML = '<option value="">— elige el operario —</option>' +
    DB.personal.filter(p=>p.activo).map(p=>`<option value="${esc(p.nombre)}">${esc(p.nombre)} — ${esc(p.cargo||'')}</option>`).join('');
}
export function poblarMotivoRep(){
  const sel = document.getElementById('rep-motivo');
  if(!sel) return;
  const motivos = DB.motivos_reproceso.filter(m=>m.activo!==false);
  sel.innerHTML = '<option value="">— elige un motivo —</option>' +
    motivos.map(m=>`<option value="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
  poblarAreaOrigenRep();
}

// Áreas de producción + "Externo" (cliente/proveedor) para "Área que generó
// el reproceso".
function opcionesAreaOrigen(valorActual){
  const areas = listaAreasDisponibles();
  if(!areas.includes('Externo (cliente/proveedor)')) areas.push('Externo (cliente/proveedor)');
  if(valorActual && !areas.includes(valorActual)) areas.push(valorActual);
  return '<option value="">— elige el área —</option>' +
    areas.map(a => `<option value="${esc(a)}"${a===valorActual?' selected':''}>${esc(a)}</option>`).join('');
}
function poblarAreaOrigenRep(){
  const sel = document.getElementById('rep-area-origen');
  if(!sel) return;
  const actual = sel.value;
  sel.innerHTML = opcionesAreaOrigen(actual || null);
}

// Si la OP ya tiene reproceso, el nuevo proceso se suma a ESE mismo
// reproceso (para estadísticas sigue siendo uno) — se precargan motivo y
// área que lo generó para que queden iguales.
function mostrarHintOPExistente(orden){
  const hint = document.getElementById('rep-op-existente-hint');
  if(!hint) return;
  const previos = orden ? reprocesosDeLaOrden(orden) : [];
  if(!previos.length){ hint.style.display = 'none'; return; }
  const [g] = agruparReprocesosPorOP(previos);
  hint.style.display = '';
  hint.textContent = `La OP ${etiquetaOrden(orden)} ya tiene un reproceso (${previos.length} proceso(s)). Este nuevo proceso se suma a ese mismo reproceso: para estadísticas sigue contando como uno solo, y su costo se suma al total.`;
  if(g.motivo) document.getElementById('rep-motivo').value = g.motivo;
  if(g.areaOrigen){
    const sel = document.getElementById('rep-area-origen');
    sel.innerHTML = opcionesAreaOrigen(g.areaOrigen);
  }
  if(g.responsable && !document.getElementById('rep-responsable').value) document.getElementById('rep-responsable').value = g.responsable;
}

function poblarPiezasRep(ordenPreseleccionada, subordenPreseleccionada){
  const sel = document.getElementById('rep-pieza');
  const orden = ordenPreseleccionada != null ? ordenPreseleccionada : (parseOrden(document.getElementById('rep-orden').value));
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
    toast('La orden ' + etiquetaOrden(orden) + ' no tiene piezas cargadas en OPP');
    return;
  }
  sel.disabled = false;
  sel.innerHTML = piezas.map(p => `<option value="${p.suborden}"${p.suborden===subordenPreseleccionada?' selected':''}>${p.suborden}. ${esc(p.pieza || 'Pieza')}</option>`).join('');
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
  sel.innerHTML = disponibles.map(a => `<option value="${esc(a)}"${a===areaPreseleccionada?' selected':''}>${esc(a)}</option>`).join('');
}

async function crearReproceso(){
  const orden = parseOrden(document.getElementById('rep-orden').value);
  const suborden = document.getElementById('rep-pieza').value ? parseInt(document.getElementById('rep-pieza').value, 10) : null;
  const area = document.getElementById('rep-area').value || null;
  const operario = document.getElementById('rep-operario').value || null;
  const motivo = document.getElementById('rep-motivo').value || null;
  const areaOrigen = document.getElementById('rep-area-origen').value || null;
  const responsable = document.getElementById('rep-responsable').value.trim() || null;
  const costoAdicional = parseFloat(document.getElementById('rep-costo-adicional').value) || null;
  const comentario = document.getElementById('rep-comentario').value.trim() || null;

  if(!orden || !suborden || !area){ toast('Elige orden, suborden y área antes de crear el reproceso'); return; }
  if(!operario){ toast('Elige a quién se le asigna el reproceso'); return; }
  if(!motivo){ toast('Elige el motivo del reproceso'); return; }
  if(!areaOrigen){ toast('Elige el área que generó el reproceso'); return; }

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
      area_origen_reproceso: areaOrigen,
      costo_adicional_reproceso: costoAdicional, comentario
    };
    const { data, error } = await sb.from('produccion').insert([row]).select();
    if(error) throw error;
    DB.produccion.unshift(normProd(data[0]));
    // Si la OP ya tenía reproceso, se deja el mismo motivo/área de origen en
    // todos sus registros — sigue siendo UN reproceso.
    await igualarDatosDeLaOP(orden, { motivo_reproceso: motivo, area_origen_reproceso: areaOrigen });
    toast(`Reproceso creado — ${operario} · ${area} · orden ${etiquetaOrden(orden)}`);
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

// Deja motivo/área de origen/responsable iguales en todos los registros de
// reproceso de la OP. Solo toca los registros que tienen algo distinto.
async function igualarDatosDeLaOP(orden, updates){
  if(orden == null) return;
  const regs = reprocesosDeLaOrden(orden).filter(r =>
    ('motivo_reproceso' in updates && r.motivoReproceso !== updates.motivo_reproceso) ||
    ('area_origen_reproceso' in updates && r.areaOrigenReproceso !== updates.area_origen_reproceso) ||
    ('responsable_reproceso' in updates && r.responsableReproceso !== updates.responsable_reproceso));
  if(!regs.length) return;
  const ids = regs.map(r => r.id);
  const { data, error } = await sb.from('produccion').update(updates).in('id', ids).select();
  if(error) throw error;
  reemplazarEnMemoria(data);
}

function reemplazarEnMemoria(filas){
  (filas || []).forEach(f => {
    const idx = DB.produccion.findIndex(x => x.id === f.id);
    if(idx >= 0) DB.produccion[idx] = normProd(f);
  });
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
    document.getElementById('rep-orden').value = etiquetaOrden(orden);
    poblarPiezasRep(orden, suborden);
    poblarAreasRep(orden, suborden, area);
    mostrarHintOPExistente(orden);
    document.getElementById('rep-crear-card').scrollIntoView({ behavior:'smooth', block:'start' });
    document.getElementById('rep-operario').focus();
  }, 60);
}

// ---------- listado por OP ----------
function gruposFiltradosListado(){
  const fOrden = document.getElementById('rep-f-orden').value ? parseOrden(document.getElementById('rep-f-orden').value) : null;
  const fArea = document.getElementById('rep-f-area').value.trim().toLowerCase();
  const fMotivo = document.getElementById('rep-f-motivo').value.trim().toLowerCase();
  const fPersona = document.getElementById('rep-f-persona').value.trim().toLowerCase();
  const fDesde = document.getElementById('rep-f-desde').value;
  const fHasta = document.getElementById('rep-f-hasta').value;

  let filas = reprocesosDeProduccion();
  if(fOrden != null) filas = filas.filter(r => r.orden === fOrden);
  if(fDesde) filas = filas.filter(r => (r.fecha||'') >= fDesde);
  if(fHasta) filas = filas.filter(r => (r.fecha||'') <= fHasta);
  let grupos = agruparReprocesosPorOP(filas, movimientosPorProduccion());
  if(fArea) grupos = grupos.filter(g => (g.areaOrigen||'').toLowerCase().includes(fArea) || g.areasRehechas.some(a => a.toLowerCase().includes(fArea)));
  if(fMotivo) grupos = grupos.filter(g => (g.motivo||'').toLowerCase().includes(fMotivo));
  if(fPersona) grupos = grupos.filter(g => g.operarios.some(o => o.toLowerCase().includes(fPersona)) || (g.responsable||'').toLowerCase().includes(fPersona));
  return grupos.sort((a,b) => b.fechaFin.localeCompare(a.fechaFin));
}

export function renderListadoReprocesos(){
  const tbody = document.querySelector('#tbl-rep-listado tbody');
  if(!tbody) return;
  const grupos = gruposFiltradosListado();

  tbody.innerHTML = grupos.slice(0, 200).map(g => `<tr data-key="${g.key}">
    <td>${g.fechaIni.slice(0,10) || '—'}${g.fechaFin && g.fechaFin !== g.fechaIni ? ' a ' + g.fechaFin.slice(0,10) : ''}</td>
    <td>${g.orden != null ? etiquetaOrden(g.orden) : '—'}</td>
    <td>${g.areaOrigen ? esc(g.areaOrigen) : '<span class="card-hint">sin definir</span>'}</td>
    <td>${g.motivo ? esc(g.motivo) : '<span class="card-hint">sin motivo</span>'}</td>
    <td>${g.registros.length} — ${esc(g.areasRehechas.join(', '))}</td>
    <td>${estadoGrupo(g)}</td>
    <td class="num">${fmtCOP(g.costos.mo)}</td>
    <td class="num">${fmtCOP(g.costos.mp)}</td>
    <td class="num">${fmtCOP(g.costos.ins)}</td>
    <td class="num">${fmtCOP(g.costos.otros)}</td>
    <td class="num"><b>${fmtCOP(g.costos.total)}</b></td>
    <td style="white-space:nowrap">
      <button type="button" class="row-btn" data-detalle-rep>${g.motivo && g.areaOrigen ? 'Detalle' : '✎ Completar'}</button>
      ${g.orden!=null ? '<button type="button" class="row-btn" data-ver-orden-rep>Ver orden</button>' : ''}
    </td>
  </tr>`).join('') || '<tr><td colspan="12" style="text-align:center;color:var(--ink-faint)">Sin reprocesos registrados todavía</td></tr>';

  const incompletos = grupos.filter(g => !g.motivo || !g.areaOrigen).length;
  const aviso = document.getElementById('rep-sin-motivo-aviso');
  if(aviso){
    aviso.style.display = incompletos ? '' : 'none';
    aviso.textContent = `${incompletos} reproceso(s) de esta lista no tienen motivo o área que lo generó — usa "✎ Completar" para llenarlos y que salgan bien en las estadísticas.`;
  }

  const porKey = new Map(grupos.map(g => [g.key, g]));
  tbody.querySelectorAll('[data-detalle-rep]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tr = btn.closest('tr');
      abrirDetalleOP(tr, porKey.get(tr.dataset.key));
    });
  });
  tbody.querySelectorAll('[data-ver-orden-rep]').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = porKey.get(btn.closest('tr').dataset.key);
      if(g && g.orden != null) irAOrdenYVerDetalle(g.orden);
    });
  });
}

// Vuelve a armar el grupo con los datos actuales (después de guardar algo)
// y reabre el detalle en la misma posición.
function refrescarTrasCambio(key){
  renderListadoReprocesos();
  renderInformeReprocesos();
  const tr = document.querySelector(`#tbl-rep-listado tbody tr[data-key="${key}"]`);
  if(!tr) return;
  const orden = key.startsWith('o') ? parseInt(key.slice(1), 10) : null;
  const regs = orden != null ? reprocesosDeLaOrden(orden) : DB.produccion.filter(r => r.id === parseInt(key.slice(1), 10));
  const [g] = agruparReprocesosPorOP(regs, movimientosPorProduccion());
  if(g) abrirDetalleOP(tr, g);
}

function opcionesMaterial(clase, areaProceso){
  if(clase === 'Materia prima'){
    return DB.materias_primas.filter(m => m.activo !== false).slice().sort((a,b)=>(a.nombre||'').localeCompare(b.nombre||''))
      .map(m => `<option value="materias_primas|${esc(m.codigo)}">${esc(m.nombre)}${m.unidad ? ' — ' + esc(m.unidad) : ''}${m.costo_unitario ? '' : ' (sin costo)'}</option>`).join('');
  }
  const insumos = DB.insumos_area.filter(m => m.activo !== false).slice()
    .sort((a,b) => ((a.area===areaProceso?0:1) - (b.area===areaProceso?0:1)) || (a.area||'').localeCompare(b.area||'') || (a.nombre||'').localeCompare(b.nombre||''));
  return insumos.map(m => `<option value="insumos_area|${m.id}">${esc(m.nombre)} (${esc(m.area)})${m.unidad ? ' — ' + esc(m.unidad) : ''}${m.costo_unitario ? '' : ' (sin costo)'}</option>`).join('');
}

function abrirDetalleOP(tr, g){
  if(!g) return;
  const tbody = tr.parentElement;
  const previa = tbody.querySelector('tr.rep-edit-row');
  if(previa){
    const eraEste = previa.previousElementSibling === tr;
    previa.remove();
    if(eraEste) return; // segundo clic en "Detalle" = cerrar
  }
  const mpp = movimientosPorProduccion();
  const motivos = DB.motivos_reproceso.filter(m => m.activo !== false || m.nombre === g.motivo);
  const idsGrupo = new Set(g.registros.map(r => r.id));

  const filasProcesos = g.registros.map(r => {
    const c = g.costosPorRegistro.get(r.id);
    return `<tr>
      <td>${(r.fecha||'').slice(0,10)}</td><td>${r.suborden ?? '—'}</td><td>${esc(r.area||'—')}</td><td>${esc(r.operario||'—')}</td>
      <td>${estadoReproceso(r)}</td>
      <td class="num">${fmtCOP(c.mo)}</td><td class="num">${fmtCOP(c.mp)}</td><td class="num">${fmtCOP(c.ins)}</td><td class="num">${fmtCOP(c.otros)}</td><td class="num"><b>${fmtCOP(c.total)}</b></td>
      <td>${g.registros.length > 1 ? `<button type="button" class="row-btn" data-quitar-proc="${r.id}" title="Este registro no fue parte del reproceso">Quitar</button>` : ''}</td>
    </tr>`;
  }).join('');

  const movs = g.registros.flatMap(r => (mpp.get(r.id) || []).map(m => ({ m, r })));
  const filasMovs = movs.map(({ m, r }) => `<tr>
      <td>${(m.fecha||'').slice(0,10)}</td><td>${esc(r.area||'')} · ${esc(r.operario||'')}</td>
      <td>${claseDeMovimiento(m, r)}</td><td>${esc(m.comentario||'')}</td><td class="num">${fmtCOP(Number(m.valor)||0)}</td>
      <td>${m.clase_reproceso ? `<button type="button" class="row-btn" data-quitar-mov="${m.id}">Quitar</button>` : '<span class="card-hint">automático</span>'}</td>
    </tr>`).join('');

  // Otros registros de la misma OP que NO están marcados como reproceso —
  // típico cuando se repitió toda la OP y solo algunos operarios marcaron
  // "¿Reproceso? = Sí". Por defecto solo los de la fecha del primer
  // reproceso en adelante.
  const otrosDeLaOP = g.orden != null ? DB.produccion.filter(r => r.orden === g.orden && !idsGrupo.has(r.id) && r.reproceso !== 'Si')
    .sort((a,b) => (a.fecha||'').localeCompare(b.fecha||'') || a.id - b.id) : [];
  const filaOtro = r => `<tr data-desde-inicio="${(r.fecha||'') >= g.fechaIni ? '1' : '0'}"${(r.fecha||'') >= g.fechaIni ? '' : ' style="display:none"'}>
      <td><input type="checkbox" class="rep-incluir" value="${r.id}"></td>
      <td>${(r.fecha||'').slice(0,10)}</td><td>${r.suborden ?? '—'}</td><td>${esc(r.area||'')}</td><td>${esc(r.operario||'')}</td>
      <td>${esc(r.materiaPrima ? r.materiaPrima + (r.consumoMP ? ' (' + r.consumoMP + ')' : '') : '')}</td>
      <td class="num">${fmtCOP(r.valorActividad||0)}</td></tr>`;

  const fila = document.createElement('tr');
  fila.className = 'rep-edit-row';
  fila.innerHTML = `<td colspan="12" style="background:var(--bg-soft, #f6f4ef)">
    <h4 style="margin:4px 0 8px">Reproceso de la orden ${g.orden != null ? etiquetaOrden(g.orden) : '—'} — ${g.registros.length} proceso(s) · costo total ${fmtCOP(g.costos.total)}</h4>
    <div class="form-row" style="align-items:flex-end">
      <div class="field"><label>Motivo del reproceso</label><select class="rep-ed-motivo"><option value="">— elige un motivo —</option>${motivos.map(m=>`<option value="${esc(m.nombre)}"${m.nombre===g.motivo?' selected':''}>${esc(m.nombre)}</option>`).join('')}</select></div>
      <div class="field"><label>Área que generó el reproceso</label><select class="rep-ed-origen">${opcionesAreaOrigen(g.areaOrigen)}</select></div>
      <div class="field"><label>Responsable</label><input type="text" class="rep-ed-responsable" list="reg-responsables-datalist" placeholder="quién/qué lo causó" value="${esc(g.responsable||'')}"></div>
      <div class="field" style="flex:0 0 auto"><button type="button" class="btn-primary rep-ed-guardar">Guardar datos del reproceso</button></div>
    </div>
    <p class="card-hint">Se guarda igual en todos los procesos de este reproceso — para estadísticas cuenta como uno solo.</p>

    <h4 style="margin:12px 0 6px">Procesos involucrados y su costo</h4>
    <div class="table-wrap"><table class="detalle-mini-table">
      <thead><tr><th>Fecha</th><th>Sub.</th><th>Área rehecha</th><th>Operario</th><th>Estado</th><th class="num">Mano de obra</th><th class="num">Materia prima</th><th class="num">Insumos</th><th class="num">Otros</th><th class="num">Total</th><th></th></tr></thead>
      <tbody>${filasProcesos}</tbody>
      <tfoot><tr><th colspan="5">Total</th><th class="num">${fmtCOP(g.costos.mo)}</th><th class="num">${fmtCOP(g.costos.mp)}</th><th class="num">${fmtCOP(g.costos.ins)}</th><th class="num">${fmtCOP(g.costos.otros)}</th><th class="num">${fmtCOP(g.costos.total)}</th><th></th></tr></tfoot>
    </table></div>

    <h4 style="margin:12px 0 6px">Materiales y otros costos del reproceso</h4>
    <div class="table-wrap"><table class="detalle-mini-table">
      <thead><tr><th>Fecha</th><th>Proceso</th><th>Tipo</th><th>Detalle</th><th class="num">Valor</th><th></th></tr></thead>
      <tbody>${filasMovs || '<tr><td colspan="6" class="card-hint">Todavía no hay materiales ni otros costos ligados a este reproceso.</td></tr>'}</tbody>
    </table></div>
    <div class="form-row" style="align-items:flex-end;margin-top:8px">
      <div class="field"><label>Proceso al que se carga</label><select class="rep-add-proc">${g.registros.map(r => `<option value="${r.id}">${(r.fecha||'').slice(0,10)} · ${esc(r.area||'')} · sub ${r.suborden ?? '—'} · ${esc(r.operario||'')}</option>`).join('')}</select></div>
      <div class="field" style="max-width:170px"><label>Tipo de costo</label><select class="rep-add-clase"><option>Materia prima</option><option>Insumo</option><option value="Otros">Otro costo</option></select></div>
      <div class="field rep-add-mat-wrap"><label>Material</label><select class="rep-add-mat"></select></div>
      <div class="field rep-add-cant-wrap" style="max-width:130px"><label>Cantidad</label><input type="number" class="rep-add-cant" min="0" step="any"></div>
      <div class="field rep-add-desc-wrap" style="display:none"><label>Descripción</label><input type="text" class="rep-add-desc" placeholder="ej. troquel nuevo, servicio externo"></div>
      <div class="field rep-add-valor-wrap" style="display:none;max-width:150px"><label>Valor</label><input type="number" class="rep-add-valor" min="0"></div>
      <div class="field" style="flex:0 0 auto"><button type="button" class="btn-secondary rep-add-btn">+ Agregar</button></div>
    </div>
    <p class="card-hint">Materia prima e insumos se descuentan del inventario y se costean con el costo por unidad del maestro. "Quitar" devuelve la cantidad al inventario.</p>

    ${g.orden != null ? `<h4 style="margin:12px 0 6px">¿Se rehicieron otros procesos de esta OP? (${otrosDeLaOP.length} registro(s) no marcados como reproceso)</h4>
    ${otrosDeLaOP.length ? `<label class="card-hint"><input type="checkbox" class="rep-ver-todos"> Mostrar también los anteriores al ${g.fechaIni.slice(0,10)}</label>
    <div class="table-wrap" style="max-height:260px;overflow:auto"><table class="detalle-mini-table">
      <thead><tr><th></th><th>Fecha</th><th>Sub.</th><th>Área</th><th>Operario</th><th>Material consumido</th><th class="num">Mano de obra</th></tr></thead>
      <tbody>${otrosDeLaOP.map(filaOtro).join('')}</tbody>
    </table></div>
    <div class="form-foot"><span class="card-hint">Los marcados pasan a ser parte de este reproceso: su mano de obra y materiales se suman al costo, y no cambian el conteo (sigue siendo un reproceso).</span>
      <button type="button" class="btn-secondary rep-incluir-btn">Incluir seleccionados en el reproceso</button></div>` : ''}` : ''}
    <div class="form-foot"><button type="button" class="btn-secondary rep-ed-cerrar">Cerrar</button></div>
  </td>`;
  tr.after(fila);

  const key = g.key;
  fila.querySelector('.rep-ed-cerrar').addEventListener('click', () => fila.remove());

  fila.querySelector('.rep-ed-guardar').addEventListener('click', async (ev) => {
    const motivo = fila.querySelector('.rep-ed-motivo').value || null;
    const origen = fila.querySelector('.rep-ed-origen').value || null;
    if(!motivo){ toast('Elige el motivo del reproceso'); return; }
    if(!origen){ toast('Elige el área que generó el reproceso'); return; }
    const updates = { motivo_reproceso: motivo, area_origen_reproceso: origen, responsable_reproceso: fila.querySelector('.rep-ed-responsable').value.trim() || null };
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Guardando…';
    try{
      const { data, error } = await sb.from('produccion').update(updates).in('id', [...idsGrupo]).select();
      if(error) throw error;
      reemplazarEnMemoria(data);
      toast('Reproceso actualizado');
      refrescarTrasCambio(key);
    }catch(err){
      console.error(err);
      toast('No se pudo guardar el reproceso — revisa la consola');
      btn.disabled = false; btn.textContent = 'Guardar datos del reproceso';
    }
  });

  // Agregar consumo / otro costo
  const selProc = fila.querySelector('.rep-add-proc');
  const selClase = fila.querySelector('.rep-add-clase');
  const selMat = fila.querySelector('.rep-add-mat');
  const actualizarCamposAdd = () => {
    const esOtro = selClase.value === 'Otros';
    fila.querySelector('.rep-add-mat-wrap').style.display = esOtro ? 'none' : '';
    fila.querySelector('.rep-add-cant-wrap').style.display = esOtro ? 'none' : '';
    fila.querySelector('.rep-add-desc-wrap').style.display = esOtro ? '' : 'none';
    fila.querySelector('.rep-add-valor-wrap').style.display = esOtro ? '' : 'none';
    if(!esOtro){
      const reg = g.registros.find(r => r.id === parseInt(selProc.value, 10));
      selMat.innerHTML = '<option value="">— elige el material —</option>' + opcionesMaterial(selClase.value, reg ? reg.area : null);
    }
  };
  selClase.addEventListener('change', actualizarCamposAdd);
  selProc.addEventListener('change', actualizarCamposAdd);
  actualizarCamposAdd();

  fila.querySelector('.rep-add-btn').addEventListener('click', async (ev) => {
    const registro = g.registros.find(r => r.id === parseInt(selProc.value, 10));
    if(!registro){ toast('Elige el proceso al que se carga el costo'); return; }
    const btn = ev.currentTarget; btn.disabled = true;
    try{
      if(selClase.value === 'Otros'){
        const desc = fila.querySelector('.rep-add-desc').value.trim();
        const valor = parseFloat(fila.querySelector('.rep-add-valor').value) || 0;
        if(!desc || valor <= 0){ toast('Escribe la descripción y un valor mayor a 0'); return; }
        await agregarOtroCostoReproceso(registro, desc, valor);
        toast('Costo agregado al reproceso');
      }else{
        const [tabla, ref] = (selMat.value || '').split('|');
        const cantidad = parseFloat(fila.querySelector('.rep-add-cant').value) || 0;
        if(!tabla || cantidad <= 0){ toast('Elige el material y una cantidad mayor a 0'); return; }
        const ok = await agregarConsumoReproceso(registro, selClase.value, tabla, ref, cantidad);
        if(!ok) return;
        toast('Consumo agregado al reproceso y descontado del inventario');
      }
      refrescarTrasCambio(key);
    }catch(err){
      console.error(err);
      toast('No se pudo agregar el costo — revisa la consola');
    }finally{
      btn.disabled = false;
    }
  });

  fila.querySelectorAll('[data-quitar-mov]').forEach(btn => btn.addEventListener('click', async () => {
    const m = DB.costos_movimientos.find(x => x.id === parseInt(btn.dataset.quitarMov, 10));
    if(!m) return;
    if(!confirm(`¿Quitar "${m.comentario}" (${fmtCOP(Number(m.valor)||0)}) del reproceso?${m.material_tabla ? ' La cantidad vuelve al inventario.' : ''}`)) return;
    btn.disabled = true;
    try{
      await quitarCostoReproceso(m);
      toast('Costo quitado del reproceso');
      refrescarTrasCambio(key);
    }catch(err){
      console.error(err);
      toast('No se pudo quitar el costo — revisa la consola');
      btn.disabled = false;
    }
  }));

  fila.querySelectorAll('[data-quitar-proc]').forEach(btn => btn.addEventListener('click', async () => {
    const r = g.registros.find(x => x.id === parseInt(btn.dataset.quitarProc, 10));
    if(!r) return;
    if(!confirm(`¿Quitar el registro de ${r.operario || ''} (${r.area || ''}, ${(r.fecha||'').slice(0,10)}) de este reproceso? El registro de producción no se borra, solo deja de contarse como reproceso.`)) return;
    btn.disabled = true;
    try{
      const { data, error } = await sb.from('produccion').update({ reproceso: 'No', motivo_reproceso: null, area_origen_reproceso: null, responsable_reproceso: null }).eq('id', r.id).select();
      if(error) throw error;
      reemplazarEnMemoria(data);
      toast('Registro quitado del reproceso');
      refrescarTrasCambio(key);
    }catch(err){
      console.error(err);
      toast('No se pudo quitar el registro — revisa la consola');
      btn.disabled = false;
    }
  }));

  const verTodos = fila.querySelector('.rep-ver-todos');
  if(verTodos) verTodos.addEventListener('change', () => {
    fila.querySelectorAll('tr[data-desde-inicio="0"]').forEach(t => t.style.display = verTodos.checked ? '' : 'none');
  });
  const btnIncluir = fila.querySelector('.rep-incluir-btn');
  if(btnIncluir) btnIncluir.addEventListener('click', async () => {
    const ids = [...fila.querySelectorAll('.rep-incluir:checked')].map(c => parseInt(c.value, 10));
    if(!ids.length){ toast('Marca al menos un registro para incluir'); return; }
    btnIncluir.disabled = true;
    try{
      const { data, error } = await sb.from('produccion').update({
        reproceso: 'Si', motivo_reproceso: g.motivo, area_origen_reproceso: g.areaOrigen, responsable_reproceso: g.responsable
      }).in('id', ids).select();
      if(error) throw error;
      reemplazarEnMemoria(data);
      toast(`${ids.length} registro(s) incluidos en el reproceso de la orden ${etiquetaOrden(g.orden)}`);
      refrescarTrasCambio(key);
    }catch(err){
      console.error(err);
      toast('No se pudieron incluir los registros — revisa la consola');
      btnIncluir.disabled = false;
    }
  });
}

// ---------- costos extra del reproceso ----------
// Consumo de material agregado desde el detalle del reproceso: descuenta
// del inventario y crea el costo ligado a ese proceso (produccion_id), con
// material/cantidad guardados para poder revertirlo exacto al "Quitar".
// El comentario NO empieza por "Consumo automático", así que "Corregir
// registro" (revertirConsumoDeRegistro) nunca lo borra por error.
async function agregarConsumoReproceso(registro, clase, tabla, ref, cantidad){
  const key = tabla === 'materias_primas' ? 'codigo' : 'id';
  const lista = tabla === 'materias_primas' ? DB.materias_primas : DB.insumos_area;
  const mat = lista.find(m => String(m[key]) === String(ref));
  if(!mat){ toast('No se encontró ese material en el maestro'); return false; }
  // Costo del momento, no el que quedó en memoria al abrir la página.
  const { data: fresco, error: errFresco } = await sb.from(tabla).select('*').eq(key, mat[key]).single();
  if(errFresco) throw errFresco;
  Object.assign(mat, fresco);
  if(!mat.costo_unitario){
    toast(`"${mat.nombre}" no tiene costo por unidad en el maestro — cárgaselo primero para que el consumo sume al costo del reproceso`, 6000);
    return false;
  }
  const concepto = DB.costos_conceptos.find(c => c.nombre === 'Consumo de materia prima (automático)');
  if(!concepto){ toast('Falta el concepto "Consumo de materia prima (automático)" en Maestros'); return false; }

  const { data: dStock, error: eStock } = await sb.from(tabla).update({ stock_actual: (mat.stock_actual || 0) - cantidad }).eq(key, mat[key]).select();
  if(eStock) throw eStock;
  Object.assign(mat, dStock[0]);

  const esIndirecto = tabla === 'insumos_area' && mat.tipo_consumo === 'Indirecto';
  const row = {
    concepto_id: concepto.id, tipo: 'Variable', fecha: registro.fecha || fechaHoyLocal(),
    valor: cantidad * mat.costo_unitario, proveedor: null,
    comentario: `Reproceso — consumo — ${mat.nombre} (${fmtNum(cantidad,2)})`,
    orden: esIndirecto ? null : (registro.orden ?? null), suborden: esIndirecto ? null : (registro.suborden ?? null),
    produccion_id: registro.id, clase_reproceso: clase, material_tabla: tabla, material_ref: String(mat[key]), cantidad
  };
  const { data, error } = await sb.from('costos_movimientos').insert([row]).select();
  if(error){
    // No dejar el stock descontado sin su costo.
    await sb.from(tabla).update({ stock_actual: (mat.stock_actual || 0) + cantidad }).eq(key, mat[key]);
    mat.stock_actual = (mat.stock_actual || 0) + cantidad;
    throw error;
  }
  DB.costos_movimientos.unshift(data[0]);
  return true;
}

async function agregarOtroCostoReproceso(registro, descripcion, valor){
  const concepto = DB.costos_conceptos.find(c => c.nombre === 'Reproceso (costo adicional)');
  if(!concepto) throw new Error('Falta el concepto "Reproceso (costo adicional)"');
  const row = {
    concepto_id: concepto.id, tipo: 'Variable', fecha: registro.fecha || fechaHoyLocal(),
    valor, proveedor: null, comentario: `Reproceso — otro costo — ${descripcion}`,
    orden: registro.orden ?? null, suborden: registro.suborden ?? null,
    produccion_id: registro.id, clase_reproceso: 'Otros'
  };
  const { data, error } = await sb.from('costos_movimientos').insert([row]).select();
  if(error) throw error;
  DB.costos_movimientos.unshift(data[0]);
}

async function quitarCostoReproceso(m){
  const { error } = await sb.from('costos_movimientos').delete().eq('id', m.id);
  if(error) throw error;
  const idx = DB.costos_movimientos.findIndex(x => x.id === m.id);
  if(idx >= 0) DB.costos_movimientos.splice(idx, 1);
  if(m.material_tabla && m.cantidad){
    const key = m.material_tabla === 'materias_primas' ? 'codigo' : 'id';
    const lista = m.material_tabla === 'materias_primas' ? DB.materias_primas : DB.insumos_area;
    const { data: fresco, error: e1 } = await sb.from(m.material_tabla).select('*').eq(key, m.material_ref).single();
    if(e1) throw e1;
    const { data, error: e2 } = await sb.from(m.material_tabla).update({ stock_actual: (fresco.stock_actual || 0) + Number(m.cantidad) }).eq(key, m.material_ref).select();
    if(e2) throw e2;
    const mat = lista.find(x => String(x[key]) === String(m.material_ref));
    if(mat && data && data[0]) Object.assign(mat, data[0]);
  }
}

// ---------- informe ----------
function datosInforme(){
  const desde = document.getElementById('rep-inf-desde').value || '2024-01-01';
  const hasta = document.getElementById('rep-inf-hasta').value || fechaHoyLocal();
  const filas = reprocesosDeProduccion().filter(r => (r.fecha||'') >= desde && (r.fecha||'') <= hasta);
  const grupos = agruparReprocesosPorOP(filas, movimientosPorProduccion()).sort((a,b) => b.fechaFin.localeCompare(a.fechaFin));
  const total = sumarCostos(grupos.map(g => g.costos));
  return { desde, hasta, filas, grupos, total };
}

export function renderInformeReprocesos(){
  const kpis = document.getElementById('rep-inf-kpis');
  if(!kpis) return;
  const { desde, hasta, filas, grupos, total } = datosInforme();

  // Estadística: cada OP cuenta UNA vez.
  const porOrigen = {}, porMotivo = {}, porPersona = {};
  grupos.forEach(g => {
    const origen = g.areaOrigen || 'Sin definir';
    if(!porOrigen[origen]) porOrigen[origen] = { n:0, procesos:0, costos:[] };
    porOrigen[origen].n++;
    porOrigen[origen].procesos += g.registros.length;
    porOrigen[origen].costos.push(g.costos);
    const motivo = g.motivo || 'Sin motivo';
    porMotivo[motivo] = (porMotivo[motivo]||0) + 1;
    // Costos: por cada proceso, al operario que lo rehízo.
    g.registros.forEach(r => {
      const persona = r.operario || 'Sin operario';
      if(!porPersona[persona]) porPersona[persona] = { operario: persona, ops: new Set(), motivos: {}, procesos:0, costos:[] };
      const p = porPersona[persona];
      if(!p.ops.has(g.key)){ p.ops.add(g.key); p.motivos[motivo] = (p.motivos[motivo]||0) + 1; }
      p.procesos++;
      p.costos.push(g.costosPorRegistro.get(r.id));
    });
  });

  const origenTop = Object.entries(porOrigen).filter(([k]) => k !== 'Sin definir').sort((a,b)=>b[1].n-a[1].n)[0];
  const motivoTop = Object.entries(porMotivo).filter(([k]) => k !== 'Sin motivo').sort((a,b)=>b[1]-a[1])[0];

  kpis.innerHTML = `
    <div class="kpi"><div class="lbl">Reprocesos (OPs)</div><div class="val">${grupos.length}</div><div class="sub">${filas.length} proceso(s) rehechos · ${desde} a ${hasta}</div></div>
    <div class="kpi"><div class="lbl">Mano de obra</div><div class="val">${fmtCOP(total.mo)}</div><div class="sub">horas × valor/hora</div></div>
    <div class="kpi"><div class="lbl">Materia prima</div><div class="val">${fmtCOP(total.mp)}</div></div>
    <div class="kpi"><div class="lbl">Insumos</div><div class="val">${fmtCOP(total.ins)}</div></div>
    <div class="kpi"><div class="lbl">Otros costos</div><div class="val">${fmtCOP(total.otros)}</div><div class="sub">costo adicional y otros</div></div>
    <div class="kpi"><div class="lbl">Costo total de reprocesos</div><div class="val">${fmtCOP(total.total)}</div></div>
    <div class="kpi"><div class="lbl">Área que más reprocesos genera</div><div class="val" style="font-size:16px">${origenTop ? esc(origenTop[0]) : '—'}</div><div class="sub">${origenTop ? origenTop[1].n + ' reproceso(s)' : ''}</div></div>
    <div class="kpi"><div class="lbl">Motivo más frecuente</div><div class="val" style="font-size:16px">${motivoTop ? esc(motivoTop[0]) : '—'}</div><div class="sub">${motivoTop ? motivoTop[1] + ' reproceso(s)' : ''}</div></div>`;

  const origenesOrdenados = Object.entries(porOrigen).sort((a,b)=>b[1].n-a[1].n).slice(0,10);
  makeChart('chart-rep-area', { type:'bar', data:{ labels: origenesOrdenados.map(a=>a[0]),
    datasets:[{ label:'Reprocesos (OPs)', data: origenesOrdenados.map(a=>a[1].n), backgroundColor:'#C24A1F' }]},
    options:{ indexAxis:'y', responsive:true, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}, ticks:{precision:0}},y:{grid:{display:false}}} } });

  const motivosOrdenados = Object.entries(porMotivo).sort((a,b)=>b[1]-a[1]).slice(0,10);
  makeChart('chart-rep-motivo', { type:'bar', data:{ labels: motivosOrdenados.map(a=>a[0]),
    datasets:[{ label:'Reprocesos (OPs)', data: motivosOrdenados.map(a=>a[1]), backgroundColor:'#2E8FC0' }]},
    options:{ indexAxis:'y', responsive:true, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}, ticks:{precision:0}},y:{grid:{display:false}}} } });

  const tbOrigen = document.querySelector('#tbl-rep-por-area-origen tbody');
  if(tbOrigen) tbOrigen.innerHTML = Object.entries(porOrigen).sort((a,b)=>b[1].n-a[1].n).map(([area, d]) => {
    const c = sumarCostos(d.costos);
    return `<tr><td>${esc(area)}</td><td class="num">${d.n}</td><td class="num">${d.procesos}</td>
      <td class="num">${fmtCOP(c.mo)}</td><td class="num">${fmtCOP(c.mp)}</td><td class="num">${fmtCOP(c.ins)}</td><td class="num">${fmtCOP(c.otros)}</td><td class="num"><b>${fmtCOP(c.total)}</b></td></tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--ink-faint)">Sin datos en este rango</td></tr>';

  const filasPersona = Object.values(porPersona).sort((a,b)=>b.procesos-a.procesos);
  document.querySelector('#tbl-rep-por-operario tbody').innerHTML = filasPersona.map(p => {
    const c = sumarCostos(p.costos);
    return `<tr>
    <td>${esc(p.operario)}</td>
    <td>${Object.entries(p.motivos).sort((a,b)=>b[1]-a[1]).map(([m,n])=>`${esc(m)} (${n})`).join(', ')}</td>
    <td class="num">${p.ops.size}</td><td class="num">${p.procesos}</td>
    <td class="num">${fmtCOP(c.mo)}</td><td class="num">${fmtCOP(c.mp)}</td><td class="num">${fmtCOP(c.ins)}</td><td class="num">${fmtCOP(c.otros)}</td><td class="num">${fmtCOP(c.total)}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--ink-faint)">Sin datos en este rango</td></tr>';
}

function imprimirInformeReprocesos(){
  const { desde, hasta, filas, grupos, total } = datosInforme();

  const filasHTML = grupos.map(g => `<tr>
    <td>${g.fechaIni.slice(0,10)}${g.fechaFin !== g.fechaIni ? ' a ' + g.fechaFin.slice(0,10) : ''}</td>
    <td>${g.orden != null ? etiquetaOrden(g.orden) : '—'}</td>
    <td>${esc(g.areaOrigen||'Sin definir')}</td><td>${esc(g.motivo||'Sin motivo')}</td><td>${esc(g.responsable||'')}</td>
    <td>${g.registros.length} — ${esc(g.areasRehechas.join(', '))}</td>
    <td class="num">${fmtCOP(g.costos.mo)}</td><td class="num">${fmtCOP(g.costos.mp)}</td><td class="num">${fmtCOP(g.costos.ins)}</td>
    <td class="num">${fmtCOP(g.costos.otros)}</td><td class="num"><b>${fmtCOP(g.costos.total)}</b></td>
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
  <div class="sub">${desde} a ${hasta} · ${grupos.length} reproceso(s) (OPs) · ${filas.length} proceso(s) rehechos ·
    Mano de obra ${fmtCOP(total.mo)} · Materia prima ${fmtCOP(total.mp)} · Insumos ${fmtCOP(total.ins)} · Otros ${fmtCOP(total.otros)} · <b>Total ${fmtCOP(total.total)}</b></div>
  <table>
    <thead><tr><th>Fecha</th><th>Orden</th><th>Área que lo generó</th><th>Motivo</th><th>Responsable</th><th>Procesos rehechos</th><th class="num">Mano de obra</th><th class="num">Materia prima</th><th class="num">Insumos</th><th class="num">Otros</th><th class="num">Total</th></tr></thead>
    <tbody>${filasHTML || '<tr><td colspan="11" style="text-align:center">Sin datos en este rango</td></tr>'}</tbody>
    <tfoot><tr><th colspan="6">Total</th><th class="num">${fmtCOP(total.mo)}</th><th class="num">${fmtCOP(total.mp)}</th><th class="num">${fmtCOP(total.ins)}</th><th class="num">${fmtCOP(total.otros)}</th><th class="num">${fmtCOP(total.total)}</th></tr></tfoot>
  </table>
</body></html>`;

  const w = window.open('', '_blank');
  if(!w){ toast('El navegador bloqueó la ventana de impresión — permite ventanas emergentes para este sitio'); return; }
  w.document.write(html); w.document.close();
  agregarBotonExcelVentana(w, w.document.title);
  w.focus();
  setTimeout(() => w.print(), 300);
}

function exportarInformeReprocesos(){
  const { desde, hasta, grupos } = datosInforme();
  exportarExcel(`reprocesos_${desde}_a_${hasta}.xlsx`, [{
    nombre: 'Reprocesos por OP',
    filas: grupos.map(g => ({
      'Fecha inicio': g.fechaIni.slice(0,10), 'Fecha fin': g.fechaFin.slice(0,10), Orden: g.orden != null ? etiquetaOrden(g.orden) : '',
      'Área que lo generó': g.areaOrigen || '', Motivo: g.motivo || '', Responsable: g.responsable || '',
      'Procesos rehechos': g.registros.length, 'Áreas rehechas': g.areasRehechas.join(', '), Estado: estadoGrupo(g),
      'Mano de obra': Math.round(g.costos.mo), 'Materia prima': Math.round(g.costos.mp), Insumos: Math.round(g.costos.ins),
      Otros: Math.round(g.costos.otros), Total: Math.round(g.costos.total)
    }))
  }, {
    nombre: 'Detalle por proceso',
    filas: grupos.flatMap(g => g.registros.map(r => {
      const c = g.costosPorRegistro.get(r.id);
      return {
        Fecha: (r.fecha||'').slice(0,10), Orden: r.orden != null ? etiquetaOrden(r.orden) : '', Suborden: r.suborden,
        'Área rehecha': r.area, Operario: r.operario, Estado: estadoReproceso(r),
        'Área que lo generó': g.areaOrigen || '', Motivo: g.motivo || '',
        'Mano de obra': Math.round(c.mo), 'Materia prima': Math.round(c.mp), Insumos: Math.round(c.ins),
        Otros: Math.round(c.otros), Total: Math.round(c.total), Comentario: r.comentario || ''
      };
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
  document.getElementById('rep-orden').addEventListener('change', () => {
    poblarPiezasRep(null);
    mostrarHintOPExistente(parseOrden(document.getElementById('rep-orden').value));
  });
  document.getElementById('rep-pieza').addEventListener('change', () => {
    const orden = parseOrden(document.getElementById('rep-orden').value);
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
