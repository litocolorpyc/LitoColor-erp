import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { getCurrentUser } from './auth.js';
import { toast } from './helpers.js';

// Evidencias (fotos y documentos) de un caso de reproceso o de un daño de
// equipo — pasos 8.1 y 8.14 del procedimiento PR-PROD-DAÑ-01. Los archivos van
// a un almacenamiento PRIVADO de Supabase (bucket `evidencias-danos`, máx. 10 MB,
// imágenes o PDF) y cada uno queda registrado en `reproceso_evidencias`, ligado
// a la clave del caso ('o5972' / 'r123') o del daño ('d7'). Se ven con enlaces
// temporales firmados (1 hora), nunca con un enlace público.

const BUCKET = 'evidencias-danos';
const MAX_BYTES = 10 * 1024 * 1024;
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

export async function cargarEvidencias(){
  const { data, error } = await sb.from('reproceso_evidencias').select('*').order('subido_en');
  if(!error) DB.reproceso_evidencias = data || [];
}
export const evidenciasDe = clave => (DB.reproceso_evidencias || []).filter(e => e.clave === clave);

export async function urlFirmada(ruta){
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(ruta, 3600);
  return data ? data.signedUrl : null;
}

async function subir(clave, archivos){
  const subidos = [];
  for(const f of archivos){
    if(!TIPOS.includes(f.type) && !/\.(jpe?g|png|webp|heic|pdf)$/i.test(f.name)){ toast(`"${f.name}": solo se aceptan fotos (JPG, PNG, WEBP, HEIC) o PDF`); continue; }
    if(f.size > MAX_BYTES){ toast(`"${f.name}" pesa ${kb(f.size)}: el máximo es 10 MB`); continue; }
    const seguro = f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_');
    const ruta = `${clave}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${seguro}`;
    const { error: e1 } = await sb.storage.from(BUCKET).upload(ruta, f, { contentType: f.type || undefined, upsert: false });
    if(e1){ console.error(e1); toast(`No se pudo subir "${f.name}"`); continue; }
    const fila = { clave, ruta, nombre: f.name, tipo: f.type || null, tamano: f.size, subido_por: getCurrentUser()?.nombre || null };
    const { data, error: e2 } = await sb.from('reproceso_evidencias').insert([fila]).select();
    if(e2){ console.error(e2); await sb.storage.from(BUCKET).remove([ruta]); toast(`No se pudo registrar "${f.name}"`); continue; }
    (DB.reproceso_evidencias ||= []).push(data[0]);
    subidos.push(data[0]);
  }
  return subidos;
}

async function quitar(ev){
  const { error: e1 } = await sb.storage.from(BUCKET).remove([ev.ruta]);
  if(e1){ console.error(e1); toast('No se pudo borrar el archivo'); return false; }
  const { error: e2 } = await sb.from('reproceso_evidencias').delete().eq('id', ev.id);
  if(e2){ console.error(e2); toast('No se pudo borrar el registro del archivo'); return false; }
  DB.reproceso_evidencias = DB.reproceso_evidencias.filter(x => x.id !== ev.id);
  return true;
}

// Borra TODAS las evidencias de un caso o daño (cuando se borra el caso).
export async function quitarEvidencias(clave){
  for(const ev of evidenciasDe(clave).slice()) await quitar(ev);
}

// Dibuja el bloque de evidencias dentro de `cont` y lo mantiene al día.
export async function montarEvidencias(cont, clave, onCambio){
  async function pintar(){
    const lista = evidenciasDe(clave);
    const urls = await Promise.all(lista.map(e => urlFirmada(e.ruta)));
    cont.innerHTML = `
      <div class="ev-grid">${lista.map((e, i) => {
        const esImg = (e.tipo || '').startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(e.nombre);
        return `<div class="ev-item">
          ${urls[i] ? `<a href="${esc(urls[i])}" target="_blank" rel="noopener" title="Abrir ${esc(e.nombre)}">${esImg ? `<img src="${esc(urls[i])}" alt="${esc(e.nombre)}" loading="lazy">` : '<div class="ev-pdf">PDF</div>'}</a>` : '<div class="ev-pdf">—</div>'}
          <div class="ev-nombre" title="${esc(e.nombre)}">${esc(e.nombre)}</div>
          <div class="card-hint" style="font-size:10.5px">${kb(e.tamano || 0)} · ${String(e.subido_en || '').slice(0, 10)}</div>
          <button type="button" class="row-btn row-btn-danger" data-ev-quitar="${e.id}">Quitar</button>
        </div>`; }).join('') || '<p class="card-hint" style="margin:0">Todavía no hay fotos ni documentos de este caso.</p>'}</div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label class="btn-secondary" style="margin:0;cursor:pointer;display:inline-block">📷 Agregar fotos o PDF
          <input type="file" class="ev-input" accept="image/*,application/pdf" multiple style="display:none"></label>
        <span class="card-hint ev-estado"></span>
      </div>`;
    cont.querySelector('.ev-input').addEventListener('change', async (e) => {
      const archivos = Array.from(e.target.files || []);
      if(!archivos.length) return;
      cont.querySelector('.ev-estado').textContent = `Subiendo ${archivos.length} archivo(s)…`;
      const ok = await subir(clave, archivos);
      if(ok.length) toast(`${ok.length} archivo(s) agregado(s) al caso`);
      await pintar(); if(onCambio) onCambio();
    });
    cont.querySelectorAll('[data-ev-quitar]').forEach(b => b.addEventListener('click', async () => {
      const ev = lista.find(x => x.id === parseInt(b.dataset.evQuitar, 10));
      if(!ev || !confirm(`¿Quitar "${ev.nombre}" de este caso? No se puede deshacer.`)) return;
      if(await quitar(ev)){ toast('Archivo quitado'); await pintar(); if(onCambio) onCambio(); }
    }));
  }
  await pintar();
}
