import { loadAll } from './store.js';
import { renderGerencial, renderProduccion, renderOperario, populateOperarioSelect, initDashboardFilters } from './dashboard.js';
import { initRegistrar, populateReg } from './registrar.js';
import { initOppForm, renderOppRecent, populateClienteSelect, populateProductoSelect, refreshPapelPliegoSelects } from './ordenes.js';
import { initMaestros, renderMaestros } from './maestros.js';

// ---------- pestañas ----------
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-'+btn.dataset.tab).classList.add('active');
  });
});

function onRegistrarChange(){
  renderGerencial();
  renderProduccion();
  renderOperario();
  renderOppRecent();
}

function onMaestrosChange(){
  populateReg();          // refresca selects del reloj checador (empleados/máquinas)
  populateOperarioSelect(); // refresca el selector de la pestaña Operario
  populateClienteSelect();
  populateProductoSelect();
  refreshPapelPliegoSelects();
}

(async function init(){
  try{
    await loadAll();
  }catch(e){
    return; // el error ya quedó mostrado por setNote dentro de loadAll
  }

  populateOperarioSelect();
  initDashboardFilters();
  renderGerencial();
  renderProduccion();
  renderOperario();

  initRegistrar(onRegistrarChange);
  initOppForm();
  renderOppRecent();
  initMaestros(onMaestrosChange);
})();
