import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { loadOpp, loadProduccion } from './store.js';
import { areaColor, fmtNum, etiquetaOrden } from './helpers.js';
import { nombresDeAreas, piezasPendientesDeArea, asignacionPendienteDeSuborden } from './ordenes.js';

// Pantalla de planta (reunión 27oct26, Julián y Juan): una vista grande, de
// solo lectura, pensada para dejar en un televisor. Va pasando por las áreas
// (como el menú de un restaurante) mostrando, de cada una, el trabajo
// pendiente en el orden de "Prioridad por área". Se alimenta de los mismos
// datos que Órdenes: lo que Juan prioriza allá aparece aquí solo.

const $ = id => document.getElementById(id);
const POR_PAGINA = 7;          // filas que caben cómodas en un televisor; el resto pasa en la página siguiente
const REFRESCO_DATOS_MS = 120000;

let areaFija = '';             // '' = rotar entre todas las áreas con trabajo
let segundos = 15;
let indice = 0;                // posición actual dentro de las áreas a mostrar
let timerRotar = null;
let timerDatos = null;
let ultimaActualizacion = null;

const panelActivo = () => $('panel-pantalla-planta')?.classList.contains('active');

// Áreas que tienen algo pendiente ahora mismo (en el orden del maestro Áreas).
function areasConTrabajo(){
  return nombresDeAreas().filter(a => piezasPendientesDeArea(a).length > 0);
}

function enCurso(o, p, area){
  return DB.produccion.some(r => r.orden === o.orden && r.suborden === p.suborden && r.area === area && r.horaIni && !r.horaFin);
}

function filaHTML({ o, p }, i, area){
  const asignado = asignacionPendienteDeSuborden(o.orden, p.suborden, area);
  const trabajando = enCurso(o, p, area);
  const estado = trabajando
    ? '<span class="pp-badge pp-badge-curso">En curso</span>'
    : (asignado && asignado.operario ? `<span class="pp-badge pp-badge-asig">${asignado.operario.split(' ')[0]}</span>` : '');
  const produce = o.cliente_produccion && o.cliente_produccion !== o.cliente ? ` <span class="pp-sub">· para ${o.cliente_produccion}</span>` : '';
  const apellido = o.producto ? `<span class="pp-prod">${o.producto}</span>` : '';
  const mismoNombre = p.pieza && o.producto && p.pieza.trim().toLowerCase() === String(o.producto).trim().toLowerCase();
  const pieza = p.pieza && !mismoNombre ? `<span class="pp-sub">${p.pieza}</span>` : '';
  return `<div class="pp-row">
    <div class="pp-num">${i + 1}</div>
    <div class="pp-op">${etiquetaOrden(o.orden)}<small>-${p.suborden}</small></div>
    <div class="pp-info"><div class="pp-cli">${o.cliente || '—'}${produce}</div><div>${apellido} ${pieza}</div></div>
    <div class="pp-cant">${p.cantidad != null ? fmtNum(p.cantidad, 0) : ''}</div>
    <div class="pp-estado">${estado}</div>
  </div>`;
}

// Cada "paso" de la rotación es una página de un área: un área con más de
// POR_PAGINA pendientes ocupa varios pasos, así todo el trabajo termina
// apareciendo aunque nadie toque la pantalla.
function armarPasos(){
  const areas = areaFija ? [areaFija] : areasConTrabajo();
  const pasos = [];
  areas.forEach(area => {
    const total = piezasPendientesDeArea(area).length;
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    for(let pagina = 0; pagina < paginas; pagina++) pasos.push({ area, pagina, paginas, total });
  });
  return { areas, pasos };
}

function pintar(){
  const tablero = $('pp-tablero');
  if(!tablero) return;
  const { areas, pasos } = armarPasos();
  if(!pasos.length){
    tablero.innerHTML = '<div class="pp-vacio">No hay trabajo pendiente en ninguna área 🎉</div>';
    $('pp-puntos').innerHTML = '';
    return;
  }
  if(indice >= pasos.length) indice = 0;
  const { area, pagina, paginas, total } = pasos[indice];
  const lista = piezasPendientesDeArea(area).slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
  const color = areaColor(area);
  tablero.innerHTML = `
    <div class="pp-head" style="border-color:${color}">
      <div class="pp-area" style="color:${color}">${area}</div>
      <div class="pp-total">${total} pendiente${total === 1 ? '' : 's'}${paginas > 1 ? ` · página ${pagina + 1} de ${paginas}` : ''}</div>
    </div>
    <div class="pp-lista">${lista.length ? lista.map((f, i) => filaHTML(f, pagina * POR_PAGINA + i, area)).join('') : '<div class="pp-vacio">Sin trabajo pendiente en esta área</div>'}</div>`;
  $('pp-puntos').innerHTML = areas.length > 1
    ? areas.map(a => `<span class="pp-punto${a === area ? ' act' : ''}" style="${a === area ? 'background:' + areaColor(a) : ''}" title="${a}"></span>`).join('')
    : '';
  const hora = ultimaActualizacion ? ultimaActualizacion.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';
  $('pp-pie').textContent = hora ? `Actualizado ${hora}` : '';
}

function rotar(){
  if(!panelActivo()) return;
  indice++;
  pintar();
}

function reiniciarRotacion(){
  clearInterval(timerRotar);
  timerRotar = setInterval(rotar, Math.max(5, segundos) * 1000);
}

// Vuelve a leer órdenes, producción y prioridades para que el televisor no
// se quede con datos viejos (nadie toca la pantalla).
async function refrescarDatos(){
  if(!panelActivo()) return;
  try{
    await Promise.all([loadOpp(), loadProduccion(), sb.from('prioridad_area').select('*').then(r => { if(r.data) DB.prioridad_area = r.data; })]);
    ultimaActualizacion = new Date();
    pintar();
  }catch(e){
    console.error('No se pudo refrescar la pantalla de planta:', e);
  }
}

function poblarAreas(){
  const sel = $('pp-area');
  if(!sel) return;
  const previo = sel.value;
  sel.innerHTML = '<option value="">Rotar entre todas las áreas</option>' + nombresDeAreas().map(a => `<option value="${a}">${a}</option>`).join('');
  if(Array.from(sel.options).some(o => o.value === previo)) sel.value = previo;
}

function pantallaCompleta(){
  const el = $('pp-contenedor');
  if(!el) return;
  if(document.fullscreenElement){ document.exitFullscreen(); return; }
  if(el.requestFullscreen) el.requestFullscreen().catch(() => {});
}

export function renderPantallaPlanta(){
  poblarAreas();
  ultimaActualizacion = ultimaActualizacion || new Date();
  pintar();
}

export function initPantallaPlanta(){
  if(!$('pp-contenedor')) return;
  poblarAreas();
  $('pp-area').addEventListener('change', e => { areaFija = e.target.value; indice = 0; pintar(); });
  $('pp-seg').addEventListener('change', e => { segundos = parseInt(e.target.value, 10) || 15; reiniciarRotacion(); });
  $('pp-fullscreen').addEventListener('click', pantallaCompleta);
  document.querySelector('.tab-btn[data-tab="pantalla-planta"]')?.addEventListener('click', () => { indice = 0; renderPantallaPlanta(); refrescarDatos(); });
  reiniciarRotacion();
  clearInterval(timerDatos);
  timerDatos = setInterval(refrescarDatos, REFRESCO_DATOS_MS);
  renderPantallaPlanta();

  // Enlace directo para el televisor: index.html?pantalla=planta abre esta pestaña al iniciar sesión.
  if(new URLSearchParams(location.search).get('pantalla') === 'planta'){
    document.querySelector('.tab-btn[data-tab="pantalla-planta"]')?.click();
  }
}
