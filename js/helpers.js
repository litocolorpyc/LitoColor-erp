// Utilidades compartidas por todos los módulos: formato de números,
// mensajes de confirmación (toast), y el indicador de conexión.

// "YYYY-MM-DD" según el reloj LOCAL del navegador — NO usar
// `new Date().toISOString().slice(0,10)` para esto: esa función da la
// fecha en UTC, que en Colombia (UTC-5) ya cambia de día desde las
// 7:00pm hora local. Si esa fecha se combina con una hora local (como el
// contador de actividades en curso), el resultado queda 24 horas
// adelantado y el contador se congela en 00:00:00 hasta el día siguiente.
export function fechaHoyLocal(fecha){
  const d = fecha || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fmtCOP(n){ if(n==null||isNaN(n)) return '—'; return '$' + Math.round(n).toLocaleString('es-CO'); }
export function fmtNum(n,d){ if(n==null||isNaN(n)) return '—'; return Number(n).toLocaleString('es-CO',{maximumFractionDigits:d==null?1:d}); }

export function toast(msg, duracionMs){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), duracionMs || 2200);
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
  else if(preset === 'todo') return { desde: '2024-01-01', hasta: fin };
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

// Normaliza el nombre de un material para COMPARAR (no para mostrar):
// mismo texto en minúsculas, sin espacios de más, y con el separador
// decimal unificado a punto. Se necesita porque el catálogo de "Materias
// primas" usa coma decimal ("1,5 mm") pero el campo "Papel" de las piezas
// de una orden a veces se tipeó con punto ("1.5 mm") al importarlas desde
// Excel — mismo material, texto distinto, y antes de esto una comparación
// exacta (===) los trataba como si no existiera ninguno de los dos en el
// maestro (ver buscarMaterialPorNombre en registrar.js).
export function normNombreMaterial(s){
  return String(s || '').trim().toLowerCase().replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, ' ');
}

// Botones "Ir al principio" / "Ir al final" para tablas largas (muchos
// materiales, movimientos, clientes, etc.) — sin esto, moverse de la
// primera a la última fila (o volver) significa arrastrar la barra de
// scroll a mano. Se usa en varias pantallas; scrollIntoView respeta tanto
// el scroll de toda la página como el de una tabla con su propio
// contenedor (max-height + overflow-y:auto), así que sirve para ambos
// casos sin distinción.
export function wireTableScroll(tablaId, btnInicioId, btnFinalId){
  const tabla = () => document.getElementById(tablaId);
  const btnInicio = document.getElementById(btnInicioId);
  const btnFinal = document.getElementById(btnFinalId);
  if(btnFinal) btnFinal.addEventListener('click', () => {
    const t = tabla();
    const filas = t ? t.querySelectorAll('tbody tr') : [];
    const ultima = filas.length ? filas[filas.length - 1] : t;
    if(ultima) ultima.scrollIntoView({ behavior:'smooth', block:'end' });
  });
  if(btnInicio) btnInicio.addEventListener('click', () => {
    const t = tabla();
    if(t) t.scrollIntoView({ behavior:'smooth', block:'start' });
  });
}

// Imprime un informe genérico (título + subtítulo + una o más tablas) en
// una ventana nueva — mismo patrón que ya usaban por separado Órdenes,
// Remisión y Reprocesos para imprimir; centralizado acá porque de aquí en
// adelante varios módulos más (Gerencial, Producción, Operario, Registrar
// costo, Registrar Venta, Inventario) necesitan la misma mecánica.
// `secciones`: [{ titulo, resumen?, columnas:[{key,label,num?}], filas:[{...}] }]
export function imprimirInforme({ titulo, subtitulo, secciones }){
  const seccionesHTML = (secciones||[]).map(sec => `
    <h2>${sec.titulo}</h2>
    ${sec.resumen ? `<p class="resumen">${sec.resumen}</p>` : ''}
    <table>
      <thead><tr>${sec.columnas.map(c=>`<th${c.num?' class="num"':''}>${c.label}</th>`).join('')}</tr></thead>
      <tbody>${(sec.filas||[]).map(fila => `<tr>${sec.columnas.map(c=>`<td${c.num?' class="num"':''}>${fila[c.key] ?? ''}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${sec.columnas.length}" style="text-align:center">Sin datos</td></tr>`}</tbody>
    </table>`).join('');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${titulo}</title>
<style>
  body{ font-family: Arial, Helvetica, sans-serif; color:#111; margin:20px; }
  h1{ font-size:20px; margin:0 0 2px; } .sub{ color:#444; font-size:13px; margin-bottom:16px; }
  h2{ font-size:15px; margin:18px 0 6px; border-bottom:1px solid #999; padding-bottom:3px; }
  .resumen{ font-size:12.5px; color:#333; margin:0 0 8px; }
  table{ border-collapse:collapse; width:100%; margin-bottom:6px; font-size:12px; }
  td, th{ border:1px solid #ccc; padding:5px 7px; text-align:left; } th{ background:#f2f2f2; }
  .num{ text-align:right; }
  @media print{ body{ margin:10mm; } }
</style></head><body>
  <h1>${titulo}</h1>
  <div class="sub">${subtitulo||''}</div>
  ${seccionesHTML}
</body></html>`;

  const w = window.open('', '_blank');
  if(!w){ toast('El navegador bloqueó la ventana de impresión — permite ventanas emergentes para este sitio'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

export function exportarExcel(nombreArchivo, hojas){
  const wb = XLSX.utils.book_new();
  hojas.forEach(h => {
    const ws = XLSX.utils.json_to_sheet(h.filas);
    XLSX.utils.book_append_sheet(wb, ws, h.nombre.slice(0,31));
  });
  XLSX.writeFile(wb, nombreArchivo);
}
