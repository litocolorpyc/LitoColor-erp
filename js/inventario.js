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
    tipo: 'Materia prima', codigo: m.codigo || null, nombre: m.nombre, grupo: m.categoria || '—', unidad: m.unidad || 'pliegos',
    stock: m.stock_actual || 0, minimo: m.stock_minimo || 0, costo: m.costo_unitario != null ? m.costo_unitario : null,
    esperando: ordenesEsperando(m.codigo)
  }));
  DB.insumos_area.filter(m => m.activo !== false).forEach(m => filas.push({
    tipo: 'Insumo de área', codigo: null, nombre: m.nombre, grupo: m.area || '—', unidad: m.unidad || 'unidad',
    stock: m.stock_actual || 0, minimo: m.stock_minimo || 0, costo: m.costo_unitario != null ? m.costo_unitario : null,
    esperando: []
  }));
  return filas;
}

// Pedido: filtrar el inventario por producto (nombre) o por código. Al
// buscar, se busca en TODO el catálogo (no solo "en seguimiento") — así
// se puede encontrar un material aunque todavía no tenga stock/mínimo
// configurado, para ver o cargar sus datos.
let filtroInventario = '';
function coincideConFiltro(f){
  if(!filtroInventario) return true;
  const t = filtroInventario.toLowerCase();
  return (f.nombre||'').toLowerCase().includes(t) || (f.codigo||'').toLowerCase().includes(t);
}

export function renderInventario(){
  const tbody = document.querySelector('#tbl-inventario tbody');
  if(!tbody) return;
  const filas = filasInventario();

  // "En seguimiento" = ya se le puso un mínimo o un stock desde Maestros,
  // hay una orden esperándolo, o el stock quedó en negativo (se consumió
  // más de lo que había — se deja así a propósito, ver descontarInventario-
  // YCargarCosto en js/registrar.js: es normal en litografía que el
  // consumo real se registre antes de que llegue la compra). Sin este
  // filtro, los 226 papeles precargados (todos en 0/0 por default)
  // saldrían de entrada como si no hubiera ni una hoja, PERO un negativo
  // nunca se puede perder de vista aunque nunca se le haya puesto mínimo.
  const base = filtroInventario ? filas.filter(coincideConFiltro) : filas;
  const enSeguimiento = filtroInventario ? base : base.filter(f => f.minimo > 0 || f.stock !== 0 || f.esperando.length > 0);
  const negativos = enSeguimiento.filter(f => f.stock < 0);
  const bajoMinimo = enSeguimiento.filter(f => f.stock < 0 || (f.minimo > 0 && f.stock < f.minimo));
  const esperando = enSeguimiento.filter(f => f.esperando.length > 0);
  const valorTotal = enSeguimiento.reduce((s,f) => s + (f.costo ? f.costo * f.stock : 0), 0);

  const cont = document.getElementById('inv-kpis');
  if(cont){
    cont.innerHTML = `
      <div class="kpi"><div class="lbl">Materiales en seguimiento</div><div class="val">${enSeguimiento.length}</div><div class="sub">de ${filas.length} en los catálogos</div></div>
      <div class="kpi"><div class="lbl">Stock en negativo</div><div class="val ${negativos.length ? 'neg' : ''}">${negativos.length}</div><div class="sub">${negativos.length ? 'se consumió más de lo que había — urge comprar' : 'ninguno en negativo'}</div></div>
      <div class="kpi"><div class="lbl">Bajo el mínimo</div><div class="val ${bajoMinimo.length ? 'neg' : ''}">${bajoMinimo.length}</div><div class="sub">${bajoMinimo.length ? 'considera comprar' : 'todo en orden'}</div></div>
      <div class="kpi"><div class="lbl">Con órdenes esperando</div><div class="val ${esperando.length ? 'neg' : ''}">${esperando.length}</div><div class="sub">${esperando.length ? 'repón stock para liberarlas' : 'ninguna orden esperando'}</div></div>
      <div class="kpi"><div class="lbl">Valor estimado en inventario</div><div class="val">${fmtCOP(valorTotal)}</div><div class="sub">stock actual × costo por unidad</div></div>`;
  }

  // Negativo primero (lo más urgente), luego las que tienen órdenes
  // esperando, luego por qué tan lejos están de su mínimo.
  const ordenadas = enSeguimiento.slice().sort((a,b) =>
    (a.stock<0?0:1) - (b.stock<0?0:1) || (b.esperando.length>0) - (a.esperando.length>0) || (a.stock - a.minimo) - (b.stock - b.minimo));
  tbody.innerHTML = ordenadas.map(f => {
    const negativo = f.stock < 0;
    const bajo = negativo || (f.minimo > 0 && f.stock < f.minimo);
    const esperandoHTML = f.esperando.length
      ? f.esperando.map(a => `<span class="row-btn fila-clicable" data-orden="${a.orden}" style="display:inline-block;margin:1px 3px 1px 0">Orden ${a.orden} (falta ${fmtNum(a.cantidad_faltante,0)} ${a.unidad||''})</span>`).join('')
      : '—';
    const estadoHTML = negativo
      ? '<span class="estado-chip pending">🔴 Stock negativo</span>'
      : (bajo ? '<span class="estado-chip pending">⚠ Bajo mínimo</span>' : '<span class="estado-chip done">✓ OK</span>');
    return `<tr style="${bajo ? 'background:var(--bg-warning,rgba(163,45,45,.06))' : ''}">
      <td>${f.tipo}</td><td>${f.codigo || '—'}</td><td>${f.nombre}</td><td>${f.grupo}</td>
      <td class="num" style="${negativo?'color:var(--bad);font-weight:600':''}">${fmtNum(f.stock,2)} ${f.unidad}</td>
      <td class="num">${fmtNum(f.minimo,2)}</td>
      <td class="num">${f.costo != null ? fmtCOP(f.costo) : '—'}</td>
      <td>${estadoHTML}</td>
      <td>${esperandoHTML}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" style="text-align:center;color:var(--ink-faint)">${filtroInventario ? 'Ningún material coincide con "' + filtroInventario + '"' : 'Todavía no configuraste stock ni mínimo para ningún material — hazlo desde "Materias primas" o "Materiales por área"'}</td></tr>`;

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
  const buscar = document.getElementById('inv-buscar');
  if(buscar){
    buscar.addEventListener('input', () => {
      filtroInventario = buscar.value.trim();
      renderInventario();
    });
  }
}
