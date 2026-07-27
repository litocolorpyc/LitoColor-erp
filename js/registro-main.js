import { loadAll } from './store.js';
import { initRegistrar } from './registrar.js';
import { getPiezasPendientesPorPrioridad, chipsProcesosHTML, fichaOrdenParaOperarioHTML, tipoTrabajoLabel, estadoOrden, estadoBadgeHTML, imprimirDetalleOrden } from './ordenes.js';

document.getElementById('ayuda-toggle').addEventListener('click', () => {
  const box = document.getElementById('ayuda-box');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
});

// ---------- Subórdenes pendientes en orden de prioridad (solo lectura) ----------
// Una fila por SUBORDEN (no por orden completa) — así una orden con 5
// piezas se ve y se prioriza como 5 ítems, no como uno solo — y cada fila
// muestra los globos de TODOS sus procesos requeridos, no solo uno (ver
// punto 11 de AjustesERP).
function renderPrioridadOperario(){
  const cont = document.getElementById('reg-prioridad-list');
  if(!cont) return;
  const pendientes = getPiezasPendientesPorPrioridad();
  if(!pendientes.length){
    cont.innerHTML = '<p style="color:var(--ink-faint);font-size:13px">No hay subórdenes activas ahora mismo.</p>';
    return;
  }
  cont.innerHTML = pendientes.map(({ o, p }, i) => {
    return `<div class="prioridad-row" data-orden="${o.orden}">
      <span class="prioridad-num">${i + 1}</span>
      <span class="prioridad-info">
        <div><b>Orden ${o.orden}-${p.suborden}</b> — ${o.cliente || '—'} <span class="tipo-trabajo-chip">${tipoTrabajoLabel(o)}</span>${p.pieza ? ' · ' + p.pieza : ''}</div>
        <div class="detalle-pieza-chips" style="margin-top:4px;margin-bottom:0">${chipsProcesosHTML(p)}</div>
      </span>
      ${estadoBadgeHTML(estadoOrden(o))}
    </div>`;
  }).join('');

  cont.querySelectorAll('.prioridad-row').forEach(row => {
    row.addEventListener('dblclick', () => mostrarDetalleOperario(parseInt(row.dataset.orden, 10)));
  });
}

let ordenDetalleOperarioActual = null;

function mostrarDetalleOperario(orden){
  ordenDetalleOperarioActual = orden;
  document.getElementById('reg-detalle-titulo').textContent = `Orden ${orden}`;
  document.getElementById('reg-detalle-body').innerHTML = fichaOrdenParaOperarioHTML(orden);
  const card = document.getElementById('reg-detalle-card');
  card.style.display = '';
  card.scrollIntoView({ behavior: 'smooth' });
}

const btnCerrarDetalle = document.getElementById('reg-detalle-cerrar');
if(btnCerrarDetalle){
  btnCerrarDetalle.addEventListener('click', () => {
    document.getElementById('reg-detalle-card').style.display = 'none';
  });
}

const btnImprimirDetalle = document.getElementById('reg-detalle-imprimir');
if(btnImprimirDetalle){
  btnImprimirDetalle.addEventListener('click', () => {
    if(ordenDetalleOperarioActual != null) imprimirDetalleOrden(ordenDetalleOperarioActual);
  });
}

(async function init(){
  try{
    await loadAll();
  }catch(e){
    return;
  }
  initRegistrar();
  renderPrioridadOperario();
})();
