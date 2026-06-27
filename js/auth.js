import { sb } from './supabase-client.js';

// Mapa de qué pestañas (data-tab) puede ver cada rol.
// null = ve todo. Los demás roles tienen su propia lista de pestañas.
const PERMISOS = {
  admin:            null,
  gerente:          null,
  jefe_produccion:  ['produccion', 'operario', 'ordenes', 'registrar', 'm-empleados', 'm-maquinas', 'm-materias', 'm-clientes', 'm-proveedores', 'm-productos'],
  disenador:        ['ordenes', 'registrar', 'm-productos', 'm-materias'],
  administradora:   ['gerencial', 'ordenes', 'registrar', 'm-empleados', 'm-clientes', 'm-proveedores'],
};

let currentUser = null; // { email, nombre, rol, cargo }

export function getCurrentUser(){ return currentUser; }

export async function getSession(){
  const { data } = await sb.auth.getSession();
  return data.session;
}

async function loadPersonaActual(email){
  const { data, error } = await sb.from('personal').select('*').eq('email', email).maybeSingle();
  if(error){ console.error(error); return null; }
  return data;
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
export function aplicarPermisos(){
  if(!currentUser) return;
  const permitidas = PERMISOS[currentUser.rol];
  if(permitidas === null || permitidas === undefined) return; // ve todo

  let primerPermitido = null;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const tab = btn.dataset.tab;
    const ok = permitidas.includes(tab);
    btn.style.display = ok ? '' : 'none';
    if(ok && !primerPermitido) primerPermitido = tab;
  });

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
