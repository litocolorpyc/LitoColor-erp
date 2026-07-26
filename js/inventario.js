// Punto 13 de AjustesERP: sección de control de inventario de materia
// prima. Es de solo lectura — para cargar/ajustar stock, costo unitario o
// mínimos se sigue editando desde Maestros > "Materias primas" o
// "Materiales por área" (donde ya existe el patrón de alta/edición), esta
// pantalla solo junta ambos catálogos en un solo tablero con alertas.
import { DB } from './store.js';
import { fmtNum, fmtCOP } from './helpers.js';

function filasInventario(){
  const filas = [];
  DB.materias_primas.filter(m => m.activo !== false).forEach(m => filas.push({
    tipo: 'Materia prima', nombre: m.nombre, grupo: m.categoria || '—', unidad: m.unidad || 'pliegos',
    stock: m.stock_actual || 0, minimo: m.stock_minimo || 0, costo: m.costo_unitario != null ? m.costo_unitario : null
  }));
  DB.insumos_area.filter(m => m.activo !== false).forEach(m => filas.push({
    tipo: 'Insumo de área', nombre: m.nombre, grupo: m.area || '—', unidad: m.unidad || 'unidad',
    stock: m.stock_actual || 0, minimo: m.stock_minimo || 0, costo: m.costo_unitario != null ? m.costo_unitario : null
  }));
  return filas;
}

export function renderInventario(){
  const tbody = document.querySelector('#tbl-inventario tbody');
  if(!tbody) return;
  const filas = filasInventario();

  // "En seguimiento" = ya se le puso un mínimo o un stock desde Maestros.
  // Sin este filtro, los 226 papeles precargados (todos en 0/0 por
  // default) saldrían de entrada como si no hubiera ni una hoja en stock.
  const enSeguimiento = filas.filter(f => f.minimo > 0 || f.stock > 0);
  const bajoMinimo = enSeguimiento.filter(f => f.minimo > 0 && f.stock < f.minimo);
  const valorTotal = enSeguimiento.reduce((s,f) => s + (f.costo ? f.costo * f.stock : 0), 0);

  const cont = document.getElementById('inv-kpis');
  if(cont){
    cont.innerHTML = `
      <div class="kpi"><div class="lbl">Materiales en seguimiento</div><div class="val">${enSeguimiento.length}</div><div class="sub">de ${filas.length} en los catálogos</div></div>
      <div class="kpi"><div class="lbl">Bajo el mínimo</div><div class="val ${bajoMinimo.length ? 'neg' : ''}">${bajoMinimo.length}</div><div class="sub">${bajoMinimo.length ? 'considera comprar' : 'todo en orden'}</div></div>
      <div class="kpi"><div class="lbl">Valor estimado en inventario</div><div class="val">${fmtCOP(valorTotal)}</div><div class="sub">stock actual × costo por unidad</div></div>`;
  }

  const ordenadas = enSeguimiento.slice().sort((a,b) => (a.stock - a.minimo) - (b.stock - b.minimo));
  tbody.innerHTML = ordenadas.map(f => {
    const bajo = f.minimo > 0 && f.stock < f.minimo;
    return `<tr style="${bajo ? 'background:var(--bg-warning,rgba(163,45,45,.06))' : ''}">
      <td>${f.tipo}</td><td>${f.nombre}</td><td>${f.grupo}</td>
      <td class="num">${fmtNum(f.stock,2)} ${f.unidad}</td>
      <td class="num">${fmtNum(f.minimo,2)}</td>
      <td class="num">${f.costo != null ? fmtCOP(f.costo) : '—'}</td>
      <td>${bajo ? '<span class="estado-chip pending">⚠ Bajo mínimo</span>' : '<span class="estado-chip done">✓ OK</span>'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--ink-faint)">Todavía no configuraste stock ni mínimo para ningún material — hazlo desde "Materias primas" o "Materiales por área"</td></tr>';
}

export function initInventario(){
  renderInventario();
}
