import { DB } from './store.js';
import { areaColor } from './helpers.js';

let fechaActual = new Date().toISOString().slice(0,10);
const HORA_INICIO = 6;  // 6:00 a.m.
const HORA_FIN = 20;    // 8:00 p.m.
const RANGO_MIN = (HORA_FIN - HORA_INICIO) * 60;

function minutosDesde(horaStr){
  if(!horaStr) return null;
  const [h, m] = horaStr.split(':').map(Number);
  return h*60 + m;
}

function pctEnRango(minutos){
  const base = HORA_INICIO * 60;
  const clamped = Math.max(base, Math.min(minutos, HORA_FIN*60));
  return ((clamped - base) / RANGO_MIN) * 100;
}

export function renderCalendario(){
  document.getElementById('cal-fecha').value = fechaActual;

  const registrosDelDia = DB.produccion.filter(r => r.fecha === fechaActual);
  const ahoraMin = (new Date()).getHours()*60 + (new Date()).getMinutes();
  const esHoy = fechaActual === new Date().toISOString().slice(0,10);

  // máquinas conocidas (todas, aunque no tengan registros hoy) + "Trabajo manual"
  const nombresMaquinas = DB.maquinas.filter(m=>m.activo!==false).map(m=>m.nombre);
  const usados = new Set(registrosDelDia.map(r => r.maquina || 'Trabajo manual'));
  usados.forEach(u => { if(!nombresMaquinas.includes(u)) nombresMaquinas.push(u); });

  const cont = document.getElementById('cal-timeline');
  if(!registrosDelDia.length){
    cont.innerHTML = '<p class="card-hint">Sin actividad registrada este día.</p>';
  } else {
    const horasMarcas = [];
    for(let h = HORA_INICIO; h <= HORA_FIN; h += 2) horasMarcas.push(h + ':00');
    let html = `<div class="cal-hours">${horasMarcas.map(h=>`<span>${h}</span>`).join('')}</div>`;

    nombresMaquinas.forEach(maq => {
      const recs = registrosDelDia.filter(r => (r.maquina || 'Trabajo manual') === maq);
      let barrasHtml = '';
      if(recs.length){
        barrasHtml = recs.map(r => {
          const ini = minutosDesde(r.horaIni);
          let fin = minutosDesde(r.horaFin);
          const enCurso = fin === null;
          if(enCurso) fin = esHoy ? ahoraMin : HORA_FIN*60;
          if(ini === null || fin === null) return '';
          const left = pctEnRango(ini);
          const width = Math.max(1.2, pctEnRango(fin) - left);
          const color = areaColor(r.area);
          const opp = r.opp && /^\d+-\d+$/.test(r.opp) ? r.opp : null;
          const label = `${opp ? opp+' · ' : (r.orden ? 'Orden '+r.orden+' · ' : '')}${r.actividad || r.area || ''}`;
          const titulo = `${r.operario || ''} · ${r.horaIni || ''}–${r.horaFin || 'en curso'} · ${label}`;
          return `<div class="cal-bar ${enCurso?'en-curso':''}" style="left:${left}%;width:${width}%;background:${color}" title="${titulo.replace(/"/g,'')}">${label}</div>`;
        }).join('');
      }
      html += `<div class="cal-row">
        <div class="cal-row-label">${maq}</div>
        <div class="cal-row-track">${barrasHtml}</div>
      </div>`;
    });
    cont.innerHTML = html;
  }

  const areasPresentes = [...new Set(registrosDelDia.map(r=>r.area).filter(Boolean))];
  document.getElementById('cal-legend').innerHTML = areasPresentes.map(a =>
    `<span><i style="background:${areaColor(a)}"></i>${a}</span>`
  ).join('') + '<span><i style="background:#888;background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.4) 0 4px,transparent 4px 8px)"></i>En curso ahora</span>';
}

export function initCalendario(){
  document.getElementById('cal-fecha').addEventListener('change', (e) => {
    fechaActual = e.target.value;
    renderCalendario();
  });
  document.getElementById('cal-hoy').addEventListener('click', () => {
    fechaActual = new Date().toISOString().slice(0,10);
    renderCalendario();
  });
  document.getElementById('cal-prev').addEventListener('click', () => {
    const d = new Date(fechaActual); d.setDate(d.getDate()-1);
    fechaActual = d.toISOString().slice(0,10);
    renderCalendario();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    const d = new Date(fechaActual); d.setDate(d.getDate()+1);
    fechaActual = d.toISOString().slice(0,10);
    renderCalendario();
  });
  renderCalendario();
}
