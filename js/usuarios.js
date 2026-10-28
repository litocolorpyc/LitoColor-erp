import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast } from './helpers.js';
import { rolesConfigurables, rolesNuevos, crearRolNuevo, eliminarRolNuevo, permisosDeRol, guardarPermisosRol, permisosPorDefecto } from './auth.js';

const ROLES_BASE = ['admin','gerente','jefe_produccion','disenador','administradora','operario'];
const listaRoles = () => [...ROLES_BASE, ...rolesNuevos().map(r => r.clave)];
const etiquetaRol = r => ROL_LABEL[r] || rolesNuevos().find(x => x.clave === r)?.nombre || r;
const ROL_LABEL = {
  admin: 'Admin (ve todo)',
  gerente: 'Gerente (ve todo)',
  jefe_produccion: 'Jefe de Producción',
  disenador: 'Diseñador',
  administradora: 'Administradora',
  operario: 'Sin acceso al panel'
};

export function renderUsuarios(){
  const tbody = document.querySelector('#tbl-usuarios tbody');
  if(!tbody) return;
  tbody.innerHTML = DB.personal.map(p => `<tr data-id="${p.id}">
    <td>${p.nombre}</td>
    <td>${p.cargo || '—'}</td>
    <td><input type="email" class="u-email" value="${p.email || ''}" placeholder="correo@litocolor.com.co"></td>
    <td><select class="u-rol">${listaRoles().map(r => `<option value="${r}" ${p.rol===r?'selected':''}>${etiquetaRol(r)}</option>`).join('')}</select></td>
    <td><button type="button" class="row-btn u-save">Guardar</button></td>
  </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">Sin personal todavía</td></tr>';

  tbody.querySelectorAll('.u-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const id = parseInt(tr.dataset.id, 10);
      const email = tr.querySelector('.u-email').value.trim() || null;
      const rol = tr.querySelector('.u-rol').value;
      btn.disabled = true; btn.textContent = 'Guardando…';
      const { data, error } = await sb.from('personal').update({ email, rol }).eq('id', id).select();
      btn.disabled = false; btn.textContent = 'Guardar';
      if(error){
        console.error(error);
        toast(error.message?.includes('duplicate') ? 'Ese correo ya está en uso por otra persona' : 'Error al guardar');
        return;
      }
      const idx = DB.personal.findIndex(p => p.id === id);
      if(idx >= 0) DB.personal[idx] = data[0];
      toast('Acceso actualizado para ' + data[0].nombre);
    });
  });
}

// Matriz de permisos: filas = opciones del menú (las mismas del menú lateral), columnas = roles.
// Admin y Gerente ven todo; "Resumen gerencial" y "Resultado por Área Comercial" son solo del Gerente
// y "Usuarios" solo de Admin/Gerente, por eso no aparecen aquí.
const FIJAS = ['dashboard-gerente', 'resultado-areas', 'usuarios'];
function opcionesDelMenu(){
  const grupos = [];
  document.querySelectorAll('.sidebar-group').forEach(g => {
    const items = [...g.querySelectorAll('.tab-btn:not([data-adm])')]
      .filter(b => !FIJAS.includes(b.dataset.tab))
      .map(b => ({ tab: b.dataset.tab, nombre: b.textContent.trim() }));
    if(items.length) grupos.push({ grupo: g.querySelector('.sidebar-group-label')?.textContent.trim() || '', items });
  });
  return grupos;
}

export function renderMatrizPermisos(){
  const cont = document.getElementById('matriz-permisos');
  if(!cont) return;
  const grupos = opcionesDelMenu();
  const roles = rolesConfigurables();
  const nuevos = new Set(rolesNuevos().map(r => r.clave));
  const marcado = {};
  roles.forEach(r => { marcado[r] = new Set(permisosDeRol(r) || []); });
  const th = roles.map(r => `<th style="text-align:center">${etiquetaRol(r)}${nuevos.has(r) ? ` <button type="button" class="row-btn mp-del" data-rol="${r}" title="Eliminar este rol">✕</button>` : ''}</th>`).join('');
  const filas = grupos.map(g => `<tr class="mp-grupo"><td colspan="${roles.length + 1}"><b>${g.grupo}</b></td></tr>` +
    g.items.map(i => `<tr><td>${i.nombre}</td>${roles.map(r =>
      `<td style="text-align:center"><input type="checkbox" data-rol="${r}" data-tab="${i.tab}" ${marcado[r].has(i.tab) ? 'checked' : ''}></td>`).join('')}</tr>`).join('')).join('');
  cont.innerHTML = `<table><thead><tr><th>Opción del menú</th>${th}</tr></thead><tbody>${filas}</tbody></table>`;
}

async function crearRol(){
  const inp = document.getElementById('mp-nombre-rol');
  const { error } = await crearRolNuevo(inp.value);
  if(error){ console.error(error); toast(error.message || 'No se pudo crear el rol'); return; }
  inp.value = '';
  renderUsuarios();
  renderMatrizPermisos();
  toast('Rol creado. Marca sus opciones y pulsa Guardar permisos; luego asígnalo a una persona arriba.');
}

async function borrarRol(clave){
  if(DB.personal.some(p => p.rol === clave)){ toast('Hay personas con este rol: cámbiales el rol antes de eliminarlo'); return; }
  if(!confirm('¿Eliminar el rol "' + etiquetaRol(clave) + '"?')) return;
  const { error } = await eliminarRolNuevo(clave);
  if(error){ console.error(error); toast('No se pudo eliminar el rol'); return; }
  renderUsuarios();
  renderMatrizPermisos();
  toast('Rol eliminado');
}

async function guardarMatriz(){
  const btn = document.getElementById('mp-guardar');
  btn.disabled = true; btn.textContent = 'Guardando…';
  let fallo = false;
  for(const rol of rolesConfigurables()){
    const tabs = [...document.querySelectorAll(`#matriz-permisos input[data-rol="${rol}"]:checked`)].map(c => c.dataset.tab);
    const { error } = await guardarPermisosRol(rol, tabs);
    if(error){ console.error(error); fallo = true; }
  }
  btn.disabled = false; btn.textContent = 'Guardar permisos';
  toast(fallo ? 'No se pudieron guardar todos los permisos' : 'Permisos guardados. Cada persona los ve al volver a entrar.');
}

export function initUsuarios(){
  renderUsuarios();
  renderMatrizPermisos();
  document.getElementById('mp-guardar')?.addEventListener('click', guardarMatriz);
  document.getElementById('mp-crear')?.addEventListener('click', crearRol);
  document.getElementById('matriz-permisos')?.addEventListener('click', e => {
    const b = e.target.closest('.mp-del');
    if(b) borrarRol(b.dataset.rol);
  });
  document.getElementById('mp-ir')?.addEventListener('click', () => document.getElementById('card-matriz-permisos')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  document.getElementById('mp-restaurar')?.addEventListener('click', () => {
    rolesConfigurables().forEach(r => {
      const base = new Set(permisosPorDefecto(r));
      document.querySelectorAll(`#matriz-permisos input[data-rol="${r}"]`).forEach(c => { c.checked = base.has(c.dataset.tab); });
    });
    toast('Se restauró la lista original (falta Guardar permisos)');
  });
}
