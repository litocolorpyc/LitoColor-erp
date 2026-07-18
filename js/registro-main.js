import { loadAll } from './store.js';
import { initRegistrar } from './registrar.js';
import { getOrdenesPendientesPorPrioridad, fichaOrdenParaOperarioHTML, tipoTrabajoLabel, estadoOrden, estadoBadgeHTML } from './ordenes.js';

document.getElementById('ayuda-toggle').addEventListener('click', () => {
  const box = document.getElementById('ayuda-box');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
});

// ---------- Órdenes pendientes en orden de prioridad (solo lectura) ----------
function renderPrioridadOperario(){
  const cont = document.getElementById('reg-prioridad-list');
  if(!cont) return;
  const activas = getOrdenesPendientesPorPrioridad();
  if(!activas.length){
    cont.innerHTML = '<p style="color:var(--ink-faint);font-size:13px">No hay órdenes activas ahora mismo.</p>';
    return;
  }
  cont.innerHTML = activas.map((o, i) => {
    const estado = estadoOrden(o);
    return `<div class="prioridad-row" data-orden="${o.orden}">
      <span class="prioridad-num">${i + 1}</span>
      <span class="prioridad-info"><b>Orden ${o.orden}</b> — ${o.cliente || '—'} <span class="tipo-trabajo-chip">${tipoTrabajoLabel(o)}</span></span>
      ${estadoBadgeHTML(estado)}
    </div>`;
  }).join('');

  cont.querySelectorAll('.prioridad-row').forEach(row => {
    row.addEventListener('dblclick', () => mostrarDetalleOperario(parseInt(row.dataset.orden, 10)));
  });
}

function mostrarDetalleOperario(orden){
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

(async function init(){
  try{
    await loadAll();
  }catch(e){
    return;
  }
  initRegistrar();
  renderPrioridadOperario();
})();
