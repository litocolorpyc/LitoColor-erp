import { loadAll } from './store.js';
import { activarExcelEnTarjetas } from './helpers.js';
import { renderGerencial, renderProduccion, renderOperario, populateOperarioSelect, initDashboardFilters, abrirEdicionRegistroDesdeOrden } from './dashboard.js';
import { initRegistrar, populateReg, resolverAlertasFaltanteMateriaPrima } from './registrar.js';
import { initOppForm, renderOppRecent, populateClienteSelect, populateProductoSelect, refreshPapelPliegoSelects, setAjustarConsumoHandler, setReprocesarHandler } from './ordenes.js';
import { initMaestros, renderMaestros } from './maestros.js';
import { initUsuarios } from './usuarios.js';
import { initCalendario, renderCalendario } from './calendario.js';
import { initAlertas, renderAlertas } from './alertas.js';
import { initCostos, poblarDatalistProveedores } from './costos.js';
import { initRecibosCaja } from './recibos.js';
import { initVentas, repararValorNetoFacturasVenta } from './ventas.js';
import { initConsultaTiempos, renderConsultaTiempos } from './consulta-tiempos.js';
import { initInventario, renderInventario } from './inventario.js';
import { initRemisiones, actualizarNumeroPreview } from './remisiones.js';
import { initReprocesos, abrirNuevoReprocesoDesdeOrden, renderListadoReprocesos, renderInformeReprocesos, poblarOperarioRep, poblarMotivoRep } from './reprocesos.js';
import { restaurarSesion, iniciarSesion, cerrarSesion, cambiarContrasena, crearCuentaPropia, getCurrentUser, aplicarPermisos } from './auth.js';

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
  pasoSeguro('refrescar Gerencial', renderGerencial);
  pasoSeguro('refrescar Producción', renderProduccion);
  pasoSeguro('refrescar Operario', renderOperario);
  pasoSeguro('refrescar Órdenes', renderOppRecent);
  pasoSeguro('refrescar Calendario', renderCalendario);
  pasoSeguro('refrescar Alertas', renderAlertas);
  pasoSeguro('refrescar Inventario', renderInventario);
  pasoSeguro('refrescar lista de operarios (consulta de tiempos)', renderConsultaTiempos);
  pasoSeguro('refrescar listado de Reprocesos', renderListadoReprocesos);
  pasoSeguro('refrescar informe de Reprocesos', renderInformeReprocesos);
}

function onMaestrosChange(){
  pasoSeguro('refrescar selects Registrar', populateReg);
  pasoSeguro('refrescar select Operario', populateOperarioSelect);
  pasoSeguro('refrescar select Cliente', populateClienteSelect);
  pasoSeguro('refrescar select Producto', populateProductoSelect);
  pasoSeguro('refrescar Papel/Pliego', refreshPapelPliegoSelects);
  pasoSeguro('refrescar Proveedores', poblarDatalistProveedores);
  pasoSeguro('refrescar Inventario', renderInventario);
  pasoSeguro('refrescar lista de operarios (consulta de tiempos)', renderConsultaTiempos);
  pasoSeguro('refrescar numeración de Remisión', actualizarNumeroPreview);
  pasoSeguro('refrescar operarios de Reprocesos', poblarOperarioRep);
  pasoSeguro('refrescar motivos de Reprocesos', poblarMotivoRep);
}

// Corre cada paso de arranque de forma aislada: si uno falla (por ejemplo,
// un HTML desactualizado que le falta un campo nuevo a algún módulo), el
// error queda en la consola pero el resto de la app sigue funcionando en
// vez de quedarse a medio cargar.
function pasoSeguro(nombre, fn){
  try{
    fn();
  }catch(e){
    console.error('Error arrancando "' + nombre + '":', e);
  }
}

async function arrancarApp(){
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('app').style.display = '';

  const user = getCurrentUser();
  document.getElementById('user-name').textContent = user ? (user.nombre + ' · ' + (user.cargo || user.rol)) : '';

  try{
    await loadAll();
  }catch(e){
    return; // el error ya quedó mostrado por setNote dentro de loadAll
  }

  pasoSeguro('Operario select', populateOperarioSelect);
  pasoSeguro('Filtros dashboard', initDashboardFilters);
  pasoSeguro('Gerencial', renderGerencial);
  pasoSeguro('Producción', renderProduccion);
  pasoSeguro('Operario', renderOperario);

  pasoSeguro('Registrar', () => initRegistrar(onRegistrarChange));
  pasoSeguro('Órdenes (formulario)', () => initOppForm(populateReg));
  pasoSeguro('Ajustar consumo desde Historial', () => setAjustarConsumoHandler(abrirEdicionRegistroDesdeOrden));
  pasoSeguro('Reprocesar desde el detalle de la orden', () => setReprocesarHandler(abrirNuevoReprocesoDesdeOrden));
  pasoSeguro('Órdenes (tablas)', renderOppRecent);
  pasoSeguro('Maestros', () => initMaestros(onMaestrosChange));
  pasoSeguro('Usuarios', initUsuarios);
  pasoSeguro('Calendario', initCalendario);
  pasoSeguro('Alertas', initAlertas);
  pasoSeguro('Costos', initCostos);
  pasoSeguro('Recibos de caja', initRecibosCaja);
  pasoSeguro('Registrar Venta', initVentas);
  pasoSeguro('Reparar valor neto de facturas de venta', () => {
    repararValorNetoFacturasVenta()
      .then(() => { renderGerencial(); renderOppRecent(); })
      .catch(e => console.error('Error reparando valor neto de facturas de venta:', e));
  });
  pasoSeguro('Consulta de tiempos por operario', initConsultaTiempos);
  pasoSeguro('Inventario', initInventario);
  // Deja resueltas en la base las "órdenes esperando material" que ya no
  // aplican (papel ya cortado, orden cerrada, stock ya cubierto).
  pasoSeguro('Órdenes esperando material', () => {
    resolverAlertasFaltanteMateriaPrima({ silencioso: true }).then(() => { renderInventario(); renderAlertas(); });
  });
  pasoSeguro('Remisiones', initRemisiones);
  pasoSeguro('Reprocesos', initReprocesos);

  pasoSeguro('Botón Excel en todas las tablas', () => activarExcelEnTarjetas());
  pasoSeguro('Permisos', aplicarPermisos);
}

function wireLogin(){
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  async function intentar(){
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if(!email || !password){ err.textContent = 'Completa correo y contraseña'; return; }
    btn.disabled = true; btn.textContent = 'Entrando…';
    const { error } = await iniciarSesion(email, password);
    btn.disabled = false; btn.textContent = 'Entrar';
    if(error){ err.textContent = 'Correo o contraseña incorrectos'; return; }
    err.textContent = '';
    arrancarApp();
  }
  btn.addEventListener('click', intentar);
  document.getElementById('login-password').addEventListener('keydown', e => { if(e.key === 'Enter') intentar(); });

  document.getElementById('show-signup').addEventListener('click', () => {
    const box = document.getElementById('signup-box');
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
  });

  const signupBtn = document.getElementById('signup-btn');
  async function intentarSignup(){
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const errEl = document.getElementById('signup-error');
    if(!email || !password || password.length < 6){ errEl.textContent = 'Completa el correo y una contraseña de mínimo 6 caracteres'; return; }
    signupBtn.disabled = true; signupBtn.textContent = 'Creando…';
    const { error } = await crearCuentaPropia(email, password);
    signupBtn.disabled = false; signupBtn.textContent = 'Crear mi cuenta';
    if(error){ errEl.textContent = error.message; return; }
    errEl.textContent = '';
    // tras crear la cuenta, entra directo con esas mismas credenciales
    const { error: errLogin } = await iniciarSesion(email, password);
    if(errLogin){ errEl.textContent = 'Cuenta creada — ahora inicia sesión arriba con tu correo y contraseña.'; return; }
    arrancarApp();
  }
  signupBtn.addEventListener('click', intentarSignup);
}

function wireUserControls(){
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await cerrarSesion();
    location.reload();
  });
  document.getElementById('btn-change-pwd').addEventListener('click', () => {
    document.getElementById('change-pwd-panel').style.display = 'flex';
  });
  document.getElementById('cancel-new-password').addEventListener('click', () => {
    document.getElementById('change-pwd-panel').style.display = 'none';
    document.getElementById('new-password').value = '';
  });
  document.getElementById('save-new-password').addEventListener('click', async () => {
    const pwd = document.getElementById('new-password').value;
    if(!pwd || pwd.length < 6){ alert('La contraseña debe tener mínimo 6 caracteres'); return; }
    const { error } = await cambiarContrasena(pwd);
    if(error){ alert('No se pudo cambiar la contraseña'); return; }
    document.getElementById('change-pwd-panel').style.display = 'none';
    document.getElementById('new-password').value = '';
    alert('Contraseña actualizada');
  });
}

(async function init(){
  wireLogin();
  wireUserControls();
  const user = await restaurarSesion();
  if(user){
    arrancarApp();
  } else {
    document.getElementById('login-overlay').style.display = 'flex';
  }
})();

