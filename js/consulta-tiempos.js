import { DB } from './store.js';
import { fmtNum, rangoFechas, toast, agregarBotonExcelVentana, etiquetaOrden } from './helpers.js';

// Pedido 16sep26: saber, por rango de fechas y por operario (uno, varios o
// todos), cuántos registros de tiempos hizo cada uno por orden — e
// imprimirlo. Es una consulta de solo lectura sobre DB.produccion (ya
// cargado en memoria al abrir la app, no hace falta pedirle nada nuevo a
// Supabase).

function enRango(fecha, desde, hasta){
  if(!fecha) return false;
  const f = fecha.slice(0,10);
  return f >= desde && f <= hasta;
}

// Mismo criterio que populateOperarioSelect en dashboard.js: el personal
// activo, más cualquier nombre que ya tenga registros (para no perder de
// la lista a alguien que ya no está activo pero sí tiene historial en el
// rango que se está consultando).
function operariosDisponibles(){
  const nombres = new Set(DB.personal.filter(p => p.activo).map(p => p.nombre));
  DB.produccion.forEach(r => { if(r.operario) nombres.add(r.operario); });
  return Array.from(nombres).sort();
}

function renderListaOperarios(){
  const cont = document.getElementById('ct-operarios-lista');
  if(!cont) return;
  const nombres = operariosDisponibles();
  cont.innerHTML = nombres.length
    ? nombres.map(n => `<label style="display:inline-flex;align-items:center;gap:4px;font-weight:normal"><input type="checkbox" class="ct-op-check" value="${n}" checked> ${n}</label>`).join('')
    : '<span class="card-hint">No hay operarios con registros todavía</span>';
  cont.querySelectorAll('.ct-op-check').forEach(cb => cb.addEventListener('change', sincronizarCheckTodos));
}

function sincronizarCheckTodos(){
  const checks = Array.from(document.querySelectorAll('.ct-op-check'));
  document.getElementById('ct-operario-todos').checked = checks.length > 0 && checks.every(c => c.checked);
}

function operariosSeleccionados(){
  return Array.from(document.querySelectorAll('.ct-op-check:checked')).map(c => c.value);
}

function clienteDeOrden(orden){
  const o = DB.opp_ordenes.find(o => o.orden === orden);
  return o ? (o.cliente || '') : '';
}

// Arma las filas del resultado: una fila por (operario, orden) con su
// conteo de registros y horas, y una fila de subtotal al cierre de cada
// operario — ordenado por operario (alfabético) y, dentro de cada uno, por
// cantidad de registros (de mayor a menor).
function consultar(){
  const desde = document.getElementById('ct-desde').value;
  const hasta = document.getElementById('ct-hasta').value;
  const hint = document.getElementById('ct-hint');
  if(!desde || !hasta){ hint.textContent = 'Elegí un rango de fechas (Desde y Hasta) antes de consultar'; return null; }
  const seleccionados = new Set(operariosSeleccionados());
  if(!seleccionados.size){ hint.textContent = 'Elegí al menos un operario'; return null; }

  const registros = DB.produccion.filter(r =>
    r.operario && seleccionados.has(r.operario) && r.orden != null && enRango(r.fecha, desde, hasta)
  );

  const porOperario = new Map();
  registros.forEach(r => {
    if(!porOperario.has(r.operario)) porOperario.set(r.operario, new Map());
    const porOrden = porOperario.get(r.operario);
    if(!porOrden.has(r.orden)) porOrden.set(r.orden, { orden: r.orden, registros: 0, horas: 0 });
    const acc = porOrden.get(r.orden);
    acc.registros++;
    acc.horas += (r.tiempoHr || 0);
  });

  const filas = [];
  Array.from(porOperario.keys()).sort((a,b) => a.localeCompare(b)).forEach(operario => {
    const ordenes = Array.from(porOperario.get(operario).values()).sort((a,b) => b.registros - a.registros);
    let totalRegistros = 0, totalHoras = 0;
    ordenes.forEach(o => {
      filas.push({ operario, orden: o.orden, cliente: clienteDeOrden(o.orden), registros: o.registros, horas: o.horas, esSubtotal: false });
      totalRegistros += o.registros;
      totalHoras += o.horas;
    });
    filas.push({ operario, registros: totalRegistros, horas: totalHoras, esSubtotal: true });
  });

  hint.textContent = `${registros.length} registro(s) en total, del ${desde} al ${hasta}`;
  return { desde, hasta, filas, totalGeneral: registros.length };
}

function filaHTML(f){
  return f.esSubtotal
    ? `<tr style="font-weight:600;background:var(--paper)"><td colspan="3">Total ${f.operario}</td><td class="num">${f.registros}</td><td class="num">${fmtNum(f.horas,1)}</td></tr>`
    : `<tr><td>${f.operario}</td><td>${etiquetaOrden(f.orden)}</td><td>${f.cliente || '—'}</td><td class="num">${f.registros}</td><td class="num">${fmtNum(f.horas,1)}</td></tr>`;
}

function renderResultado(data){
  const tbody = document.querySelector('#tbl-ct-resultado tbody');
  if(!tbody) return;
  if(!data || !data.filas.length){
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">Sin registros en ese rango para los operarios elegidos</td></tr>';
    return;
  }
  tbody.innerHTML = data.filas.map(filaHTML).join('');
}

let ultimaConsulta = null;

function imprimirResultado(){
  if(!ultimaConsulta || !ultimaConsulta.filas.length){
    toast('Primero haz clic en "Consultar" (y que tenga resultados) antes de imprimir');
    return;
  }
  const { desde, hasta, filas, totalGeneral } = ultimaConsulta;
  const operariosTxt = operariosSeleccionados().length === operariosDisponibles().length
    ? 'Todos'
    : operariosSeleccionados().join(', ');
  const filasHTML = filas.map(filaHTML).join('');
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Registros de tiempos por operario y orden</title>
<style>
  body{ font-family: Arial, Helvetica, sans-serif; color:#111; margin:20px; }
  h1{ font-size:18px; margin:0 0 4px; }
  .sub{ color:#444; font-size:12px; margin-bottom:14px; }
  table{ border-collapse:collapse; width:100%; font-size:12px; }
  td, th{ border:1px solid #ccc; padding:4px 6px; text-align:left; }
  th{ background:#f2f2f2; }
  .num{ text-align:right; }
</style>
</head><body>
  <h1>Registros de tiempos por operario y orden</h1>
  <div class="sub">Del ${desde} al ${hasta} · Operario(s): ${operariosTxt} · Total: ${totalGeneral} registro(s)</div>
  <table>
    <thead><tr><th>Operario</th><th>Orden</th><th>Cliente</th><th class="num">Registros</th><th class="num">Horas</th></tr></thead>
    <tbody>${filasHTML}</tbody>
  </table>
</body></html>`;
  const w = window.open('', '_blank');
  if(!w){ toast('El navegador bloqueó la ventana de impresión — permite ventanas emergentes para este sitio'); return; }
  w.document.write(html);
  w.document.close();
  agregarBotonExcelVentana(w, w.document.title);
  w.focus();
  setTimeout(() => w.print(), 300);
}

export function renderConsultaTiempos(){
  renderListaOperarios();
}

export function initConsultaTiempos(){
  const btn = document.getElementById('ct-consultar');
  if(!btn) return; // esta tarjeta no existe para este rol/página
  renderListaOperarios();

  document.getElementById('ct-operario-todos').addEventListener('change', e => {
    document.querySelectorAll('.ct-op-check').forEach(cb => cb.checked = e.target.checked);
  });
  btn.addEventListener('click', () => { ultimaConsulta = consultar(); renderResultado(ultimaConsulta); });
  document.getElementById('ct-imprimir').addEventListener('click', imprimirResultado);

  // Rango por defecto: este mes, mismo preset que usa el resto de la app.
  const { desde, hasta } = rangoFechas('mes');
  document.getElementById('ct-desde').value = desde;
  document.getElementById('ct-hasta').value = hasta;
}
