import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { getCurrentUser } from './auth.js';
import { toast, fmtCOP, fmtNum, etiquetaOrden, parseOrden, exportarExcel, fechaHoyLocal, MARCA } from './helpers.js';
import { montarEvidencias, quitarEvidencias, evidenciasDe } from './evidencias.js';
import { renderIndicadoresReprocesos } from './reproceso-indicadores.js';

// Daños de maquinaria, herramientas e infraestructura (propuesta F del análisis del
// procedimiento PR-PROD-DAÑ-01). Cada daño queda con su número (MAN-0001), las horas de
// paro, el costo de la reparación y su seguimiento (causa raíz, acción correctiva, cierre).
// El costo entra solo a "Registrar costo" como costo de MANTENIMIENTO CORRECTIVO
// (maquinaria y herramientas) o REPARACIÓN DE INFRAESTRUCTURA, así que aparece en los
// informes de egresos. Se agrupa por máquina y por área (cuando existan los
// departamentos de la Fase 7, se agrupará también por departamento).

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TIPOS = ['Maquinaria', 'Herramienta', 'Infraestructura'];
const SEVERIDADES = ['Menor', 'Mayor', 'Crítico'];
const ESTADOS = ['Abierto', 'En análisis', 'Cerrado'];
let editando = null;
let chart = null;

export async function cargarDanosEquipos(){
  const { data, error } = await sb.from('danos_equipos').select('*').order('fecha', { ascending: false });
  if(!error) DB.danos_equipos = data || [];
  else if(!DB.danos_equipos) DB.danos_equipos = [];
}
const lista = () => DB.danos_equipos || [];

function concepto(tipo){
  const nombre = tipo === 'Infraestructura' ? 'reparación de infraestructura' : 'mantenimiento correctivo de maquinaria';
  return DB.costos_conceptos.find(c => (c.nombre || '').toLowerCase() === nombre) || null;
}

// Crea, actualiza o borra el costo ligado al daño según el valor.
async function sincronizarCosto(d, costo, orden){
  const c = concepto(d.tipo);
  const comentario = `Daño ${d.numero}: ${(d.descripcion || '').slice(0, 90)}`;
  if(costo > 0){
    if(!c) throw new Error(`No existe el concepto de costo para "${d.tipo}"`);
    const row = { concepto_id: c.id, tipo: c.tipo, fecha: d.fecha, valor: costo, proveedor: d.proveedor || null, comentario, orden: orden ?? null };
    if(d.movimiento_id){
      const { data, error } = await sb.from('costos_movimientos').update(row).eq('id', d.movimiento_id).select();
      if(error) throw error;
      const i = DB.costos_movimientos.findIndex(m => m.id === d.movimiento_id); if(i >= 0 && data[0]) DB.costos_movimientos[i] = data[0];
      return d.movimiento_id;
    }
    const { data, error } = await sb.from('costos_movimientos').insert([row]).select();
    if(error) throw error;
    DB.costos_movimientos.unshift(data[0]);
    return data[0].id;
  }
  if(d.movimiento_id){
    const { error } = await sb.from('costos_movimientos').delete().eq('id', d.movimiento_id);
    if(error) throw error;
    DB.costos_movimientos = DB.costos_movimientos.filter(m => m.id !== d.movimiento_id);
  }
  return null;
}

function limpiar(){
  editando = null;
  $('dq-fecha').value = fechaHoyLocal(); $('dq-tipo').value = 'Maquinaria';
  ['dq-maquina', 'dq-area', 'dq-sev', 'dq-desc', 'dq-paro', 'dq-costo', 'dq-prov', 'dq-orden'].forEach(id => { $(id).value = ''; });
  $('dq-modo').textContent = 'Registrar un daño'; $('dq-cancelar').style.display = 'none'; ajustarTipo();
}
function ajustarTipo(){ $('dq-maquina-wrap').style.display = $('dq-tipo').value === 'Infraestructura' ? 'none' : ''; }

async function guardar(){
  const tipo = $('dq-tipo').value, fecha = $('dq-fecha').value, desc = $('dq-desc').value.trim();
  const costo = parseFloat($('dq-costo').value) || 0, paro = parseFloat($('dq-paro').value) || 0;
  const ordenTxt = $('dq-orden').value.trim(), orden = ordenTxt ? parseOrden(ordenTxt) : null;
  if(!fecha){ toast('Elige la fecha del daño'); return; }
  if(!desc){ toast('Describe qué se dañó y cómo pasó'); return; }
  if(ordenTxt && orden == null){ toast('N° de orden no válido'); return; }
  if(costo < 0 || paro < 0){ toast('El costo y las horas de paro no pueden ser negativos'); return; }
  const u = getCurrentUser();
  const base = { fecha, tipo, maquina: tipo === 'Infraestructura' ? null : ($('dq-maquina').value || null), area: $('dq-area').value || null, descripcion: desc,
    horas_paro: paro, costo, proveedor: $('dq-prov').value.trim() || null, orden, severidad: $('dq-sev').value || null };
  const btn = $('dq-guardar'); btn.disabled = true;
  try{
    if(editando){
      const previo = lista().find(x => x.id === editando);
      const movimiento_id = await sincronizarCosto({ ...previo, ...base }, costo, orden);
      const { data, error } = await sb.from('danos_equipos').update({ ...base, movimiento_id }).eq('id', editando).select();
      if(error) throw error;
      const i = DB.danos_equipos.findIndex(x => x.id === editando); if(i >= 0) DB.danos_equipos[i] = data[0];
      toast('Daño actualizado');
    } else {
      const { data, error } = await sb.from('danos_equipos').insert([{ ...base, creado_por: u ? u.nombre : null }]).select();
      if(error) throw error;
      let d = data[0];
      const movimiento_id = await sincronizarCosto(d, costo, orden);
      if(movimiento_id){
        const { data: d2, error: e2 } = await sb.from('danos_equipos').update({ movimiento_id }).eq('id', d.id).select();
        if(!e2 && d2) d = d2[0];
      }
      DB.danos_equipos.unshift(d);
      toast(`Daño ${d.numero} registrado${costo > 0 ? ' y cargado a costos como mantenimiento correctivo' : ''}`);
    }
    limpiar(); render(); renderIndicadoresReprocesos();
  }catch(err){ console.error(err); toast('No se pudo guardar el daño — revisa la consola'); }
  finally{ btn.disabled = false; }
}

async function borrar(d){
  if(!confirm(`¿Borrar el daño ${d.numero}? También se quita su costo de "Registrar costo" y sus evidencias. No se puede deshacer.`)) return;
  try{
    await sincronizarCosto(d, 0, null);
    await quitarEvidencias('d' + d.id);
    const { error } = await sb.from('danos_equipos').delete().eq('id', d.id);
    if(error) throw error;
    DB.danos_equipos = DB.danos_equipos.filter(x => x.id !== d.id);
    toast('Daño borrado'); render(); renderIndicadoresReprocesos();
  }catch(err){ console.error(err); toast('No se pudo borrar'); }
}

function abrirSeguimiento(tr, d){
  const previa = tr.parentElement.querySelector('tr.dq-seg-row');
  if(previa){ const era = previa.previousElementSibling === tr; previa.remove(); if(era) return; }
  const fila = document.createElement('tr'); fila.className = 'dq-seg-row';
  fila.innerHTML = `<td colspan="11" style="background:var(--bg-soft,#EEF3F9)">
    <h4 style="margin:4px 0 8px">Seguimiento del daño ${esc(d.numero)}</h4>
    <div class="form-row">
      <div class="field"><label>Estado</label><select class="dq-s-estado">${ESTADOS.map(e => `<option${e === d.estado ? ' selected' : ''}>${e}</option>`).join('')}</select></div>
      <div class="field"><label>Severidad</label><select class="dq-s-sev"><option value="">—</option>${SEVERIDADES.map(e => `<option${e === d.severidad ? ' selected' : ''}>${e}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Causa raíz <span class="card-hint">(¿por qué falló?)</span></label><textarea class="dq-s-causa" rows="2">${esc(d.causa_raiz || '')}</textarea></div>
      <div class="field"><label>Acción correctiva <span class="card-hint">(qué se hará para que no se repita: mantenimiento preventivo, repuesto, capacitación…)</span></label><textarea class="dq-s-accion" rows="2">${esc(d.accion_correctiva || '')}</textarea></div>
    </div>
    <h4 style="margin:10px 0 6px">Evidencias (fotos y documentos)</h4><div class="dq-evid"></div>
    <div class="form-foot"><span class="card-hint">${d.estado === 'Cerrado' && d.fecha_cierre ? 'Cerrado el ' + String(d.fecha_cierre).slice(0, 10) + '.' : 'Para cerrar se piden severidad, causa raíz y acción correctiva.'}</span>
      <button type="button" class="btn-secondary dq-s-cerrar" style="margin:0">Cerrar panel</button>
      <button type="button" class="btn-primary dq-s-guardar">Guardar seguimiento</button></div></td>`;
  tr.after(fila);
  montarEvidencias(fila.querySelector('.dq-evid'), 'd' + d.id, () => renderIndicadoresReprocesos());
  fila.querySelector('.dq-s-cerrar').addEventListener('click', () => fila.remove());
  fila.querySelector('.dq-s-guardar').addEventListener('click', async (ev) => {
    const v = s => fila.querySelector(s).value.trim() || null;
    const estado = fila.querySelector('.dq-s-estado').value;
    const cambios = { estado, severidad: v('.dq-s-sev'), causa_raiz: v('.dq-s-causa'), accion_correctiva: v('.dq-s-accion'), fecha_cierre: null };
    if(estado === 'Cerrado'){
      if(!cambios.severidad){ toast('Para cerrar elige la severidad'); return; }
      if(!cambios.causa_raiz){ toast('Para cerrar escribe la causa raíz'); return; }
      if(!cambios.accion_correctiva){ toast('Para cerrar escribe la acción correctiva'); return; }
      cambios.fecha_cierre = (d.estado === 'Cerrado' && d.fecha_cierre) ? String(d.fecha_cierre).slice(0, 10) : fechaHoyLocal();
    }
    const btn = ev.currentTarget; btn.disabled = true;
    const { data, error } = await sb.from('danos_equipos').update(cambios).eq('id', d.id).select();
    btn.disabled = false;
    if(error){ console.error(error); toast('No se pudo guardar el seguimiento'); return; }
    const i = DB.danos_equipos.findIndex(x => x.id === d.id); if(i >= 0) DB.danos_equipos[i] = data[0];
    toast(estado === 'Cerrado' ? 'Daño cerrado' : 'Seguimiento guardado'); render(); renderIndicadoresReprocesos();
  });
}

function render(){
  const cont = $('dq-tabla'); if(!cont) return;
  const l = lista();
  const anio = String(new Date().getFullYear());
  const delAnio = l.filter(d => String(d.fecha).startsWith(anio));
  const tarjeta = (t, v, s) => `<div class="kpi"><div class="lbl">${t}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`;
  $('dq-kpis').innerHTML = [
    tarjeta(`Daños ${anio}`, delAnio.length, `${l.filter(d => d.estado !== 'Cerrado').length} abierto(s) en total`),
    tarjeta(`Costo de reparaciones ${anio}`, fmtCOP(delAnio.reduce((s, d) => s + (Number(d.costo) || 0), 0)), 'mantenimiento correctivo y reparación'),
    tarjeta(`Horas de paro ${anio}`, fmtNum(delAnio.reduce((s, d) => s + (Number(d.horas_paro) || 0), 0), 1), 'tiempo con el equipo detenido'),
    tarjeta('Daños críticos abiertos', l.filter(d => d.severidad === 'Crítico' && d.estado !== 'Cerrado').length, 'requieren seguimiento')
  ].join('');

  const q = ($('dq-q').value || '').trim().toLowerCase(), ft = $('dq-ft').value;
  let filas = l.filter(d => !ft || d.tipo === ft);
  if(q) filas = filas.filter(d => `${d.numero} ${d.maquina || ''} ${d.area || ''} ${d.descripcion} ${d.proveedor || ''}`.toLowerCase().includes(q));
  cont.innerHTML = `<table class="detalle-mini-table"><thead><tr><th>N.º</th><th>Fecha</th><th>Tipo</th><th>Máquina / lugar</th><th>Área</th><th>Descripción</th><th class="num">Paro (h)</th><th class="num">Costo</th><th>Severidad</th><th>Estado</th><th></th></tr></thead><tbody>${filas.map(d => `<tr>
    <td><b>${esc(d.numero)}</b></td><td>${String(d.fecha).slice(0, 10)}</td><td>${d.tipo}</td><td>${esc(d.maquina || '—')}</td><td>${esc(d.area || '—')}</td><td style="max-width:280px;white-space:normal">${esc(d.descripcion)}${d.orden != null ? ` <span class="card-hint">· OP ${etiquetaOrden(d.orden)}</span>` : ''}</td>
    <td class="num">${fmtNum(d.horas_paro || 0, 1)}</td><td class="num">${fmtCOP(d.costo || 0)}</td><td>${esc(d.severidad || '—')}</td>
    <td><b style="color:${d.estado === 'Cerrado' ? 'var(--good)' : d.estado === 'En análisis' ? MARCA.violet : 'var(--bad)'}">${d.estado}</b>${evidenciasDe('d' + d.id).length ? ` <span class="card-hint">📎${evidenciasDe('d' + d.id).length}</span>` : ''}</td>
    <td style="white-space:nowrap"><button type="button" class="row-btn" data-dq-seg="${d.id}">Seguimiento</button><button type="button" class="row-btn" data-dq-edit="${d.id}">Editar</button><button type="button" class="row-btn row-btn-danger" data-dq-del="${d.id}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="11" style="text-align:center;color:var(--ink-faint)">Todavía no hay daños registrados</td></tr>'}</tbody></table>`;

  cont.querySelectorAll('[data-dq-seg]').forEach(b => b.addEventListener('click', () => abrirSeguimiento(b.closest('tr'), lista().find(x => x.id === parseInt(b.dataset.dqSeg, 10)))));
  cont.querySelectorAll('[data-dq-del]').forEach(b => b.addEventListener('click', () => borrar(lista().find(x => x.id === parseInt(b.dataset.dqDel, 10)))));
  cont.querySelectorAll('[data-dq-edit]').forEach(b => b.addEventListener('click', () => {
    const d = lista().find(x => x.id === parseInt(b.dataset.dqEdit, 10)); if(!d) return;
    editando = d.id;
    $('dq-fecha').value = String(d.fecha).slice(0, 10); $('dq-tipo').value = d.tipo; ajustarTipo();
    $('dq-maquina').value = d.maquina || ''; $('dq-area').value = d.area || ''; $('dq-sev').value = d.severidad || ''; $('dq-desc').value = d.descripcion;
    $('dq-paro').value = d.horas_paro ?? ''; $('dq-costo').value = d.costo ?? ''; $('dq-prov').value = d.proveedor || ''; $('dq-orden').value = d.orden != null ? etiquetaOrden(d.orden) : '';
    $('dq-modo').textContent = `Editando el daño ${d.numero}`; $('dq-cancelar').style.display = '';
    $('dq-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));

  // resumen por máquina (gráfico) y por área (tabla)
  const porMaq = {}, porArea = {};
  l.forEach(d => {
    const k = d.maquina || (d.tipo === 'Infraestructura' ? 'Infraestructura' : 'Sin máquina');
    porMaq[k] = (porMaq[k] || 0) + (Number(d.costo) || 0);
    const a = d.area || 'Sin área'; (porArea[a] ||= { n: 0, costo: 0, paro: 0 }); porArea[a].n++; porArea[a].costo += Number(d.costo) || 0; porArea[a].paro += Number(d.horas_paro) || 0;
  });
  const top = Object.entries(porMaq).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if(typeof Chart !== 'undefined' && $('dq-chart')){
    if(chart) chart.destroy();
    chart = new Chart($('dq-chart'), { type: 'bar', data: { labels: top.map(t => t[0]), datasets: [{ label: 'Costo de reparaciones', data: top.map(t => t[1]), backgroundColor: MARCA.blue }] },
      options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtCOP(c.parsed.x) } } }, scales: { x: { grid: { color: 'rgba(150,150,150,.15)' }, ticks: { font: { size: 10 }, callback: v => '$' + fmtNum(v / 1e6, 1) + ' M' } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } } } });
  }
  $('dq-areas').innerHTML = `<table class="detalle-mini-table"><thead><tr><th>Área</th><th class="num">Daños</th><th class="num">Paro (h)</th><th class="num">Costo</th></tr></thead><tbody>${Object.entries(porArea).sort((a, b) => b[1].costo - a[1].costo).map(([a, v]) => `<tr><td>${esc(a)}</td><td class="num">${v.n}</td><td class="num">${fmtNum(v.paro, 1)}</td><td class="num">${fmtCOP(v.costo)}</td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-faint)">Sin datos</td></tr>'}</tbody></table>`;
}

export function renderDanosEquipos(){ render(); }

export async function initDanosEquipos(){
  if(!$('panel-danos-equipos')) return;
  $('dq-tipo').innerHTML = TIPOS.map(t => `<option>${t}</option>`).join('');
  $('dq-ft').innerHTML = '<option value="">Todos los tipos</option>' + TIPOS.map(t => `<option>${t}</option>`).join('');
  $('dq-sev').innerHTML = '<option value="">—</option>' + SEVERIDADES.map(t => `<option>${t}</option>`).join('');
  const poblar = () => {
    $('dq-maquina').innerHTML = '<option value="">— otra / no está en la lista —</option>' + (DB.maquinas || []).filter(m => m.activo !== false).map(m => `<option>${esc(m.nombre)}</option>`).join('');
    $('dq-area').innerHTML = '<option value="">—</option>' + (DB.areas || []).filter(a => a.activo !== false).map(a => `<option>${esc(a.nombre)}</option>`).join('');
  };
  poblar();
  $('dq-tipo').addEventListener('change', ajustarTipo);
  $('dq-guardar').addEventListener('click', guardar);
  $('dq-cancelar').addEventListener('click', limpiar);
  ['dq-q', 'dq-ft'].forEach(id => $(id).addEventListener(id === 'dq-q' ? 'input' : 'change', render));
  $('dq-exportar').addEventListener('click', () => exportarExcel('LitoColor_danos_equipos.xlsx', [{ nombre: 'Daños de equipos', filas: lista().map(d => ({ Número: d.numero, Fecha: String(d.fecha).slice(0, 10), Tipo: d.tipo, 'Máquina / lugar': d.maquina || '', Área: d.area || '', Descripción: d.descripcion, 'Horas de paro': d.horas_paro, Costo: d.costo, Proveedor: d.proveedor || '', OP: d.orden ?? '', Severidad: d.severidad || '', Estado: d.estado, 'Causa raíz': d.causa_raiz || '', 'Acción correctiva': d.accion_correctiva || '', Cierre: d.fecha_cierre ? String(d.fecha_cierre).slice(0, 10) : '' })) }]));
  document.querySelector('.tab-btn[data-tab="danos-equipos"]')?.addEventListener('click', async () => { poblar(); await cargarDanosEquipos(); render(); });
  limpiar();
  await cargarDanosEquipos();
  render();
  renderIndicadoresReprocesos();
}
