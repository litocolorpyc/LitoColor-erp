import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast, fmtCOP } from './helpers.js';

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

export function renderMovimientosRecientes(){
  const tbody = document.querySelector('#tbl-costos-recientes tbody');
  if(!tbody) return;
  const conceptoNombre = id => { const c = DB.costos_conceptos.find(x=>x.id===id); return c ? c.nombre : '—'; };
  const recientes = [...DB.costos_movimientos].sort((a,b)=> b.fecha.localeCompare(a.fecha) || b.id - a.id).slice(0,20);
  tbody.innerHTML = recientes.map(m => `<tr>
    <td>${(m.fecha||'').slice(0,10)}</td>
    <td><span class="badge" style="background:${m.tipo==='Fijo'?'#2E8FC022':'#D8854A22'};color:${m.tipo==='Fijo'?'#2E8FC0':'#D8854A'}">${m.tipo}</span></td>
    <td>${conceptoNombre(m.concepto_id)}</td>
    <td>${m.proveedor || '—'}</td>
    <td class="num">${fmtCOP(m.valor)}</td>
  </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">Sin movimientos todavía</td></tr>';
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

async function guardarMovimiento(){
  const fecha = document.getElementById('rc-fecha').value;
  const conceptoId = parseInt(document.getElementById('rc-concepto').value, 10);
  const valor = parseFloat(document.getElementById('rc-valor').value);
  const proveedorTexto = document.getElementById('rc-proveedor').value.trim();
  const comentario = document.getElementById('rc-comentario').value.trim() || null;
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

    const row = { concepto_id: conceptoId, tipo: concepto.tipo, fecha, valor, proveedor, comentario };
    const { data, error } = await sb.from('costos_movimientos').insert([row]).select();
    if(error) throw error;
    DB.costos_movimientos.unshift(data[0]);
    toast('Costo registrado');
    document.getElementById('rc-valor').value = '';
    document.getElementById('rc-proveedor').value = '';
    document.getElementById('rc-comentario').value = '';
    renderMovimientosRecientes();
    renderResumenCostosMes();
  }catch(err){
    console.error(err);
    toast('Error al guardar — revisa la consola');
  }finally{
    btn.disabled = false; btn.textContent = 'Guardar costo';
  }
}

export function initCostos(){
  document.getElementById('cc-save').addEventListener('click', guardarConcepto);
  renderConceptos();

  document.getElementById('rc-fecha').value = new Date().toISOString().slice(0,10);
  poblarSelectConcepto();
  poblarDatalistProveedores();
  document.getElementById('rc-save').addEventListener('click', guardarMovimiento);
  renderMovimientosRecientes();
  renderResumenCostosMes();
}
