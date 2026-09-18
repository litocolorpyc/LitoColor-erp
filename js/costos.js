import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast, fmtCOP, fmtNum, fechaHoyLocal, imprimirInforme, exportarExcel } from './helpers.js';
import { buscarConsumosSinCostear, aplicarCosteoConsumosPendientes } from './registrar.js';

// ---------- Maestro: Conceptos de costo ----------
let editingConceptoId = null;

function renderConceptos(){
  const tbody = document.querySelector('#tbl-costos-conceptos tbody');
  if(!tbody) return;
  const ordenados = [...DB.costos_conceptos].sort((a,b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre));
  tbody.innerHTML = ordenados.map(c => `<tr style="${c.activo===false?'opacity:.5':''}">
    <td>${c.nombre}</td>
    <td><span class="badge" style="background:${c.tipo==='Fijo'?'#2E8FC022':'#D8854A22'};color:${c.tipo==='Fijo'?'#2E8FC0':'#D8854A'}">${c.tipo}</span></td>
    <td>${c.categoria || '—'}</td>
    <td><div class="row-actions">
      <button type="button" class="row-btn" data-edit="${c.id}">Editar</button>
      <button type="button" class="row-btn ${c.activo===false?'':'row-btn-danger'}" data-toggle="${c.id}">${c.activo===false?'Reactivar':'Retirar'}</button>
    </div></td>
  </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-faint)">Sin conceptos todavía</td></tr>';

  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const c = DB.costos_conceptos.find(x => x.id === parseInt(b.dataset.edit,10));
    if(!c) return;
    editingConceptoId = c.id;
    document.getElementById('cc-nombre').value = c.nombre;
    document.getElementById('cc-tipo').value = c.tipo;
    document.getElementById('cc-categoria').value = c.categoria || '';
    document.getElementById('cc-save').textContent = 'Guardar cambios';
    document.getElementById('cc-mode').textContent = 'Editando "' + c.nombre + '"';
  }));
  tbody.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
    const c = DB.costos_conceptos.find(x => x.id === parseInt(b.dataset.toggle,10));
    if(!c) return;
    const nuevo = !(c.activo !== false);
    const { data, error } = await sb.from('costos_conceptos').update({ activo: nuevo }).eq('id', c.id).select();
    if(error){ console.error(error); toast('No se pudo actualizar'); return; }
    Object.assign(c, data[0]);
    renderConceptos();
    poblarSelectConcepto();
  }));
}

function resetFormConcepto(){
  editingConceptoId = null;
  document.getElementById('cc-nombre').value = '';
  document.getElementById('cc-categoria').value = '';
  document.getElementById('cc-save').textContent = 'Agregar concepto';
  document.getElementById('cc-mode').textContent = '';
}

async function guardarConcepto(){
  const nombre = document.getElementById('cc-nombre').value.trim();
  const tipo = document.getElementById('cc-tipo').value;
  const categoria = document.getElementById('cc-categoria').value.trim() || null;
  if(!nombre){ toast('Falta el nombre del concepto'); return; }
  const btn = document.getElementById('cc-save');
  btn.disabled = true;
  try{
    if(editingConceptoId){
      const { data, error } = await sb.from('costos_conceptos').update({ nombre, tipo, categoria }).eq('id', editingConceptoId).select();
      if(error) throw error;
      const idx = DB.costos_conceptos.findIndex(c => c.id === editingConceptoId);
      if(idx>=0) DB.costos_conceptos[idx] = data[0];
      toast('Concepto actualizado');
    } else {
      const { data, error } = await sb.from('costos_conceptos').insert([{ nombre, tipo, categoria, activo:true }]).select();
      if(error) throw error;
      DB.costos_conceptos.push(data[0]);
      toast('Concepto agregado');
    }
    resetFormConcepto();
    renderConceptos();
    poblarSelectConcepto();
  }catch(err){
    console.error(err);
    toast('Error al guardar — revisa la consola');
  }finally{
    btn.disabled = false;
  }
}

export function poblarDatalistProveedores(){
  const dl = document.getElementById('rc-proveedor-list');
  if(!dl) return;
  dl.innerHTML = DB.proveedores.filter(p=>p.activo!==false).map(p => `<option value="${p.nombre}">`).join('');
}

function poblarSelectOrdenCosto(){
  const sel = document.getElementById('rc-orden');
  if(!sel) return;
  const activas = DB.opp_ordenes.slice().sort((a,b) => b.orden - a.orden).slice(0, 200);
  sel.innerHTML = '<option value="">— Sin orden asociada (se reparte entre todas) —</option>' +
    activas.map(o => `<option value="${o.orden}">${o.orden} — ${o.cliente||''}</option>`).join('');
}

// ---------- Registrar un movimiento de costo ----------
function poblarSelectConcepto(){
  const sel = document.getElementById('rc-concepto');
  if(!sel) return;
  const valorPrevio = sel.value;
  const activos = DB.costos_conceptos.filter(c => c.activo !== false)
    .sort((a,b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre));
  sel.innerHTML = '<option value="">Selecciona un concepto…</option>' +
    activos.map(c => `<option value="${c.id}" data-tipo="${c.tipo}">${c.tipo} — ${c.nombre}</option>`).join('');
  if(valorPrevio) sel.value = valorPrevio;
}

let editingMovimientoId = null;

export function renderMovimientosRecientes(){
  const tbody = document.querySelector('#tbl-costos-recientes tbody');
  if(!tbody) return;
  const conceptoNombre = id => { const c = DB.costos_conceptos.find(x=>x.id===id); return c ? c.nombre : '—'; };
  const recientes = [...DB.costos_movimientos].sort((a,b)=> b.fecha.localeCompare(a.fecha) || b.id - a.id).slice(0,20);
  tbody.innerHTML = recientes.map(m => {
    // Solo se puede editar/borrar desde acá lo que se registró a mano en
    // este mismo formulario — lo que viene de una compra importada
    // (recibo_id) o de un consumo automático de producción (produccion_id)
    // tiene su propio dueño (el documento / el registro de producción) y
    // corregirlo solo acá lo dejaría desincronizado con ese origen.
    const editable = m.recibo_id == null && m.produccion_id == null;
    return `<tr>
    <td>${(m.fecha||'').slice(0,10)}</td>
    <td><span class="badge" style="background:${m.tipo==='Fijo'?'#2E8FC022':'#D8854A22'};color:${m.tipo==='Fijo'?'#2E8FC0':'#D8854A'}">${m.tipo}</span></td>
    <td>${conceptoNombre(m.concepto_id)}</td>
    <td>${m.proveedor || '—'}</td>
    <td>${m.orden != null ? m.orden + (m.suborden != null ? '-' + m.suborden : '') : '—'}</td>
    <td class="num">${fmtCOP(m.valor)}</td>
    <td>${editable ? `<div class="row-actions">
      <button type="button" class="row-btn" data-edit-mov="${m.id}">Editar</button>
      <button type="button" class="row-btn row-btn-danger" data-del-mov="${m.id}">Eliminar</button>
    </div>` : ''}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--ink-faint)">Sin movimientos todavía</td></tr>';

  tbody.querySelectorAll('[data-edit-mov]').forEach(b => b.addEventListener('click', () => {
    const m = DB.costos_movimientos.find(x => x.id === parseInt(b.dataset.editMov, 10));
    if(!m) return;
    editingMovimientoId = m.id;
    document.getElementById('rc-fecha').value = (m.fecha||'').slice(0,10);
    document.getElementById('rc-concepto').value = m.concepto_id;
    document.getElementById('rc-valor').value = m.valor;
    document.getElementById('rc-proveedor').value = m.proveedor || '';
    document.getElementById('rc-orden').value = m.orden || '';
    document.getElementById('rc-suborden').value = m.suborden || '';
    document.getElementById('rc-comentario').value = m.comentario || '';
    document.getElementById('rc-save').textContent = 'Guardar cambios';
    window.scrollTo({ top: document.getElementById('rc-fecha').getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
  }));
  tbody.querySelectorAll('[data-del-mov]').forEach(b => b.addEventListener('click', async () => {
    const m = DB.costos_movimientos.find(x => x.id === parseInt(b.dataset.delMov, 10));
    if(!m) return;
    if(!confirm(`¿Eliminar este costo de ${fmtCOP(m.valor)} (${m.comentario||conceptoNombre(m.concepto_id)})? No se puede deshacer.`)) return;
    const { error } = await sb.from('costos_movimientos').delete().eq('id', m.id);
    if(error){ console.error(error); toast('No se pudo eliminar — revisa la consola'); return; }
    const idx = DB.costos_movimientos.findIndex(x => x.id === m.id);
    if(idx>=0) DB.costos_movimientos.splice(idx,1);
    if(editingMovimientoId === m.id) resetFormMovimiento();
    renderMovimientosRecientes();
    renderResumenCostosMes();
    renderInformeCostos();
    toast('Costo eliminado');
  }));
}

function resetFormMovimiento(){
  editingMovimientoId = null;
  document.getElementById('rc-valor').value = '';
  document.getElementById('rc-proveedor').value = '';
  document.getElementById('rc-comentario').value = '';
  document.getElementById('rc-orden').value = '';
  document.getElementById('rc-suborden').value = '';
  document.getElementById('rc-save').textContent = 'Guardar costo';
}

export function renderResumenCostosMes(){
  const cont = document.getElementById('rc-resumen-mes');
  if(!cont) return;
  const hoy = new Date();
  const mesActual = hoy.toISOString().slice(0,7);
  const delMes = DB.costos_movimientos.filter(m => (m.fecha||'').slice(0,7) === mesActual);
  const fijo = delMes.filter(m=>m.tipo==='Fijo').reduce((s,m)=>s+(m.valor||0),0);
  const variable = delMes.filter(m=>m.tipo==='Variable').reduce((s,m)=>s+(m.valor||0),0);
  cont.innerHTML = `
    <div class="kpi"><div class="lbl">Costos fijos · este mes</div><div class="val">${fmtCOP(fijo)}</div></div>
    <div class="kpi"><div class="lbl">Costos variables · este mes</div><div class="val">${fmtCOP(variable)}</div></div>
    <div class="kpi"><div class="lbl">Total registrado · este mes</div><div class="val">${fmtCOP(fijo+variable)}</div></div>`;
}

// ---------- Informe de costos (por rango, agrupado por categoría) ----------
let ultimoInformeCostos = null;

export function renderInformeCostos(){
  const kpisEl = document.getElementById('rc-inf-kpis');
  if(!kpisEl) return;
  const desde = document.getElementById('rc-inf-desde').value || '2024-01-01';
  const hasta = document.getElementById('rc-inf-hasta').value || fechaHoyLocal();
  const conceptoPorId = new Map(DB.costos_conceptos.map(c => [c.id, c]));
  const filas = DB.costos_movimientos.filter(m => (m.fecha||'') >= desde && (m.fecha||'') <= hasta);

  const fijo = filas.filter(m=>m.tipo==='Fijo').reduce((s,m)=>s+(m.valor||0),0);
  const variable = filas.filter(m=>m.tipo==='Variable').reduce((s,m)=>s+(m.valor||0),0);
  kpisEl.innerHTML = `
    <div class="kpi"><div class="lbl">Costos fijos</div><div class="val">${fmtCOP(fijo)}</div><div class="sub">${desde} a ${hasta}</div></div>
    <div class="kpi"><div class="lbl">Costos variables</div><div class="val">${fmtCOP(variable)}</div></div>
    <div class="kpi"><div class="lbl">Total</div><div class="val">${fmtCOP(fijo+variable)}</div></div>
    <div class="kpi"><div class="lbl">Movimientos</div><div class="val">${filas.length}</div></div>`;

  const porCategoria = {};
  filas.forEach(m => {
    const cat = (conceptoPorId.get(m.concepto_id)?.categoria) || m.comentario?.split(' — ')[0] || 'Sin categoría';
    const key = cat + '|' + m.tipo;
    porCategoria[key] = porCategoria[key] || { categoria: cat, tipo: m.tipo, n: 0, total: 0 };
    porCategoria[key].n++;
    porCategoria[key].total += (m.valor || 0);
  });
  const filasCategoria = Object.values(porCategoria).sort((a,b) => b.total - a.total);

  document.querySelector('#tbl-rc-inf-categoria tbody').innerHTML = filasCategoria.map(f => `<tr>
    <td>${f.categoria}</td><td>${f.tipo}</td><td class="num">${f.n}</td><td class="num">${fmtCOP(f.total)}</td>
  </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-faint)">Sin costos en este rango</td></tr>';

  ultimoInformeCostos = { desde, hasta, fijo, variable, movimientos: filas.length, filasCategoria };
}

function imprimirInformeCostos(){
  if(!ultimoInformeCostos) return;
  const k = ultimoInformeCostos;
  imprimirInforme({
    titulo: 'Informe de costos',
    subtitulo: `${k.desde} a ${k.hasta} · Fijos ${fmtCOP(k.fijo)} · Variables ${fmtCOP(k.variable)} · Total ${fmtCOP(k.fijo+k.variable)} · ${k.movimientos} movimiento(s)`,
    secciones: [{
      titulo: 'Por categoría',
      columnas: [{ key:'categoria', label:'Categoría' }, { key:'tipo', label:'Tipo' }, { key:'n', label:'Movimientos', num:true }, { key:'total', label:'Total', num:true }],
      filas: k.filasCategoria.map(f => ({ categoria:f.categoria, tipo:f.tipo, n:f.n, total:fmtCOP(f.total) }))
    }]
  });
}

function exportarInformeCostos(){
  if(!ultimoInformeCostos) return;
  const k = ultimoInformeCostos;
  exportarExcel(`LitoColor_costos_${k.desde}_a_${k.hasta}.xlsx`, [{
    nombre: 'Por categoría',
    filas: k.filasCategoria.map(f => ({ Categoría: f.categoria, Tipo: f.tipo, Movimientos: f.n, Total: f.total }))
  }]);
}

async function guardarMovimiento(){
  const fecha = document.getElementById('rc-fecha').value;
  const conceptoId = parseInt(document.getElementById('rc-concepto').value, 10);
  const valor = parseFloat(document.getElementById('rc-valor').value);
  const proveedorTexto = document.getElementById('rc-proveedor').value.trim();
  const comentario = document.getElementById('rc-comentario').value.trim() || null;
  const orden = parseInt(document.getElementById('rc-orden').value, 10) || null;
  const suborden = orden ? (parseInt(document.getElementById('rc-suborden').value, 10) || null) : null;
  if(!fecha || !conceptoId || !valor){ toast('Falta fecha, concepto o valor'); return; }

  const concepto = DB.costos_conceptos.find(c => c.id === conceptoId);
  const btn = document.getElementById('rc-save');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try{
    let proveedor = null;
    if(proveedorTexto){
      const existente = DB.proveedores.find(p => p.nombre.toLowerCase() === proveedorTexto.toLowerCase());
      if(existente){
        proveedor = existente.nombre;
      } else {
        const { data: nuevoProv, error: errProv } = await sb.from('proveedores').insert([{ nombre: proveedorTexto, activo: true }]).select();
        if(errProv) throw errProv;
        DB.proveedores.push(nuevoProv[0]);
        poblarDatalistProveedores();
        proveedor = nuevoProv[0].nombre;
        toast('Proveedor nuevo creado: ' + proveedor);
      }
    }

    const row = { concepto_id: conceptoId, tipo: concepto.tipo, fecha, valor, proveedor, comentario, orden, suborden };
    if(editingMovimientoId){
      const { data, error } = await sb.from('costos_movimientos').update(row).eq('id', editingMovimientoId).select();
      if(error) throw error;
      const idx = DB.costos_movimientos.findIndex(m => m.id === editingMovimientoId);
      if(idx>=0) DB.costos_movimientos[idx] = data[0];
      toast('Costo actualizado');
    } else {
      const { data, error } = await sb.from('costos_movimientos').insert([row]).select();
      if(error) throw error;
      DB.costos_movimientos.unshift(data[0]);
      toast('Costo registrado');
    }
    resetFormMovimiento();
    renderMovimientosRecientes();
    renderResumenCostosMes();
    renderInformeCostos();
  }catch(err){
    console.error(err);
    toast('Error al guardar — revisa la consola');
  }finally{
    btn.disabled = false; btn.textContent = 'Guardar costo';
  }
}

// ---------- consumos que quedaron sin costo (ver registrar.js) ----------
let candidatosSinCostear = [];

function renderConsumosSinCostear(candidatos){
  const tbody = document.querySelector('#tbl-consumos-sin-costo tbody');
  const hint = document.getElementById('csc-hint');
  if(!tbody) return;
  candidatosSinCostear = candidatos;
  const btnAplicar = document.getElementById('csc-aplicar');
  if(btnAplicar) btnAplicar.disabled = !candidatos.length;
  tbody.innerHTML = candidatos.map(c => `<tr>
    <td>${(c.registro.fecha||'').slice(0,10) || '—'}</td>
    <td>${c.registro.orden != null ? c.registro.orden + (c.registro.suborden ? '-' + c.registro.suborden : '') : '—'}</td>
    <td>${c.registro.materiaPrima}</td>
    <td class="num">${fmtNum(c.cantidad,2)}</td>
    <td class="num">${fmtCOP(c.mat.costo_unitario)}</td>
    <td class="num">${fmtCOP(c.cantidad * c.mat.costo_unitario)}</td>
  </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Sin pendientes — todo lo que tiene costo configurado ya está costeado</td></tr>';
  hint.textContent = candidatos.length
    ? `${candidatos.length} consumo(s) ya se pueden costear`
    : 'Sin consumos pendientes por costear en este momento';
}

function buscarYMostrarConsumosSinCostear(){
  renderConsumosSinCostear(buscarConsumosSinCostear());
}

async function aplicarConsumosSinCostear(){
  if(!candidatosSinCostear.length) return;
  const btn = document.getElementById('csc-aplicar');
  const seguro = confirm(`Se van a crear ${candidatosSinCostear.length} movimiento(s) de costo por consumos que ya estaban registrados (el stock no se toca, ya estaba descontado desde que se guardó cada uno).\n\n¿Continuar?`);
  if(!seguro) return;
  btn.disabled = true; btn.textContent = 'Aplicando…';
  const { creados, errores } = await aplicarCosteoConsumosPendientes(candidatosSinCostear);
  toast(`Se costearon ${creados} consumo(s)` + (errores.length ? ` · ${errores.length} con error, revisa la consola` : ''));
  renderMovimientosRecientes();
  renderResumenCostosMes();
  renderInformeCostos();
  buscarYMostrarConsumosSinCostear();
  btn.textContent = 'Aplicar costeo';
}

export function initCostos(){
  document.getElementById('cc-save').addEventListener('click', guardarConcepto);
  renderConceptos();

  document.getElementById('rc-fecha').value = fechaHoyLocal();
  poblarSelectConcepto();
  poblarSelectOrdenCosto();
  poblarDatalistProveedores();
  document.getElementById('rc-save').addEventListener('click', guardarMovimiento);
  renderMovimientosRecientes();
  renderResumenCostosMes();

  document.getElementById('csc-buscar').addEventListener('click', buscarYMostrarConsumosSinCostear);
  document.getElementById('csc-aplicar').addEventListener('click', aplicarConsumosSinCostear);
  buscarYMostrarConsumosSinCostear();

  document.getElementById('rc-inf-desde').addEventListener('change', renderInformeCostos);
  document.getElementById('rc-inf-hasta').addEventListener('change', renderInformeCostos);
  document.getElementById('rc-inf-imprimir').addEventListener('click', imprimirInformeCostos);
  document.getElementById('rc-inf-exportar').addEventListener('click', exportarInformeCostos);
  renderInformeCostos();
}
