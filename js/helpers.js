// Utilidades compartidas por todos los módulos: formato de números,
// mensajes de confirmación (toast), y el indicador de conexión.

export function fmtCOP(n){ if(n==null||isNaN(n)) return '—'; return '$' + Math.round(n).toLocaleString('es-CO'); }
export function fmtNum(n,d){ if(n==null||isNaN(n)) return '—'; return Number(n).toLocaleString('es-CO',{maximumFractionDigits:d==null?1:d}); }

export function toast(msg){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

export function setNote(msg, isError){
  const el = document.getElementById('data-note');
  if(!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'var(--bad)' : '';
}

export const AREA_COLORS = {
  'Litografia': '#185FA5', 'Diseño':'#3C3489', 'Impresión Digital':'#3C3489',
  'Guillotina':'#854F0B', 'Troquelado':'#BA7517', 'Plastificado':'#0F6E56',
  'Engomadora':'#993556', 'Terminado':'#D85A30', 'General':'#5F5E5A'
};
export function areaColor(a){ return AREA_COLORS[a] || '#5F5E5A'; }

// Rangos de fecha rápidos, usados en Gerencial/Producción.
export function rangoFechas(preset){
  const hoy = new Date();
  const fin = hoy.toISOString().slice(0,10);
  const d = new Date(hoy);
  if(preset === 'hoy'){ /* desde = hoy */ }
  else if(preset === '7d') d.setDate(d.getDate()-7);
  else if(preset === '30d') d.setDate(d.getDate()-30);
  else if(preset === 'mes') d.setDate(1);
  else if(preset === 'trimestre') d.setMonth(d.getMonth()-3);
  else if(preset === 'anio') d.setMonth(0, 1);
  else if(preset === 'todo') return { desde: '2000-01-01', hasta: fin };
  const desde = d.toISOString().slice(0,10);
  return { desde, hasta: fin };
}

// Para comparar "este periodo" contra "el periodo inmediatamente anterior"
// de la misma duración (ej. estos 30 días vs los 30 días antes de esos).
export function rangoAnterior(desde, hasta){
  const dDesde = new Date(desde), dHasta = new Date(hasta);
  const dias = Math.max(1, Math.round((dHasta - dDesde) / 86400000) + 1);
  const nuevaHasta = new Date(dDesde); nuevaHasta.setDate(nuevaHasta.getDate()-1);
  const nuevaDesde = new Date(nuevaHasta); nuevaDesde.setDate(nuevaDesde.getDate()-dias+1);
  return { desde: nuevaDesde.toISOString().slice(0,10), hasta: nuevaHasta.toISOString().slice(0,10) };
}

export function deltaBadge(actual, anterior){
  if(anterior === null || anterior === undefined) return '';
  if(anterior === 0){
    if(actual > 0) return '<span class="delta-badge up">nuevo</span>';
    return '';
  }
  const pct = ((actual - anterior) / anterior) * 100;
  const up = pct >= 0;
  return `<span class="delta-badge ${up?'up':'down'}">${up?'↑':'↓'} ${Math.abs(pct).toFixed(0)}%</span>`;
}

export function exportarExcel(nombreArchivo, hojas){
  const wb = XLSX.utils.book_new();
  hojas.forEach(h => {
    const ws = XLSX.utils.json_to_sheet(h.filas);
    XLSX.utils.book_append_sheet(wb, ws, h.nombre.slice(0,31));
  });
  XLSX.writeFile(wb, nombreArchivo);
}
