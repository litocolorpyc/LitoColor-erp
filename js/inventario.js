// Punto 13 de AjustesERP: sección de control de inventario de materia
// prima. Es de solo lectura — para cargar/ajustar stock, costo unitario o
// mínimos se sigue editando desde Maestros > "Materias primas" o
// "Materiales por área" (donde ya existe el patrón de alta/edición), esta
// pantalla solo junta ambos catálogos en un solo tablero con alertas.
import { DB } from './store.js';
import { fmtNum, fmtCOP } from './helpers.js';
import { mostrarDetalleOrden } from './ordenes.js';

// Pedido: "cuando se hace el ingreso de material, desde el inventario se
// debe revisar qué órdenes están esperando dicho material" — se cruza
// contra alertas_faltante_material (ver js/ordenes.js, saveOpp), que
// queda viva hasta que se repone el stock (js/maestros.js, materiasCtl).
function ordenesEsperando(materiaPrimaCodigo){
  return DB.alertas_faltante_material.filter(a => a.materia_prima_codigo === materiaPrimaCodigo);
}

function filasInventario(){
  const filas = [];
  DB.materias_primas.filter(m => m.activo !== false).forEach(m => filas.push({
    tipo: 'Materia prima', nombre: m.nombre, grupo: m.categoria || '—', unidad: m.unidad || 'pliegos',
    stock: m.stock_actual || 0, minimo: m.stock_minimo || 0, costo: m.costo_unitario != null ? m.costo_unitario : null,
    esperando: ordenesEsperando(m.codigo)
  }));
  DB.insumos_area.filter(m => m.activo !== false).forEach(m => filas.push({
    tipo: 'Insumo de área', nombre: m.nombre, grupo: m.area || '—', unidad: m.unidad || 'unidad',
    stock: m.stock_actual || 0, minimo: m.stock_minimo || 0, costo: m.costo_unitario != null ? m.costo_unitario : null,
    esperando: []
  }));
  return filas;
}

export function renderInventario(){
  const tbody = document.querySelector('#tbl-inventario tbody');
  if(!tbody) return;
  const filas = filasInventario();

  // "En seguimiento" = ya se le puso un mínimo o un stock desde Maestros
  // (o hay una orden esperándolo, aunque el mínimo/stock nunca se haya
  // configurado). Sin este filtro, los 226 papeles precargados (todos en
  // 0/0 por default) saldrían de entrada como si no hubiera ni una hoja.
  const enSeguimiento = filas.filter(f => f.minimo > 0 || f.stock > 0 || f.esperando.length > 0);
  const bajoMinimo = enSeguimiento.filter(f => f.minimo > 0 && f.stock < f.minimo);
  const esperando = enSeguimiento.filter(f => f.esperando.length > 0);
  const valorTotal = enSeguimiento.reduce((s,f) => s + (f.costo ? f.costo * f.stock : 0), 0);

  const cont = document.getElementById('inv-kpis');
  if(cont){
    cont.innerHTML = `
      <div class="kpi"><div class="lbl">Materiales en seguimiento</div><div class="val">${enSeguimiento.length}</div><div class="sub">de ${filas.length} en los catálogos</div></div>
      <div class="kpi"><div class="lbl">Bajo el mínimo</div><div class="val ${bajoMinimo.length ? 'neg' : ''}">${bajoMinimo.length}</div><div class="sub">${bajoMinimo.length ? 'considera comprar' : 'todo en orden'}</div></div>
      <div class="kpi"><div class="lbl">Con órdenes esperando</div><div class="val ${esperando.length ? 'neg' : ''}">${esperando.length}</div><div class="sub">${esperando.length ? 'repón stock para liberarlas' : 'ninguna orden esperando'}</div></div>
      <div class="kpi"><div class="lbl">Valor estimado en inventario</div><div class="val">${fmtCOP(valorTotal)}</div><div class="sub">stock actual × costo por unidad</div></div>`;
  }

  // Las que tienen órdenes esperando van primero — son las más urgentes.
  const ordenadas = enSeguimiento.slice().sort((a,b) =>
    (b.esperando.length>0) - (a.esperando.length>0) || (a.stock - a.minimo) - (b.stock - b.minimo));
  tbody.innerHTML = ordenadas.map(f => {
    const bajo = f.minimo > 0 && f.stock < f.minimo;
    const esperandoHTML = f.esperando.length
      ? f.esperando.map(a => `<span class="row-btn fila-clicable" data-orden="${a.orden}" style="display:inline-block;margin:1px 3px 1px 0">Orden ${a.orden} (falta ${fmtNum(a.cantidad_faltante,0)} ${a.unidad||''})</span>`).join('')
      : '—';
    return `<tr style="${bajo ? 'background:var(--bg-warning,rgba(163,45,45,.06))' : ''}">
      <td>${f.tipo}</td><td>${f.nombre}</td><td>${f.grupo}</td>
      <td class="num">${fmtNum(f.stock,2)} ${f.unidad}</td>
      <td class="num">${fmtNum(f.minimo,2)}</td>
      <td class="num">${f.costo != null ? fmtCOP(f.costo) : '—'}</td>
      <td>${bajo ? '<span class="estado-chip pending">⚠ Bajo mínimo</span>' : '<span class="estado-chip done">✓ OK</span>'}</td>
      <td>${esperandoHTML}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--ink-faint)">Todavía no configuraste stock ni mínimo para ningún material — hazlo desde "Materias primas" o "Materiales por área"</td></tr>';

  tbody.querySelectorAll('[data-orden]').forEach(el => {
    el.addEventListener('click', () => irAOrdenYVerDetalleDesdeInventario(parseInt(el.dataset.orden, 10)));
  });
}

// Cambia a la pestaña de Órdenes y abre el detalle completo — mismo
// patrón que usa dashboard.js (irAOrdenYVerDetalle) para sus tablas.
function irAOrdenYVerDetalleDesdeInventario(orden){
  const btnTab = document.querySelector('.tab-btn[data-tab="ordenes"]');
  if(!btnTab) return;
  btnTab.click();
  setTimeout(() => mostrarDetalleOrden(orden), 50);
}

export function initInventario(){
  renderInventario();
}
