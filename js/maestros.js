import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast, fmtNum } from './helpers.js';
import { listaAreasDisponibles } from './registrar.js';

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
      if(opts.onChange) opts.onChange(data[0]);
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
  areasCtl.render();
  maquinasCtl.render();
  actividadesCtl.render();
  motivosPausaCtl.render();
  subprocesosCtl.render();
  categoriasMateriaPrimaCtl.render();
  materiasCtl.render();
  insumosCtl.render();
  clientesCtl.render();
  proveedoresCtl.render();
  productosCtl.render();
  piezasProductoCtl.render();
  poblarDatalistProductosMaestro();
  poblarDatalistProcesosMaestro();
  poblarSelectCategoriaMateriaPrima();
  poblarSelectMaterialAreas();
}

// ---------- materias primas: categoría (select) y áreas que la consumen ----------
// Categoría: antes era una lista fija de <option> en el HTML; ahora sale
// del maestro "Categorías de materia prima" (solo las activas).
function poblarSelectCategoriaMateriaPrima(){
  const sel = document.getElementById('m-mp-categoria');
  if(!sel) return;
  const valorPrevio = sel.value;
  sel.innerHTML = DB.categorias_materia_prima.filter(c=>c.activo!==false).map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('');
  if(Array.from(sel.options).some(o=>o.value===valorPrevio)) sel.value = valorPrevio;
}

// Áreas que consumen: relación N:M aparte (materias_primas_areas) — una
// materia prima SÍ puede ser consumida por varias áreas, a diferencia de
// la categoría. Es un widget separado del catálogo genérico porque no es
// "agregar una fila", es "marcar/desmarcar áreas para la fila elegida".
function poblarSelectMaterialAreas(){
  const sel = document.getElementById('m-mpa-material');
  if(!sel) return;
  const valorPrevio = sel.value;
  sel.innerHTML = DB.materias_primas.map(m => `<option value="${m.codigo}">${m.codigo} — ${m.nombre}</option>`).join('');
  if(Array.from(sel.options).some(o=>o.value===valorPrevio)) sel.value = valorPrevio;
  poblarChecksAreasMaterial();
}

function poblarChecksAreasMaterial(){
  const cont = document.getElementById('m-mpa-checks');
  const sel = document.getElementById('m-mpa-material');
  if(!cont || !sel) return;
  const codigo = sel.value;
  const actuales = new Set(DB.materias_primas_areas.filter(x => x.materia_prima_codigo === codigo).map(x => x.area));
  cont.innerHTML = listaAreasDisponibles().map(a =>
    `<label><input type="checkbox" value="${a}"${actuales.has(a)?' checked':''}> ${a}</label>`
  ).join('') || '<span class="card-hint">no hay áreas cargadas todavía (Máquinas/Actividades)</span>';
  document.getElementById('m-mpa-hint').textContent = '';
}

// Cuando se repone stock de una materia prima (agregarla/editarla acá con
// un stock_actual más alto), revisa si alguna orden estaba esperando ese
// material (ver alertarStockPapelInsuficiente en js/ordenes.js) y, si el
// nuevo stock ya la cubre, la marca resuelta — deja de salir en Alertas.
async function resolverAlertasFaltanteMateriaPrima(row){
  if(!row || row.stock_actual == null) return;
  const pendientes = DB.alertas_faltante_material.filter(a => a.materia_prima_codigo === row.codigo && a.cantidad_faltante <= row.stock_actual);
  if(!pendientes.length) return;
  try{
    const { error } = await sb.from('alertas_faltante_material')
      .update({ resuelta: true, resuelta_en: new Date().toISOString() })
      .in('id', pendientes.map(a => a.id));
    if(error) throw error;
    const ordenes = [...new Set(pendientes.map(a => a.orden))];
    pendientes.forEach(a => {
      const idx = DB.alertas_faltante_material.indexOf(a);
      if(idx >= 0) DB.alertas_faltante_material.splice(idx, 1);
    });
    toast(`Stock repuesto — ya no falta ${row.nombre} para la(s) orden(es) ${ordenes.join(', ')}`);
  }catch(err){
    console.error('No se pudo resolver la alerta de faltante:', err);
  }
}

async function guardarAreasMaterial(){
  const sel = document.getElementById('m-mpa-material');
  const codigo = sel.value;
  if(!codigo){ toast('Elige una materia prima primero'); return; }
  const marcadas = new Set(Array.from(document.querySelectorAll('#m-mpa-checks input:checked')).map(c => c.value));
  const actuales = new Set(DB.materias_primas_areas.filter(x => x.materia_prima_codigo === codigo).map(x => x.area));
  const aAgregar = [...marcadas].filter(a => !actuales.has(a));
  const aQuitar = DB.materias_primas_areas.filter(x => x.materia_prima_codigo === codigo && !marcadas.has(x.area));

  const btn = document.getElementById('m-mpa-save');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try{
    if(aAgregar.length){
      const { data, error } = await sb.from('materias_primas_areas')
        .insert(aAgregar.map(area => ({ materia_prima_codigo: codigo, area }))).select();
      if(error) throw error;
      DB.materias_primas_areas.push(...data);
    }
    if(aQuitar.length){
      const { error } = await sb.from('materias_primas_areas').delete().in('id', aQuitar.map(x => x.id));
      if(error) throw error;
      aQuitar.forEach(x => {
        const idx = DB.materias_primas_areas.findIndex(y => y.id === x.id);
        if(idx >= 0) DB.materias_primas_areas.splice(idx, 1);
      });
    }
    toast('Áreas actualizadas');
    document.getElementById('m-mpa-hint').textContent = 'guardado ✓';
    materiasCtl.render();
  }catch(err){
    console.error(err);
    toast('No se pudo guardar — revisa la consola');
  }finally{
    btn.disabled = false; btn.textContent = 'Guardar áreas';
  }
}

// Sugerencias de "Proceso" para el maestro "Subprocesos" — las áreas que ya
// se usan en Máquinas/Actividades, para no crear un área nueva por un
// error de tipeo (tiene que calzar exacto con procesos_requeridos).
function poblarDatalistProcesosMaestro(){
  const dl = document.getElementById('m-sub-proceso-list');
  if(!dl) return;
  dl.innerHTML = listaAreasDisponibles().map(a => `<option value="${a}">`).join('');
}

// Sugerencias de producto para el maestro "Piezas por producto" — toma los
// nombres ya existentes en el catálogo de Productos.
function poblarDatalistProductosMaestro(){
  const dl = document.getElementById('m-pp-producto-list');
  if(!dl) return;
  dl.innerHTML = DB.productos.filter(p=>p.activo!==false).map(p => `<option value="${p.nombre}">`).join('');
}

let empleadosCtl, maquinasCtl, areasCtl, actividadesCtl, motivosPausaCtl, subprocesosCtl, categoriasMateriaPrimaCtl, materiasCtl, insumosCtl, clientesCtl, proveedoresCtl, productosCtl, piezasProductoCtl;

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

  // Fuente de verdad de qué es un "área" en todo el sistema — máquinas,
  // actividades, insumos, subprocesos, materias primas y el checklist de
  // procesos al crear una orden usan estos mismos nombres. El campo
  // "Orden" es la secuencia por defecto (Diseño antes que Terminado, etc.)
  // — ver "Procesos que requiere esta pieza" en Órdenes.
  areasCtl = wireCatalog({
    table: 'areas', key: 'id', data: DB.areas, tableSel: '#tbl-m-areas',
    saveBtnId: 'm-area-save', modeId: 'm-area-mode', addLabel: 'Agregar área',
    fields: [
      { id:'m-area-nombre', col:'nombre', required:true },
      { id:'m-area-orden', col:'orden', type:'number' }
    ],
    renderCols: r => [r.nombre, r.orden ?? '—'],
    onChange: () => { if(onChange) onChange(); poblarDatalistProcesosMaestro(); }
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

  actividadesCtl = wireCatalog({
    table: 'actividades', key: 'id', data: DB.actividades, tableSel: '#tbl-m-actividades',
    saveBtnId: 'm-act-save', modeId: 'm-act-mode', addLabel: 'Agregar actividad',
    fields: [
      { id:'m-act-codigo', col:'codigo', type:'number' },
      { id:'m-act-etiqueta', col:'etiqueta', required:true },
      { id:'m-act-area', col:'area', required:true },
      { id:'m-act-categoria', col:'categoria' },
      { id:'m-act-actividad', col:'actividad' }
    ],
    renderCols: r => [r.codigo ?? '—', r.etiqueta || '—', r.area || '—', r.categoria || '—'],
    onChange
  });

  motivosPausaCtl = wireCatalog({
    table: 'motivos_pausa', key: 'id', data: DB.motivos_pausa, tableSel: '#tbl-m-motivos-pausa',
    saveBtnId: 'm-mot-save', modeId: 'm-mot-mode', addLabel: 'Agregar motivo',
    fields: [
      { id:'m-mot-nombre', col:'nombre', required:true }
    ],
    renderCols: r => [r.nombre],
    onChange
  });

  subprocesosCtl = wireCatalog({
    table: 'subprocesos', key: 'id', data: DB.subprocesos, tableSel: '#tbl-m-subprocesos',
    saveBtnId: 'm-sub-save', modeId: 'm-sub-mode', addLabel: 'Agregar subproceso',
    fields: [
      { id:'m-sub-proceso', col:'proceso', required:true },
      { id:'m-sub-nombre', col:'nombre', required:true },
      { id:'m-sub-orden', col:'orden', type:'number' }
    ],
    renderCols: r => [r.proceso, r.orden ?? '—', r.nombre],
    onChange
  });

  // Una materia prima pertenece a UNA sola categoría — sigue siendo el
  // campo de texto materias_primas.categoria de siempre, pero ahora el
  // <select> se llena desde este maestro en vez de una lista fija en el
  // HTML (ver poblarSelectCategoriaMateriaPrima).
  categoriasMateriaPrimaCtl = wireCatalog({
    table: 'categorias_materia_prima', key: 'id', data: DB.categorias_materia_prima, tableSel: '#tbl-m-cat-materia',
    saveBtnId: 'm-catmp-save', modeId: 'm-catmp-mode', addLabel: 'Agregar categoría',
    fields: [
      { id:'m-catmp-nombre', col:'nombre', required:true }
    ],
    renderCols: r => [r.nombre],
    onChange: () => { if(onChange) onChange(); poblarSelectCategoriaMateriaPrima(); }
  });

  materiasCtl = wireCatalog({
    table: 'materias_primas', key: 'codigo', data: DB.materias_primas, tableSel: '#tbl-m-materias',
    saveBtnId: 'm-mp-save', modeId: 'm-mp-mode', addLabel: 'Agregar materia prima',
    fields: [
      { id:'m-mp-codigo', col:'codigo', required:true },
      { id:'m-mp-nombre', col:'nombre', required:true },
      { id:'m-mp-categoria', col:'categoria' },
      { id:'m-mp-ancho', col:'pliego_ancho', type:'number' },
      { id:'m-mp-alto', col:'pliego_alto', type:'number' },
      { id:'m-mp-unidad', col:'unidad' },
      { id:'m-mp-stock', col:'stock_actual', type:'number' },
      { id:'m-mp-minimo', col:'stock_minimo', type:'number' },
      { id:'m-mp-costo', col:'costo_unitario', type:'number' }
    ],
    renderCols: r => {
      const bajo = (r.stock_minimo||0) > 0 && (r.stock_actual||0) < r.stock_minimo;
      // Una materia prima SÍ puede consumirla más de un área — ver el
      // bloque "Áreas que consumen una materia prima" más abajo.
      const areas = DB.materias_primas_areas.filter(x => x.materia_prima_codigo === r.codigo).map(x => x.area);
      return [r.codigo, r.nombre, r.categoria||'—', r.pliego_ancho?r.pliego_ancho+'x'+r.pliego_alto:'—',
        `<span style="${bajo?'color:var(--bad);font-weight:600':''}">${fmtNum(r.stock_actual)} ${r.unidad||'pliegos'}</span>${bajo?' ⚠':''}`,
        r.costo_unitario!=null?fmtCOP(r.costo_unitario):'—',
        areas.length ? areas.join(', ') : '<span class="card-hint">ninguna configurada</span>'];
    },
    onChange: (row) => { if(onChange) onChange(); poblarSelectMaterialAreas(); resolverAlertasFaltanteMateriaPrima(row); }
  });

  insumosCtl = wireCatalog({
    table: 'insumos_area', key: 'id', data: DB.insumos_area, tableSel: '#tbl-m-insumos',
    saveBtnId: 'm-ins-save', modeId: 'm-ins-mode', addLabel: 'Agregar insumo',
    fields: [
      { id:'m-ins-nombre', col:'nombre', required:true },
      { id:'m-ins-area', col:'area', required:true },
      { id:'m-ins-unidad', col:'unidad' },
      { id:'m-ins-stock', col:'stock_actual', type:'number' },
      { id:'m-ins-minimo', col:'stock_minimo', type:'number' },
      { id:'m-ins-costo', col:'costo_unitario', type:'number' }
    ],
    renderCols: r => {
      const bajo = (r.stock_minimo||0) > 0 && (r.stock_actual||0) < r.stock_minimo;
      return [r.nombre, r.area, r.unidad||'—',
        `<span style="${bajo?'color:var(--bad);font-weight:600':''}">${fmtNum(r.stock_actual)}</span>${bajo?' ⚠':''}`,
        r.costo_unitario!=null?fmtCOP(r.costo_unitario):'—'];
    },
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
  poblarSelectCategoriaMateriaPrima();
  poblarSelectMaterialAreas();

  const selMaterial = document.getElementById('m-mpa-material');
  if(selMaterial) selMaterial.addEventListener('change', poblarChecksAreasMaterial);
  const btnGuardarAreas = document.getElementById('m-mpa-save');
  if(btnGuardarAreas) btnGuardarAreas.addEventListener('click', guardarAreasMaterial);
}
