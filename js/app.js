import { loadAll } from './store.js';
import { renderGerencial, renderProduccion, renderOperario, populateOperarioSelect, initDashboardFilters, abrirEdicionRegistroDesdeOrden } from './dashboard.js';
import { initRegistrar, populateReg } from './registrar.js';
import { initOppForm, renderOppRecent, populateClienteSelect, populateProductoSelect, refreshPapelPliegoSelects, setAjustarConsumoHandler } from './ordenes.js';
import { initMaestros, renderMaestros } from './maestros.js';
import { initUsuarios } from './usuarios.js';
import { initCalendario, renderCalendario } from './calendario.js';
import { initAlertas, renderAlertas } from './alertas.js';
import { initCostos, poblarDatalistProveedores } from './costos.js';
import { initRecibosCaja } from './recibos.js';
import { initInventario, renderInventario } from './inventario.js';
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
}

function onMaestrosChange(){
  pasoSeguro('refrescar selects Registrar', populateReg);
  pasoSeguro('refrescar select Operario', populateOperarioSelect);
  pasoSeguro('refrescar select Cliente', populateClienteSelect);
  pasoSeguro('refrescar select Producto', populateProductoSelect);
  pasoSeguro('refrescar Papel/Pliego', refreshPapelPliegoSelects);
  pasoSeguro('refrescar Proveedores', poblarDatalistProveedores);
  pasoSeguro('refrescar Inventario', renderInventario);
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
  pasoSeguro('Órdenes (tablas)', renderOppRecent);
  pasoSeguro('Maestros', () => initMaestros(onMaestrosChange));
  pasoSeguro('Usuarios', initUsuarios);
  pasoSeguro('Calendario', initCalendario);
  pasoSeguro('Alertas', initAlertas);
  pasoSeguro('Costos', initCostos);
  pasoSeguro('Recibos de caja', initRecibosCaja);
  pasoSeguro('Inventario', initInventario);

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

