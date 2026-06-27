import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast, fmtNum } from './helpers.js';

let oppPiezaCount = 0;
let editingOrden = null; // si no es null, Guardar actualiza esa orden en vez de crear una nueva

// ---------- cálculo de imposición (geometría pura, sugerida y editable) ----------
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

  if(prefill) fillPiezaCard(node, prefill);
  recalcPieza(node);
  updateOppPreview();
  return node;
}

function fillPiezaCard(node, p){
  node.querySelector('.f-pieza').value = p.pieza || '';
  node.querySelector('.f-cantidad').value = p.cantidad ?? '';
  node.querySelector('.f-tam-ancho').value = p.tamano_ancho ?? '';
  node.querySelector('.f-tam-alto').value = p.tamano_alto ?? '';
  node.querySelector('.f-papel').value = p.papel || '';
  if(p.pliego_ancho && p.pliego_alto) node.querySelector('.f-pliego').value = p.pliego_ancho + 'x' + p.pliego_alto;
  node.querySelector('.f-tintas-frente').value = p.tintas_frente ?? 4;
  node.querySelector('.f-tintas-atras').value = p.tintas_atras ?? 0;
  node.querySelector('.f-ctp').value = p.ctp || 'Convencional';
  node.querySelector('.f-tira').value = p.tira_retira || 'Tira y retira';
  node.querySelector('.f-laminado').value = p.laminado || '';
  node.querySelector('.f-laminado-lados').value = p.laminado_lados || 0;
  node.querySelector('.f-barniz').checked = !!p.barniz_uv;
  node.querySelector('.f-troquelado').checked = !!p.troquelado;
  node.querySelector('.f-troquel-detalle').value = p.troquel_detalle || '';
  node.querySelector('.f-talonarios').checked = !!p.talonarios;
  node.querySelector('.f-otros').value = p.otros_acabados || '';
  node.querySelector('.f-unidades-montaje').value = p.unidades_por_montaje || 1;
  const ma = node.querySelector('.f-medida-ancho'), mal = node.querySelector('.f-medida-alto');
  ma.value = p.medida_tamano_ancho ?? ''; ma.dataset.touched = '1';
  mal.value = p.medida_tamano_alto ?? ''; mal.dataset.touched = '1';
  const pp = node.querySelector('.f-tam-por-pliego'); pp.value = p.tamanos_por_pliego ?? ''; pp.dataset.touched = '1';
  const tp = node.querySelector('.f-tam-programados'); tp.value = p.tamanos_programados ?? ''; tp.dataset.touched = '1';
  const requeridos = Array.isArray(p.procesos_requeridos) ? p.procesos_requeridos : [];
  node.querySelectorAll('.f-proc').forEach(cb => {
    cb.checked = requeridos.includes(cb.value);
    cb.dataset.touched = '1';
  });
}

function recalcPieza(node){
  const cantidad = parseFloat(node.querySelector('.f-cantidad').value) || 0;
  const unidadesMontaje = parseFloat(node.querySelector('.f-unidades-montaje').value) || 1;
  const tamAncho = parseFloat(node.querySelector('.f-tam-ancho').value) || 0;
  const tamAlto = parseFloat(node.querySelector('.f-tam-alto').value) || 0;
  const pliego = node.querySelector('.f-pliego').value.split('x').map(Number);
  const medidaAnchoEl = node.querySelector('.f-medida-ancho');
  const medidaAltoEl = node.querySelector('.f-medida-alto');

  if(!medidaAnchoEl.dataset.touched && tamAncho) medidaAnchoEl.value = (tamAncho + 5).toFixed(1);
  if(!medidaAltoEl.dataset.touched && tamAlto) medidaAltoEl.value = (tamAlto + 5).toFixed(1);
  medidaAnchoEl.oninput = () => medidaAnchoEl.dataset.touched = '1';
  medidaAltoEl.oninput = () => medidaAltoEl.dataset.touched = '1';

  const medidaAncho = parseFloat(medidaAnchoEl.value) || 0;
  const medidaAlto = parseFloat(medidaAltoEl.value) || 0;

  const tamSolicitados = unidadesMontaje > 0 ? Math.ceil(cantidad / unidadesMontaje) : cantidad;
  node.querySelector('.f-tam-solicitados').value = tamSolicitados || 0;

  const porPliegoEl = node.querySelector('.f-tam-por-pliego');
  if(!porPliegoEl.dataset.touched) porPliegoEl.value = calcPorPliego(pliego[0], pliego[1], medidaAncho, medidaAlto) || '';
  porPliegoEl.oninput = () => porPliegoEl.dataset.touched = '1';

  const programadosEl = node.querySelector('.f-tam-programados');
  if(!programadosEl.dataset.touched) programadosEl.value = tamSolicitados ? Math.round(tamSolicitados * 1.10) : '';
  programadosEl.oninput = () => programadosEl.dataset.touched = '1';

  const porPliego = parseFloat(porPliegoEl.value) || 0;
  const programados = parseFloat(programadosEl.value) || 0;
  const pliegos = porPliego > 0 ? Math.ceil(programados / porPliego) : 0;
  node.querySelector('.f-pliegos-result').textContent = pliegos ? fmtNum(pliegos, 0) : '—';

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
    ...DB.pedidos.map(p => p.orden),
    ...DB.opp_ordenes.map(o => o.orden)
  ].filter(n => typeof n === 'number');
  const max = all.length ? Math.max(...all) : 5938;
  return max + 1;
}

// ---------- estado / avance de una orden ----------
export function areasCompletadasPorPieza(pieza){
  const recs = DB.produccion.filter(r => r.op === pieza.op || (r.orden === pieza.orden && r.suborden === pieza.suborden));
  return new Set(recs.map(r => r.area).filter(Boolean));
}

export function estadoOrden(o){
  if(o.estado === 'Cancelada') return { label: 'Cancelada', pct: null };
  const piezas = DB.opp_piezas.filter(p => p.orden === o.orden);
  if(!piezas.length) return { label: 'Pendiente', pct: 0 };
  let totalReq = 0, totalDone = 0, algunoEmpezado = false;
  piezas.forEach(p => {
    const req = Array.isArray(p.procesos_requeridos) ? p.procesos_requeridos : [];
    const done = areasCompletadasPorPieza(p);
    totalReq += req.length;
    const doneCount = req.filter(a => done.has(a)).length;
    totalDone += doneCount;
    if(doneCount > 0) algunoEmpezado = true;
  });
  if(totalReq === 0) return { label: 'Pendiente', pct: 0 };
  const pct = Math.round((totalDone / totalReq) * 100);
  if(pct >= 100) return { label: 'Completada', pct: 100 };
  if(algunoEmpezado) return { label: 'En proceso', pct };
  return { label: 'Pendiente', pct: 0 };
}

function estadoBadgeHTML(estado){
  const cls = { 'Completada':'done', 'En proceso':'estado-chip-warn', 'Pendiente':'pending', 'Cancelada':'pending' }[estado.label] || 'pending';
  const pct = estado.pct != null ? ` (${estado.pct}%)` : '';
  return `<span class="estado-chip ${cls}">${estado.label}${pct}</span>`;
}

// ---------- costo acumulado de una orden ----------
function costoAcumulado(orden){
  return DB.produccion.filter(r => r.orden === orden).reduce((s,r)=>s+(r.valorActividad||0),0);
}

// ---------- render: tablas y tableros ----------
export function renderOppRecent(){
  renderOppLista(DB.opp_ordenes.slice(0, 20));
  renderEstadoOrdenes();
  renderOrdenesVivas();
  renderRadarHistorico();
}

function renderOppLista(rows){
  const conteo = {};
  DB.opp_piezas.forEach(p => { conteo[p.orden] = (conteo[p.orden] || 0) + 1; });
  document.querySelector('#tbl-opp-recent tbody').innerHTML = rows.map(o => {
    const estado = estadoOrden(o);
    const costo = costoAcumulado(o.orden);
    return `<tr>
      <td>${o.orden}</td><td>${o.cliente || '—'}</td><td>${o.producto || '—'}</td>
      <td class="num">${conteo[o.orden] || 0}</td><td>${(o.fecha || '').slice(0,10)}</td>
      <td>${estadoBadgeHTML(estado)}</td><td class="num">${fmtCOPlocal(costo)}</td>
      <td><div class="row-actions">
        <button type="button" class="row-btn" data-edit="${o.orden}">Editar</button>
        <button type="button" class="row-btn" data-dup="${o.orden}">Duplicar</button>
        ${o.estado!=='Cancelada' ? `<button type="button" class="row-btn row-btn-danger" data-cancel="${o.orden}">Cancelar</button>` : ''}
      </div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--ink-faint)">Sin órdenes registradas</td></tr>';

  document.querySelectorAll('#tbl-opp-recent [data-edit]').forEach(b => b.addEventListener('click', () => loadOrdenParaEditar(parseInt(b.dataset.edit,10))));
  document.querySelectorAll('#tbl-opp-recent [data-dup]').forEach(b => b.addEventListener('click', () => duplicarOrden(parseInt(b.dataset.dup,10))));
  document.querySelectorAll('#tbl-opp-recent [data-cancel]').forEach(b => b.addEventListener('click', () => cancelarOrden(parseInt(b.dataset.cancel,10))));
}
function fmtCOPlocal(n){ if(n==null||isNaN(n)) return '—'; return '$' + Math.round(n).toLocaleString('es-CO'); }

export function renderOrdenesVivas(){
  const tbody = document.querySelector('#tbl-ordenes-vivas tbody');
  if(!tbody) return;
  const filas = [];
  DB.opp_ordenes.forEach(o => {
    if(o.estado === 'Cancelada') return;
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

export function renderEstadoOrdenes(){
  const ordenes = DB.opp_ordenes.slice(0, 15);
  const cont = document.getElementById('opp-estado-list');
  if(!cont) return;
  if(!ordenes.length){
    cont.innerHTML = '<p style="color:var(--ink-faint);font-size:13px">Aún no hay órdenes guardadas.</p>';
    return;
  }
  cont.innerHTML = ordenes.map(o => {
    const piezas = DB.opp_piezas.filter(p => p.orden === o.orden);
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
    const estado = estadoOrden(o);
    return `<div class="estado-orden">
      <div class="estado-orden-head"><b>Orden ${o.orden} — ${o.cliente || ''}</b>${estadoBadgeHTML(estado)}</div>
      ${filas}
    </div>`;
  }).join('') || '<p style="color:var(--ink-faint);font-size:13px">Sin piezas asociadas todavía.</p>';
}

// ---------- radar histórico: órdenes del Excel migrado, último mes ----------
export function renderRadarHistorico(){
  const tbl = document.getElementById('tbl-radar-historico');
  if(!tbl) return;
  const hoy = new Date();
  const haceUnMes = new Date(hoy); haceUnMes.setDate(haceUnMes.getDate() - 30);
  const ordenesConOpp = new Set(DB.opp_ordenes.map(o => o.orden));

  const ultimaPorOrden = {};
  DB.produccion.forEach(r => {
    if(r.orden == null || ordenesConOpp.has(r.orden)) return; // ya tiene OPP propia, no es "histórica suelta"
    if(!r.fecha) return;
    if(!ultimaPorOrden[r.orden] || r.fecha > ultimaPorOrden[r.orden].fecha){
      ultimaPorOrden[r.orden] = { fecha: r.fecha, cliente: r.cliente, trabajo: r.trabajo };
    }
  });
  const vivas = Object.entries(ultimaPorOrden)
    .filter(([orden, info]) => new Date(info.fecha) >= haceUnMes)
    .sort((a,b) => b[1].fecha.localeCompare(a[1].fecha));

  document.querySelector('#tbl-radar-historico tbody').innerHTML = vivas.map(([orden, info]) =>
    `<tr><td>${orden}</td><td>${info.cliente || '—'}</td><td>${info.trabajo || '—'}</td><td>${info.fecha.slice(0,10)}</td></tr>`
  ).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-faint)">Sin actividad histórica en el último mes</td></tr>';
}

// ---------- crear / editar / duplicar / cancelar ----------
function resetOppForm(nextOrden){
  editingOrden = null;
  document.getElementById('opp-form-mode').textContent = 'Creando una orden nueva';
  document.getElementById('opp-piezas-list').innerHTML = '';
  oppPiezaCount = 0;
  document.getElementById('opp-cliente').value = '';
  document.getElementById('opp-producto').value = '';
  document.getElementById('opp-orden').value = nextOrden != null ? nextOrden : suggestNextOrden();
  document.getElementById('opp-orden').disabled = false;
  document.getElementById('opp-fecha').value = new Date().toISOString().slice(0,10);
  addPiezaCard();
}

function loadOrdenParaEditar(orden){
  const o = DB.opp_ordenes.find(x => x.orden === orden);
  if(!o) return;
  editingOrden = orden;
  document.getElementById('opp-form-mode').textContent = `Editando la orden ${orden} — al guardar se sobrescribe`;
  document.getElementById('opp-orden').value = orden;
  document.getElementById('opp-orden').disabled = true;
  document.getElementById('opp-cliente').value = o.cliente || '';
  document.getElementById('opp-producto').value = o.producto || '';
  document.getElementById('opp-fecha').value = (o.fecha || '').slice(0,10) || new Date().toISOString().slice(0,10);

  document.getElementById('opp-piezas-list').innerHTML = '';
  oppPiezaCount = 0;
  const piezas = DB.opp_piezas.filter(p => p.orden === orden).sort((a,b)=>a.suborden-b.suborden);
  piezas.forEach(p => addPiezaCard(p));
  if(!piezas.length) addPiezaCard();
  toast('Orden ' + orden + ' cargada para editar');
  document.getElementById('panel-ordenes').scrollIntoView({ behavior:'smooth' });
}

function duplicarOrden(orden){
  const o = DB.opp_ordenes.find(x => x.orden === orden);
  if(!o) return;
  editingOrden = null; // se guarda como ORDEN NUEVA
  const nuevoNumero = suggestNextOrden();
  document.getElementById('opp-form-mode').textContent = `Duplicando la orden ${orden} → se guardará como una orden nueva`;
  document.getElementById('opp-orden').value = nuevoNumero;
  document.getElementById('opp-orden').disabled = false;
  document.getElementById('opp-cliente').value = o.cliente || '';
  document.getElementById('opp-producto').value = o.producto || '';
  document.getElementById('opp-fecha').value = new Date().toISOString().slice(0,10);

  document.getElementById('opp-piezas-list').innerHTML = '';
  oppPiezaCount = 0;
  const piezas = DB.opp_piezas.filter(p => p.orden === orden).sort((a,b)=>a.suborden-b.suborden);
  piezas.forEach(p => addPiezaCard(p));
  if(!piezas.length) addPiezaCard();
  toast('Ajusta precios/cantidades y guarda como nueva orden ' + nuevoNumero);
  document.getElementById('panel-ordenes').scrollIntoView({ behavior:'smooth' });
}

async function cancelarOrden(orden){
  if(!confirm(`¿Cancelar la orden ${orden}? Esto no borra su historial, solo la marca como cancelada.`)) return;
  const { error } = await sb.from('opp_ordenes').update({ estado: 'Cancelada' }).eq('orden', orden);
  if(error){ console.error(error); toast('No se pudo cancelar la orden'); return; }
  const o = DB.opp_ordenes.find(x => x.orden === orden);
  if(o) o.estado = 'Cancelada';
  toast('Orden ' + orden + ' cancelada');
  renderOppRecent();
}

async function saveOpp(){
  const btn = document.getElementById('opp-save');
  const orden = parseInt(document.getElementById('opp-orden').value, 10);
  const cliente = document.getElementById('opp-cliente').value.trim();
  const cards = document.querySelectorAll('#opp-piezas-list .opp-pieza-card');

  if(!orden || !cliente){ toast('Falta el número de orden o el cliente'); return; }
  if(cards.length === 0){ toast('Agrega al menos una pieza'); return; }

  btn.disabled = true; btn.textContent = 'Guardando…';
  try{
    const cabecera = {
      orden, cliente,
      producto: document.getElementById('opp-producto').value.trim() || null,
      fecha: document.getElementById('opp-fecha').value
    };

    if(editingOrden === orden){
      const { error: errUpd } = await sb.from('opp_ordenes').update(cabecera).eq('orden', orden);
      if(errUpd) throw errUpd;
      const { error: errDel } = await sb.from('opp_piezas').delete().eq('orden', orden);
      if(errDel) throw errDel;
    } else {
      const { error: errIns } = await sb.from('opp_ordenes').insert([cabecera]);
      if(errIns) throw errIns;
    }

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

    toast((editingOrden===orden ? 'Orden actualizada: ' : 'Orden guardada: ') + orden + ' con ' + piezasPayload.length + ' pieza(s)');

    const { data: o1 } = await sb.from('opp_ordenes').select('*').order('orden', { ascending: false });
    const { data: o2 } = await sb.from('opp_piezas').select('*');
    DB.opp_ordenes = o1 || [];
    DB.opp_piezas = o2 || [];

    resetOppForm(suggestNextOrden());
    renderOppRecent();
  }catch(err){
    console.error(err);
    toast('Error al guardar la orden — revisa la consola');
  }finally{
    btn.disabled = false; btn.textContent = 'Guardar orden completa';
  }
}

function filtrarOrdenes(){
  const q = document.getElementById('opp-buscar').value.trim().toLowerCase();
  if(!q){ renderOppLista(DB.opp_ordenes.slice(0,20)); return; }
  const filtradas = DB.opp_ordenes.filter(o =>
    String(o.orden).includes(q) ||
    (o.cliente||'').toLowerCase().includes(q) ||
    (o.producto||'').toLowerCase().includes(q)
  );
  renderOppLista(filtradas.slice(0,50));
}

export function initOppForm(){
  resetOppForm();
  document.getElementById('opp-add-pieza').addEventListener('click', () => addPiezaCard());
  document.getElementById('opp-save').addEventListener('click', saveOpp);
  document.getElementById('opp-reset').addEventListener('click', () => resetOppForm());
  document.getElementById('opp-buscar').addEventListener('input', filtrarOrdenes);
}
