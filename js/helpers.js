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
  agregarBotonExcelVentana(w, titulo);
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

// ---------- Exportar a Excel CUALQUIER tabla en pantalla ----------
// Pedido 22sep26: "que todos los informes del aplicativo puedan ser
// exportados a Excel". En vez de escribir un exportador a mano por cada
// pantalla (como exportarExcel de arriba), esto lee la tabla tal como se
// ve — mismas columnas y filtros que la usuaria tiene aplicados — y la
// convierte en hoja de Excel. Los montos ("$1.234.567") y cantidades
// ("12,5") se pasan como NÚMEROS, para que se puedan sumar en Excel.

function textoCelda(td){
  const campos = td.querySelectorAll('input, select, textarea');
  if(campos.length){
    return [...campos].map(c => c.tagName === 'SELECT' ? (c.options[c.selectedIndex]?.text || '') : (c.type === 'checkbox' ? (c.checked ? 'Sí' : '') : c.value)).join(' ').trim();
  }
  const copia = td.cloneNode(true);
  copia.querySelectorAll('button, canvas, script').forEach(b => b.remove());
  return (copia.textContent || '').replace(/\s+/g, ' ').trim();
}

function valorExcel(texto){
  if(texto === '—') return '';
  if(texto === '') return texto;
  const t = texto.replace(/\s/g, '');
  // "007" o un código con cero adelante se deja como texto
  if(/^0\d/.test(t)) return texto;
  if(/^-?\$?-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^-?\$?-?\d+(,\d+)?$/.test(t)){
    const n = parseFloat(t.replace(/\$/g, '').replace(/\./g, '').replace(',', '.'));
    if(!isNaN(n)) return n;
  }
  return texto;
}

// Filas (array de arrays) de una <table>, encabezado incluido. Se saltan
// las filas "Sin datos…", las filas de edición en línea y las columnas que
// solo tienen botones (quedan vacías).
export function tablaAFilas(tabla){
  const filas = [];
  const agregar = (tr, esEncabezado) => {
    if(tr.style.display === 'none' || tr.classList.contains('rep-edit-row')) return;
    const celdas = [...tr.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH');
    if(!esEncabezado && celdas.length === 1 && (celdas[0].colSpan||1) > 1) return; // "Sin datos…"
    const fila = [];
    celdas.forEach(c => {
      const txt = textoCelda(c);
      fila.push(esEncabezado ? txt : valorExcel(txt));
      for(let i = 1; i < (c.colSpan||1); i++) fila.push('');
    });
    filas.push(fila);
  };
  const thead = tabla.tHead;
  if(thead) [...thead.rows].forEach(tr => agregar(tr, true));
  [...tabla.tBodies].forEach(tb => [...tb.rows].forEach(tr => agregar(tr, !thead && filas.length === 0)));
  if(tabla.tFoot) [...tabla.tFoot.rows].forEach(tr => agregar(tr, false));
  if(!filas.length) return filas;
  const nCols = Math.max(...filas.map(f => f.length));
  const colsConDatos = [];
  for(let c = 0; c < nCols; c++){
    if(filas.some(f => f[c] !== '' && f[c] != null)) colsConDatos.push(c);
  }
  return filas.map(f => colsConDatos.map(c => f[c] ?? ''));
}

function nombreHojaUnico(nombre, usados){
  const base = String(nombre || 'Hoja').replace(/[\\\/\?\*\[\]:]/g, ' ').trim().slice(0, 28) || 'Hoja';
  let n = base, i = 2;
  while(usados.has(n.toLowerCase())) n = base.slice(0, 26) + ' ' + (i++);
  usados.add(n.toLowerCase());
  return n;
}

// tablas: [{ nombre, tabla }] — una hoja por tabla.
export function exportarTablasExcel(nombreArchivo, tablas){
  const wb = XLSX.utils.book_new();
  const usados = new Set();
  let hojas = 0;
  tablas.forEach(({ nombre, tabla }) => {
    const filas = tablaAFilas(tabla);
    if(filas.length <= 1 && tablas.length > 1) return; // tabla vacía (solo encabezado)
    const ws = XLSX.utils.aoa_to_sheet(filas.length ? filas : [['Sin datos']]);
    if(filas[0]) ws['!cols'] = filas[0].map((_, c) => ({ wch: Math.min(45, Math.max(8, ...filas.map(f => String(f[c] ?? '').length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, nombreHojaUnico(nombre, usados));
    hojas++;
  });
  if(!hojas){ toast('No hay datos en pantalla para exportar'); return; }
  XLSX.writeFile(wb, nombreArchivo);
}

function slugArchivo(s){
  return String(s || 'informe').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50) || 'informe';
}

// Título que antecede a una tabla (h1-h4 más cercano hacia arriba, o el
// título de su tarjeta) — para nombrar la hoja de Excel.
function tituloDeTabla(tabla, porDefecto){
  const conNombre = tabla.closest('[data-excel-nombre]');
  if(conNombre) return conNombre.dataset.excelNombre;
  let el = tabla;
  while(el){
    let prev = el.previousElementSibling;
    while(prev){
      const h = prev.matches('h1,h2,h3,h4') ? prev : prev.querySelector('h1,h2,h3,h4');
      if(h && h.textContent.trim()) return h.textContent.trim();
      prev = prev.previousElementSibling;
    }
    el = el.parentElement;
    if(el && el.classList && el.classList.contains('card')){
      const h = el.querySelector(':scope > .card-head h3');
      if(h) return h.textContent.trim();
    }
  }
  return porDefecto;
}

// Botón "⬇ Descargar en Excel" dentro de una ventana de impresión (la que
// abre imprimirInforme o cualquier "🖨 Imprimir"): exporta todas las
// tablas de esa ventana, una hoja por tabla. No sale en el papel impreso.
export function agregarBotonExcelVentana(w, titulo){
  try{
    const d = w.document;
    const estilo = d.createElement('style');
    estilo.textContent = '@media print{ .no-print{ display:none !important; } } .no-print{ margin:0 0 12px; } .no-print button{ font:inherit; padding:6px 12px; cursor:pointer; }';
    d.head.appendChild(estilo);
    const barra = d.createElement('div');
    barra.className = 'no-print';
    const btn = d.createElement('button');
    btn.type = 'button';
    btn.textContent = '⬇ Descargar en Excel';
    btn.addEventListener('click', () => {
      const tablas = [...d.querySelectorAll('table')].map((t, i) => ({ nombre: tituloDeTabla(t, 'Hoja ' + (i+1)), tabla: t }));
      exportarTablasExcel(`LitoColor_${slugArchivo(titulo || d.title)}_${fechaHoyLocal()}.xlsx`, tablas);
    });
    barra.appendChild(btn);
    d.body.insertBefore(barra, d.body.firstChild);
  }catch(err){
    console.error('No se pudo agregar el botón de Excel a la ventana de impresión:', err);
  }
}

// Agrega un botón "⬇ Excel" a cada tarjeta (.card) que tenga una tabla y
// que todavía no tenga su propio botón de Excel. Se llama una vez al
// arrancar (app.js). Las tarjetas que son formularios de captura (no
// informes) se excluyen con data-no-excel. Las pestañas que un rol no ve
// siguen ocultas, así que esto no cambia ningún permiso.
const RE_BOTON_EXCEL = /excel|xlsx/i;
export function activarExcelEnTarjetas(raiz){
  const base = raiz || document;
  base.querySelectorAll('.tab-panel .card').forEach(card => {
    if(card.dataset.excelListo) return;
    if(card.closest('[data-no-excel]')) return;
    if(!card.querySelector('table') && !card.hasAttribute('data-excel')) return;
    // si la tarjeta "padre" ya exporta (la contiene), no repetir botón
    const padre = card.parentElement && card.parentElement.closest('.card');
    if(padre && (padre.dataset.excelListo || [...padre.querySelectorAll('button')].some(b => RE_BOTON_EXCEL.test(b.textContent)))) return;
    if([...card.querySelectorAll('button')].some(b => RE_BOTON_EXCEL.test(b.textContent))) return;
    card.dataset.excelListo = '1';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row-btn btn-excel-auto';
    btn.textContent = '⬇ Excel';
    btn.title = 'Descargar esta tabla en Excel (con los filtros que tengas aplicados)';
    btn.addEventListener('click', () => {
      const tituloCard = (card.querySelector('.card-head h3')?.textContent || 'informe').trim();
      const tablas = [...card.querySelectorAll('table')]
        .filter(t => !t.closest('[data-no-excel]') && t.offsetParent !== null)
        .map((t, i, arr) => ({ nombre: arr.length > 1 ? tituloDeTabla(t, tituloCard + ' ' + (i+1)) : tituloCard, tabla: t }));
      if(!tablas.length){ toast('No hay datos en pantalla para exportar'); return; }
      exportarTablasExcel(`LitoColor_${slugArchivo(tituloCard)}_${fechaHoyLocal()}.xlsx`, tablas);
    });

    const head = card.querySelector(':scope > .card-head');
    if(head){
      btn.style.marginLeft = '8px';
      const hint = head.querySelector(':scope > .card-hint');
      if(hint && hint.querySelector('button')) hint.insertBefore(btn, hint.firstChild);
      else head.appendChild(btn);
    } else {
      btn.style.margin = '0 0 8px';
      card.insertBefore(btn, card.firstChild);
    }
  });
}
