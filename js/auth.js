import { sb } from './supabase-client.js';

// Mapa de qué pestañas (data-tab) puede ver cada rol.
// null = ve todo. Los demás roles tienen su propia lista de pestañas.
const PERMISOS = {
  admin:            null,
  gerente:          null,
  jefe_produccion:  ['produccion', 'operario', 'ordenes', 'calendario', 'alertas', 'registrar', 'reprocesos', 'inventario', 'informes-op', 'pantalla-planta', 'remisiones', 'm-empleados', 'm-areas', 'm-maquinas', 'm-actividades', 'm-motivos-pausa', 'm-motivos-reproceso', 'm-subprocesos', 'm-cat-materia', 'm-materias', 'm-insumos', 'm-piezas-producto', 'm-clientes', 'm-proveedores', 'm-productos', 'm-documentos', 'ayuda'],
  disenador:        ['ordenes', 'registrar', 'm-productos', 'm-cat-materia', 'm-materias', 'm-insumos', 'm-piezas-producto', 'ayuda'],
  administradora:   ['administrativo', 'gerencial', 'ordenes', 'alertas', 'registrar', 'reprocesos', 'inventario', 'remisiones', 'm-empleados', 'm-clientes', 'm-proveedores', 'm-materias', 'm-costos', 'registrar-costo', 'registrar-venta', 'm-documentos', 'ayuda'],
};

// Pestaña con la que arranca cada rol (los demás arrancan en Gerencial, la
// primera del menú). Liliana (administradora) usa su propio panel y no el
// tablero pensado para Julián — reunión 27oct26.
const PAGINA_INICIO = { administradora: 'administrativo', gerente: 'dashboard-gerente' };

// Pestañas que ve ÚNICAMENTE el rol gerente: ni siquiera el administrador (que
// por lo demás ve todo). La información del Excel de Julián (resumen
// gerencial) es solo suya; la base de datos además lo exige (ver la migración
// 20261028151000_datos_financieros_solo_gerente.sql).
const SOLO_GERENTE = ['dashboard-gerente'];

let currentUser = null; // { email, nombre, rol, cargo }

export function getCurrentUser(){ return currentUser; }

// Solo un usuario superior (Admin/Gerente/Jefe de Producción) puede
// corregir o borrar un registro de producción ya guardado — los
// operarios pueden crear y finalizar los suyos, pero no modificarlos
// después. Ver punto 1 de AjustesERP 24jul26.docx.
const ROLES_EDITAN_PRODUCCION = ['admin', 'gerente', 'jefe_produccion'];
export function puedeEditarProduccion(){
  return !!currentUser && ROLES_EDITAN_PRODUCCION.includes(currentUser.rol);
}

export async function getSession(){
  const { data } = await sb.auth.getSession();
  return data.session;
}

async function loadPersonaActual(email){
  const { data, error } = await sb.from('personal').select('*').eq('email', email).maybeSingle();
  if(error){ console.error(error); return null; }
  return data;
}

export async function crearCuentaPropia(email, password){
  // Solo deja "crear cuenta" a un correo que un Admin/Gerente ya haya
  // agregado en el módulo de Usuarios, con un rol asignado.
  const { data: persona, error: errPersona } = await sb.from('personal').select('*').eq('email', email).maybeSingle();
  if(errPersona) return { error: { message: 'No se pudo verificar el correo. Intenta de nuevo.' } };
  if(!persona || !persona.rol || persona.rol === 'operario'){
    return { error: { message: 'Este correo no está autorizado todavía. Pide que el Admin o el Gerente te agreguen en Usuarios.' } };
  }
  const { data, error } = await sb.auth.signUp({ email, password });
  if(error) return { error };
  return { user: persona, data };
}

export async function iniciarSesion(email, password){
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if(error) return { error };
  const persona = await loadPersonaActual(email);
  currentUser = {
    email,
    nombre: persona ? persona.nombre : email,
    rol: persona ? (persona.rol || 'operario') : 'gerente',
    cargo: persona ? persona.cargo : ''
  };
  return { user: currentUser };
}

export async function cerrarSesion(){
  await sb.auth.signOut();
  currentUser = null;
}

export async function cambiarContrasena(nuevaPassword){
  const { error } = await sb.auth.updateUser({ password: nuevaPassword });
  return { error };
}

export async function restaurarSesion(){
  const session = await getSession();
  if(!session) return null;
  const email = session.user.email;
  const persona = await loadPersonaActual(email);
  currentUser = {
    email,
    nombre: persona ? persona.nombre : email,
    rol: persona ? (persona.rol || 'operario') : 'gerente',
    cargo: persona ? persona.cargo : ''
  };
  return currentUser;
}

// Oculta del menú lateral las pestañas que el rol actual no debería ver,
// y si la pestaña activa en este momento no está permitida, salta a la
// primera que sí lo esté.
function irAPestana(tab){
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  const panel = document.getElementById('panel-' + tab);
  if(!btn || !panel) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  panel.classList.add('active');
}

// Avisa a los módulos que ya se aplicaron los permisos (ej. el panel administrativo oculta
// los atajos que el rol no tiene).
export function aplicarPermisos(){
  aplicarPermisosInterno();
  document.dispatchEvent(new Event('permisos-aplicados'));
}

function aplicarPermisosInterno(){
  if(!currentUser) return;
  SOLO_GERENTE.forEach(tab => {
    const b = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if(b) b.style.display = currentUser.rol === 'gerente' ? '' : 'none';
  });

  const permitidas = PERMISOS[currentUser.rol];
  if(permitidas === null || permitidas === undefined){   // ve todo
    const inicioGen = PAGINA_INICIO[currentUser.rol];
    if(inicioGen && document.querySelector('.tab-btn.active')?.dataset.tab === 'gerencial') irAPestana(inicioGen);
    return;
  }

  let primerPermitido = null;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const tab = btn.dataset.tab;
    const ok = permitidas.includes(tab);
    btn.style.display = ok ? '' : 'none';
    if(ok && !primerPermitido) primerPermitido = tab;
  });

  const inicio = PAGINA_INICIO[currentUser.rol];
  if(inicio && permitidas.includes(inicio) && document.querySelector('.tab-btn.active')?.dataset.tab === 'gerencial'){
    irAPestana(inicio);
    return;
  }

  const activo = document.querySelector('.tab-btn.active');
  if(activo && activo.style.display === 'none' && primerPermitido){
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    const nuevoBtn = document.querySelector(`.tab-btn[data-tab="${primerPermitido}"]`);
    if(nuevoBtn) nuevoBtn.classList.add('active');
    const panel = document.getElementById('panel-' + primerPermitido);
    if(panel) panel.classList.add('active');
  }
}
