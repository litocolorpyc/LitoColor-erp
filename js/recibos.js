import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast, fmtCOP } from './helpers.js';
import { getCurrentUser } from './auth.js';

if(typeof pdfjsLib !== 'undefined'){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ---------- lectura del archivo ----------

// Los PDF que exporta Siigo tienen el texto ya seleccionable (no son una
// imagen escaneada), así que se puede leer con pdf.js directamente en el
// navegador — sin subir el archivo a ningún servidor externo.
async function extraerTextoPDF(file){
  if(typeof pdfjsLib === 'undefined'){
    throw new Error('La librería para leer PDF no cargó (revisa tu conexión a internet)');
  }
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  let texto = '';
  for(let i = 1; i <= pdf.numPages; i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // pdf.js entrega los fragmentos de texto con su posición; los agrupamos
    // por línea (misma altura aproximada) para reconstruir las filas de la tabla.
    const porLinea = {};
    content.items.forEach(it => {
      const y = Math.round(it.transform[5]);
      porLinea[y] = porLinea[y] || [];
      porLinea[y].push(it.str);
    });
    const lineas = Object.keys(porLinea).sort((a,b) => b - a).map(y => porLinea[y].join(' '));
    texto += lineas.join('\n') + '\n';
  }
  return texto;
}

function parseMoneyCO(str){
  if(!str) return 0;
  const limpio = String(str).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(limpio);
  return isNaN(n) ? 0 : n;
}

// Intenta reconocer el formato de "Recibos de Caja" de Siigo. Si algo no
// calza, simplemente no lo llena — la persona lo completa a mano en la
// tabla de revisión, nunca se guarda nada sin que alguien lo confirme.
function parseReciboTexto(texto){
  const cabecera = { numero_recibo: '', fecha: '', nit: '', tercero: '' };

  const mNumero = texto.match(/R\s*-\s*\d{3}\s*-\s*\d{3}/);
  if(mNumero) cabecera.numero_recibo = mNumero[0].replace(/\s+/g, '');

  const mFecha = texto.match(/(\d{4}-\d{2}-\d{2})/);
  if(mFecha) cabecera.fecha = mFecha[1];

  const mNit = texto.match(/NIT[:\s]*([\d.,\-]{6,})/i);
  if(mNit) cabecera.nit = mNit[1].trim();

  const mTercero = texto.match(/Señores\s+(.+)/i);
  if(mTercero) cabecera.tercero = mTercero[1].trim();

  // Filas de la tabla: un código contable (7 a 10 dígitos) al inicio de la
  // línea, seguido de la descripción, y terminando en dos valores en pesos
  // (débito y crédito). Todo lo demás de la línea se ignora (la columna
  // "Comprobante" normalmente viene vacía, marcada como "- -").
  const items = [];
  const filaRegex = /^(\d{7,10})\s+(.+?)\s+([\d.,]+)\s+([\d.,]+)\s*$/;
  texto.split('\n').forEach(linea => {
    const m = linea.trim().match(filaRegex);
    if(!m) return;
    items.push({
      codigo: m[1],
      descripcion: m[2].replace(/\s*-\s*-\s*$/, '').trim(),
      valor_debito: parseMoneyCO(m[3]),
      valor_credito: parseMoneyCO(m[4]),
      orden: null,
      observacion: ''
    });
  });

  return { cabecera, items };
}

// ---------- detectar impuestos/retenciones por palabra clave ----------
function analizarImpuestos(items){
  const patron = /retenci|impuesto|iva\b/i;
  const impuestos = items.filter(it => patron.test(it.descripcion || ''));
  const totalImpuestos = impuestos.reduce((s,it) => s + (it.valor_debito||0) + (it.valor_credito||0), 0);
  const totalGeneral = items.reduce((s,it) => s + (it.valor_debito||0) + (it.valor_credito||0), 0);
  return { totalImpuestos, costoBase: totalGeneral - totalImpuestos, cantidadDetectados: impuestos.length };
}

// ---------- render de la tabla de revisión ----------
let itemsActuales = [];

function opcionesOrden(ordenSeleccionada){
  const activas = DB.opp_ordenes.slice().sort((a,b) => b.orden - a.orden).slice(0, 200);
  return '<option value="">— Ninguna —</option>' +
    activas.map(o => `<option value="${o.orden}"${o.orden===ordenSeleccionada?' selected':''}>${o.orden} — ${o.cliente||''}</option>`).join('');
}

function renderTablaItems(){
  const tbody = document.querySelector('#tbl-recibo-items tbody');
  tbody.innerHTML = itemsActuales.map((it, i) => `
    <tr data-i="${i}">
      <td><input type="text" class="ri-codigo" value="${it.codigo||''}" style="width:90px"></td>
      <td><input type="text" class="ri-desc" value="${it.descripcion||''}" style="width:100%"></td>
      <td><input type="number" class="ri-debito num" value="${it.valor_debito||0}" style="width:110px"></td>
      <td><input type="number" class="ri-credito num" value="${it.valor_credito||0}" style="width:110px"></td>
      <td><select class="ri-orden">${opcionesOrden(it.orden)}</select></td>
      <td><input type="text" class="ri-obs" value="${it.observacion||''}" placeholder="opcional" style="width:100%"></td>
      <td><button type="button" class="row-btn row-btn-danger ri-del">✕</button></td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--ink-faint)">Sin líneas todavía — agrega una manualmente</td></tr>';

  tbody.querySelectorAll('tr').forEach(tr => {
    const i = parseInt(tr.dataset.i, 10);
    tr.querySelector('.ri-codigo').addEventListener('input', e => itemsActuales[i].codigo = e.target.value);
    tr.querySelector('.ri-desc').addEventListener('input', e => itemsActuales[i].descripcion = e.target.value);
    tr.querySelector('.ri-debito').addEventListener('input', e => { itemsActuales[i].valor_debito = parseFloat(e.target.value)||0; actualizarResumen(); });
    tr.querySelector('.ri-credito').addEventListener('input', e => { itemsActuales[i].valor_credito = parseFloat(e.target.value)||0; actualizarResumen(); });
    tr.querySelector('.ri-orden').addEventListener('change', e => itemsActuales[i].orden = e.target.value ? parseInt(e.target.value,10) : null);
    tr.querySelector('.ri-obs').addEventListener('input', e => itemsActuales[i].observacion = e.target.value);
    tr.querySelector('.ri-del').addEventListener('click', () => { itemsActuales.splice(i,1); renderTablaItems(); actualizarResumen(); });
  });
}

function actualizarResumen(){
  const hint = document.getElementById('recibo-total-hint');
  if(!hint) return;
  const { totalImpuestos, costoBase, cantidadDetectados } = analizarImpuestos(itemsActuales);
  const totalDebito = itemsActuales.reduce((s,it)=>s+(it.valor_debito||0),0);
  const totalCredito = itemsActuales.reduce((s,it)=>s+(it.valor_credito||0),0);
  hint.innerHTML = `Total débito: ${fmtCOP(totalDebito)} · Total crédito: ${fmtCOP(totalCredito)}`
    + (cantidadDetectados ? ` · Impuestos/retenciones detectados (${cantidadDetectados}): ${fmtCOP(totalImpuestos)} · Costo base: ${fmtCOP(costoBase)}` : '');
}

// ---------- flujo principal ----------
async function manejarArchivo(file){
  const hint = document.getElementById('recibo-file-hint');
  document.getElementById('recibo-review').style.display = '';

  if(file.type === 'application/pdf'){
    hint.textContent = 'Leyendo el PDF…';
    try{
      const texto = await extraerTextoPDF(file);
      const { cabecera, items } = parseReciboTexto(texto);
      document.getElementById('recibo-numero').value = cabecera.numero_recibo;
      document.getElementById('recibo-fecha').value = cabecera.fecha;
      document.getElementById('recibo-nit').value = cabecera.nit;
      document.getElementById('recibo-tercero').value = cabecera.tercero;
      itemsActuales = items;
      hint.textContent = items.length
        ? `Se leyeron ${items.length} línea(s) automáticamente — revisa que estén correctas antes de guardar.`
        : 'No se pudieron reconocer líneas automáticamente en este PDF — agrégalas manualmente abajo.';
    }catch(err){
      console.error(err);
      hint.textContent = 'No se pudo leer el PDF automáticamente — completa los datos manualmente abajo.';
      itemsActuales = [];
    }
  } else {
    // imagen/foto: por ahora no se lee automático, solo se habilita la captura manual
    hint.textContent = 'Es una imagen — no se puede leer sola todavía. Completa los datos manualmente abajo.';
    itemsActuales = [];
  }
  renderTablaItems();
  actualizarResumen();
}

async function guardarRecibo(){
  const btn = document.getElementById('recibo-guardar');
  const numero = document.getElementById('recibo-numero').value.trim();
  const fecha = document.getElementById('recibo-fecha').value || null;
  const nit = document.getElementById('recibo-nit').value.trim() || null;
  const tercero = document.getElementById('recibo-tercero').value.trim() || null;

  if(!itemsActuales.length){ toast('Agrega al menos una línea antes de guardar'); return; }

  const valorTotal = itemsActuales.reduce((s,it)=>s+(it.valor_debito||0)+(it.valor_credito||0),0) / 2;
  const user = getCurrentUser();

  btn.disabled = true; btn.textContent = 'Guardando…';
  try{
    const { data: recibo, error: errRecibo } = await sb.from('recibos_caja').insert([{
      numero_recibo: numero || null, fecha, nit, tercero,
      valor_total: valorTotal || null,
      archivo_nombre: document.getElementById('recibo-file').files[0]?.name || null,
      cargado_por: user ? user.nombre : null
    }]).select();
    if(errRecibo) throw errRecibo;
    const reciboId = recibo[0].id;

    const payloadItems = itemsActuales.map(it => ({
      recibo_id: reciboId, codigo: it.codigo || null, descripcion: it.descripcion || null,
      valor_debito: it.valor_debito || 0, valor_credito: it.valor_credito || 0,
      orden: it.orden || null, observacion: it.observacion || null
    }));
    const { error: errItems } = await sb.from('recibos_caja_items').insert(payloadItems);
    if(errItems) throw errItems;

    toast('Recibo ' + (numero || reciboId) + ' guardado con ' + payloadItems.length + ' línea(s)');
    DB.recibos_caja.unshift(recibo[0]);

    // limpia el formulario para el próximo recibo
    document.getElementById('recibo-file').value = '';
    document.getElementById('recibo-numero').value = '';
    document.getElementById('recibo-fecha').value = '';
    document.getElementById('recibo-nit').value = '';
    document.getElementById('recibo-tercero').value = '';
    itemsActuales = [];
    renderTablaItems();
    actualizarResumen();
    document.getElementById('recibo-review').style.display = 'none';
  }catch(err){
    console.error(err);
    toast('Error al guardar el recibo — revisa la consola');
  }finally{
    btn.disabled = false; btn.textContent = 'Guardar recibo';
  }
}

export function initRecibosCaja(){
  const fileInput = document.getElementById('recibo-file');
  if(!fileInput) return; // esta tarjeta no existe en esta página, no hay nada que conectar
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if(file) manejarArchivo(file);
  });
  document.getElementById('recibo-add-item').addEventListener('click', () => {
    itemsActuales.push({ codigo:'', descripcion:'', valor_debito:0, valor_credito:0, orden:null, observacion:'' });
    document.getElementById('recibo-review').style.display = '';
    renderTablaItems();
    actualizarResumen();
  });
  document.getElementById('recibo-guardar').addEventListener('click', guardarRecibo);
}
