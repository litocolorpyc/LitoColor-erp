import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast } from './helpers.js';
import { ROLES_CONFIGURABLES, permisosDeRol, guardarPermisosRol, permisosPorDefecto } from './auth.js';

const ROLES = ['admin','gerente','jefe_produccion','disenador','administradora','operario'];
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
    <td><select class="u-rol">${ROLES.map(r => `<option value="${r}" ${p.rol===r?'selected':''}>${ROL_LABEL[r]}</option>`).join('')}</select></td>
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
  const marcado = {};
  ROLES_CONFIGURABLES.forEach(r => { marcado[r] = new Set(permisosDeRol(r) || []); });
  const th = ROLES_CONFIGURABLES.map(r => `<th style="text-align:center">${ROL_LABEL[r]}</th>`).join('');
  const filas = grupos.map(g => `<tr class="mp-grupo"><td colspan="${ROLES_CONFIGURABLES.length + 1}"><b>${g.grupo}</b></td></tr>` +
    g.items.map(i => `<tr><td>${i.nombre}</td>${ROLES_CONFIGURABLES.map(r =>
      `<td style="text-align:center"><input type="checkbox" data-rol="${r}" data-tab="${i.tab}" ${marcado[r].has(i.tab) ? 'checked' : ''}></td>`).join('')}</tr>`).join('')).join('');
  cont.innerHTML = `<table><thead><tr><th>Opción del menú</th>${th}</tr></thead><tbody>${filas}</tbody></table>`;
}

async function guardarMatriz(){
  const btn = document.getElementById('mp-guardar');
  btn.disabled = true; btn.textContent = 'Guardando…';
  let fallo = false;
  for(const rol of ROLES_CONFIGURABLES){
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
  document.getElementById('mp-restaurar')?.addEventListener('click', () => {
    ROLES_CONFIGURABLES.forEach(r => {
      const base = new Set(permisosPorDefecto(r));
      document.querySelectorAll(`#matriz-permisos input[data-rol="${r}"]`).forEach(c => { c.checked = base.has(c.dataset.tab); });
    });
    toast('Se restauró la lista original (falta Guardar permisos)');
  });
}
