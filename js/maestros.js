import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast } from './helpers.js';

function fmtCOP(n){ if(n==null||isNaN(n)) return '—'; return '$' + Math.round(n).toLocaleString('es-CO'); }

// Cada catálogo se maneja con el mismo patrón: una lista en memoria (DB.x),
// un formulario de alta que se convierte en "editar" cuando hay un registro
// seleccionado, y un botón "Retirar" que solo desactiva (activo=false),
// nunca borra — porque ya puede tener historial ligado.

function wireCatalog(opts){
  let editingId = null;

  function resetForm(){
    editingId = null;
    opts.fields.forEach(f => { const el = document.getElementById(f.id); if(el) el.value = ''; });
    document.getElementById(opts.saveBtnId).textContent = opts.addLabel;
    document.getElementById(opts.modeId).textContent = '';
  }

  function startEdit(row){
    editingId = row[opts.key];
    opts.fields.forEach(f => {
      const el = document.getElementById(f.id);
      if(el) el.value = row[f.col] ?? '';
    });
    document.getElementById(opts.saveBtnId).textContent = 'Guardar cambios';
    document.getElementById(opts.modeId).textContent = 'Editando — los campos de arriba se sobrescriben al guardar';
  }

  async function save(){
    const payload = {};
    let faltaObligatorio = false;
    opts.fields.forEach(f => {
      const el = document.getElementById(f.id);
      let v = el.value.trim ? el.value.trim() : el.value;
      if(f.type === 'number') v = v === '' ? null : parseFloat(v);
      if(f.required && !v) faltaObligatorio = true;
      payload[f.col] = v === '' ? null : v;
    });
    if(faltaObligatorio){ toast('Falta un campo obligatorio'); return; }
    if(!editingId) payload.activo = true;

    const btn = document.getElementById(opts.saveBtnId);
    btn.disabled = true;
    try{
      if(editingId != null){
        const { data, error } = await sb.from(opts.table).update(payload).eq(opts.key, editingId).select();
        if(error) throw error;
        const idx = opts.data.findIndex(r => r[opts.key] === editingId);
        if(idx >= 0) opts.data[idx] = data[0];
        toast('Actualizado');
      } else {
        const { data, error } = await sb.from(opts.table).insert([payload]).select();
        if(error) throw error;
        opts.data.push(data[0]);
        toast('Agregado');
      }
      resetForm();
      render();
      if(opts.onChange) opts.onChange();
    }catch(err){
      console.error(err);
      toast('Error al guardar — revisa la consola');
    }finally{
      btn.disabled = false;
    }
  }

  async function toggleActivo(row){
    const nuevoEstado = !(row.activo !== false);
    const accion = nuevoEstado ? 'reactivar' : 'retirar';
    if(!confirm(`¿Seguro que quieres ${accion} "${row[opts.fields[0].col]}"? Su historial no se pierde.`)) return;
    const { data, error } = await sb.from(opts.table).update({ activo: nuevoEstado }).eq(opts.key, row[opts.key]).select();
    if(error){ console.error(error); toast('No se pudo actualizar'); return; }
    const idx = opts.data.findIndex(r => r[opts.key] === row[opts.key]);
    if(idx >= 0) opts.data[idx] = data[0];
    toast(nuevoEstado ? 'Reactivado' : 'Retirado');
    render();
    if(opts.onChange) opts.onChange();
  }

  function render(){
    const tbody = document.querySelector(opts.tableSel + ' tbody');
    if(!tbody) return;
    tbody.innerHTML = opts.data.map(row => {
      const inactivo = row.activo === false;
      const cells = opts.renderCols(row).map(c => `<td>${c}</td>`).join('');
      const rowId = row[opts.key];
      return `<tr style="${inactivo?'opacity:.5':''}">
        ${cells}
        <td><div class="row-actions">
          <button type="button" class="row-btn" data-edit="${rowId}">Editar</button>
          <button type="button" class="row-btn ${inactivo?'':'row-btn-danger'}" data-toggle="${rowId}">${inactivo?'Reactivar':'Retirar'}</button>
        </div></td>
      </tr>`;
    }).join('') || `<tr><td colspan="${opts.fields.length+2}" style="text-align:center;color:var(--ink-faint)">Sin registros</td></tr>`;

    tbody.querySelectorAll('[data-edit]').forEach(b => {
      b.addEventListener('click', () => {
        const row = opts.data.find(r => String(r[opts.key]) === b.dataset.edit);
        if(row) startEdit(row);
      });
    });
    tbody.querySelectorAll('[data-toggle]').forEach(b => {
      b.addEventListener('click', () => {
        const row = opts.data.find(r => String(r[opts.key]) === b.dataset.toggle);
        if(row) toggleActivo(row);
      });
    });
  }

  document.getElementById(opts.saveBtnId).addEventListener('click', save);
  render();
  return { render, resetForm };
}

export function renderMaestros(){
  empleadosCtl.render();
  maquinasCtl.render();
  materiasCtl.render();
  insumosCtl.render();
  clientesCtl.render();
  proveedoresCtl.render();
  productosCtl.render();
  piezasProductoCtl.render();
  poblarDatalistProductosMaestro();
}

// Sugerencias de producto para el maestro "Piezas por producto" — toma los
// nombres ya existentes en el catálogo de Productos.
function poblarDatalistProductosMaestro(){
  const dl = document.getElementById('m-pp-producto-list');
  if(!dl) return;
  dl.innerHTML = DB.productos.filter(p=>p.activo!==false).map(p => `<option value="${p.nombre}">`).join('');
}

let empleadosCtl, maquinasCtl, materiasCtl, insumosCtl, clientesCtl, proveedoresCtl, productosCtl, piezasProductoCtl;

export function initMaestros(onChange){
  empleadosCtl = wireCatalog({
    table: 'personal', key: 'id', data: DB.personal, tableSel: '#tbl-m-empleados',
    saveBtnId: 'm-emp-save', modeId: 'm-emp-mode', addLabel: 'Agregar empleado',
    fields: [
      { id:'m-emp-nombre', col:'nombre', required:true },
      { id:'m-emp-cargo', col:'cargo' },
      { id:'m-emp-valor', col:'valor_hora', type:'number' }
    ],
    renderCols: r => [r.nombre, r.cargo||'—', r.valor_hora!=null?fmtCOP(r.valor_hora):'—'],
    onChange
  });

  maquinasCtl = wireCatalog({
    table: 'maquinas', key: 'id', data: DB.maquinas, tableSel: '#tbl-m-maquinas',
    saveBtnId: 'm-maq-save', modeId: 'm-maq-mode', addLabel: 'Agregar máquina',
    fields: [
      { id:'m-maq-codigo', col:'codigo' },
      { id:'m-maq-nombre', col:'nombre', required:true },
      { id:'m-maq-area', col:'area' }
    ],
    renderCols: r => [r.codigo||'—', r.nombre, r.area||'—'],
    onChange
  });

  materiasCtl = wireCatalog({
    table: 'materias_primas', key: 'codigo', data: DB.materias_primas, tableSel: '#tbl-m-materias',
    saveBtnId: 'm-mp-save', modeId: 'm-mp-mode', addLabel: 'Agregar materia prima',
    fields: [
      { id:'m-mp-codigo', col:'codigo', required:true },
      { id:'m-mp-nombre', col:'nombre', required:true },
      { id:'m-mp-categoria', col:'categoria' },
      { id:'m-mp-ancho', col:'pliego_ancho', type:'number' },
      { id:'m-mp-alto', col:'pliego_alto', type:'number' }
    ],
    renderCols: r => [r.codigo, r.nombre, r.categoria||'—', r.pliego_ancho?r.pliego_ancho+'x'+r.pliego_alto:'—'],
    onChange
  });

  insumosCtl = wireCatalog({
    table: 'insumos_area', key: 'id', data: DB.insumos_area, tableSel: '#tbl-m-insumos',
    saveBtnId: 'm-ins-save', modeId: 'm-ins-mode', addLabel: 'Agregar insumo',
    fields: [
      { id:'m-ins-nombre', col:'nombre', required:true },
      { id:'m-ins-area', col:'area', required:true },
      { id:'m-ins-unidad', col:'unidad' }
    ],
    renderCols: r => [r.nombre, r.area, r.unidad||'—'],
    onChange
  });

  clientesCtl = wireCatalog({
    table: 'clientes', key: 'id', data: DB.clientes, tableSel: '#tbl-m-clientes',
    saveBtnId: 'm-cli-save', modeId: 'm-cli-mode', addLabel: 'Agregar cliente',
    fields: [
      { id:'m-cli-nombre', col:'nombre', required:true },
      { id:'m-cli-nit', col:'nit' },
      { id:'m-cli-tel', col:'telefono' },
      { id:'m-cli-email', col:'email' },
      { id:'m-cli-dir', col:'direccion' },
      { id:'m-cli-ciudad', col:'ciudad' }
    ],
    renderCols: r => [r.nombre, r.nit||'—', r.telefono||'—', r.ciudad||'—'],
    onChange
  });

  proveedoresCtl = wireCatalog({
    table: 'proveedores', key: 'id', data: DB.proveedores, tableSel: '#tbl-m-proveedores',
    saveBtnId: 'm-prov-save', modeId: 'm-prov-mode', addLabel: 'Agregar proveedor',
    fields: [
      { id:'m-prov-nombre', col:'nombre', required:true },
      { id:'m-prov-tipo', col:'tipo_proveedor' },
      { id:'m-prov-nit', col:'nit' },
      { id:'m-prov-tel', col:'telefono' },
      { id:'m-prov-email', col:'email' },
      { id:'m-prov-materiales', col:'materiales' },
      { id:'m-prov-ciudad', col:'ciudad' }
    ],
    renderCols: r => [r.nombre, r.tipo_proveedor||'—', r.materiales||'—', r.telefono||'—', r.ciudad||'—'],
    onChange
  });

  productosCtl = wireCatalog({
    table: 'productos', key: 'id', data: DB.productos, tableSel: '#tbl-m-productos',
    saveBtnId: 'm-prod-save', modeId: 'm-prod-mode', addLabel: 'Agregar producto',
    fields: [
      { id:'m-prod-nombre', col:'nombre', required:true },
      { id:'m-prod-desc', col:'descripcion' }
    ],
    renderCols: r => [r.nombre, r.descripcion||'—'],
    onChange
  });

  piezasProductoCtl = wireCatalog({
    table: 'piezas_producto', key: 'id', data: DB.piezas_producto, tableSel: '#tbl-m-piezas-producto',
    saveBtnId: 'm-pp-save', modeId: 'm-pp-mode', addLabel: 'Agregar pieza',
    fields: [
      { id:'m-pp-producto', col:'producto', required:true },
      { id:'m-pp-pieza', col:'pieza', required:true }
    ],
    renderCols: r => [r.producto, r.pieza],
    onChange
  });

  poblarDatalistProductosMaestro();
}
