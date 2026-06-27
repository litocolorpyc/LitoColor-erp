import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast } from './helpers.js';

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

export function initUsuarios(){
  renderUsuarios();
}
