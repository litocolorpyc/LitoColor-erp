import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast, fmtCOP } from './helpers.js';
import { getCurrentUser } from './auth.js';

if(typeof pdfjsLib !== 'undefined'){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ---------- lectura del archivo ----------

// Los PDF que descarga Siigo (documentos "Compra") tienen el texto ya
// seleccionable (no son una imagen escaneada), así que se leen con pdf.js
// directamente en el navegador — sin subir el archivo a ningún servidor.
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
    // Agrupa los fragmentos de texto en líneas "a barrido": los ordena de
    // arriba hacia abajo y agrupa los que caen a menos de 3pt de distancia
    // vertical entre sí — una sola tabla puede tener columnas con la línea
    // base a una fracción de punto de diferencia, y redondear con una
    // rejilla fija a veces parte una misma fila en dos.
    const items = content.items.map(it => ({ x: it.transform[4], y: it.transform[5], str: it.str }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const TOL = 3;
    const lineas = [];
    let actual = [];
    let anclaY = null;
    items.forEach(it => {
      if(anclaY === null || Math.abs(it.y - anclaY) <= TOL){
        actual.push(it);
        if(anclaY === null) anclaY = it.y;
      } else {
        lineas.push(actual);
        actual = [it];
        anclaY = it.y;
      }
    });
    if(actual.length) lineas.push(actual);
    texto += lineas.map(l => l.sort((a,b) => a.x - b.x).map(it => it.str).join(' ')).join('\n') + '\n';
  }
  return texto;
}

function parseMoneyUS(str){
  if(str == null) return 0;
  const n = parseFloat(String(str).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function parsePct(str){
  if(str == null) return 0;
  const n = parseFloat(String(str).replace(/[^\d.]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Busca un número de OP dentro de la descripción de un ítem (ej. "Servicio
// de Planchas / CTP - OP5955-2") para sugerir a qué orden asociarlo — la
// persona igual puede cambiarlo si la sugerencia no es la correcta.
function detectarOrdenEnTexto(texto){
  if(!texto) return null;
  const m = String(texto).match(/OP\s?-?\s?(\d{3,6})/i);
  if(!m) return null;
  return parseInt(m[1], 10);
}

// Intenta reconocer el formato "Compra" que genera Siigo. Si algo no
// calza, simplemente no lo llena — la persona lo completa a mano en la
// tabla de revisión, nunca se guarda nada sin que alguien lo confirme.
function parseCompraTexto(texto){
  const cabecera = { numero_recibo: '', fecha: '', nit: '', tercero: '', total_bruto: null, iva: null, retefuente: null, valor_total: null };

  const mNumero = texto.match(/Compra[\s\S]{0,80}?No\.?\s*(\d+)/i);
  if(mNumero) cabecera.numero_recibo = 'Compra No. ' + mNumero[1];

  const mFechas = texto.match(/(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})/);
  if(mFechas) cabecera.fecha = mFechas[1];
  else {
    const mFecha = texto.match(/(\d{4}-\d{2}-\d{2})/);
    if(mFecha) cabecera.fecha = mFecha[1];
  }

  const mNit = texto.match(/Nit\s+([\d.\-]{6,})\s+Tel[eé]fono/i);
  if(mNit) cabecera.nit = mNit[1].trim();

  const lineaProveedor = texto.split('\n').find(l => /^\s*Proveedor\b/i.test(l));
  if(lineaProveedor){
    const m = lineaProveedor.match(/Proveedor\s+(.+?)(?:\s+Fecha de compra\b.*)?$/i);
    if(m) cabecera.tercero = m[1].trim();
  }

  const mBruto = texto.match(/Total Bruto\s+([\d.,]+)/i);
  if(mBruto) cabecera.total_bruto = parseMoneyUS(mBruto[1]);
  const mIva = texto.match(/IVA\s+[\d.]+\s*%\s+([\d.,]+)/i);
  if(mIva) cabecera.iva = parseMoneyUS(mIva[1]);
  const mRete = texto.match(/Retefuente\s+[\d.]+\s*%\s+([\d.,]+)/i);
  if(mRete) cabecera.retefuente = parseMoneyUS(mRete[1]);
  const mPagar = texto.match(/Total a Pagar\s+([\d.,]+)/i);
  if(mPagar) cabecera.valor_total = parseMoneyUS(mPagar[1]);

  // Filas de la tabla de ítems: N° · Valor desc. · IVA% · Retención% ·
  // Vr. Unitario · Descripción · Cantidad · Vr. Total
  const items = [];
  const filaRegex = /^(\d+)\s+([\d.,]+)\s+(\d+(?:\.\d+)?)\s*%\s+(\d+(?:\.\d+)?)\s*%\s+([\d.,]+)\s+(.+?)\s+([\d.,]+)\s+([\d.,]+)\s*$/;
  texto.split('\n').forEach(linea => {
    const m = linea.trim().match(filaRegex);
    if(!m) return;
    const descripcion = m[6].trim();
    items.push({
      codigo: m[1],
      descripcion,
      valor_unitario: parseMoneyUS(m[5]),
      iva_pct: parseFloat(m[3]),
      retencion_pct: parseFloat(m[4]),
      cantidad: parseMoneyUS(m[7]),
      valor_credito: parseMoneyUS(m[8]), // se usa esta columna como "Vr. Total" del ítem
      valor_debito: 0,
      orden: detectarOrdenEnTexto(descripcion),
      observacion: ''
    });
  });

  return { cabecera, items };
}

// ---------- render de la tabla de revisión ----------
let itemsActuales = [];
let cabeceraTotalesActuales = {};

function opcionesOrden(ordenSeleccionada){
  const activas = DB.opp_ordenes.slice().sort((a,b) => b.orden - a.orden).slice(0, 200);
  return '<option value="">— Ninguna —</option>' +
    activas.map(o => `<option value="${o.orden}"${o.orden===ordenSeleccionada?' selected':''}>${o.orden} — ${o.cliente||''}</option>`).join('');
}

function renderTablaItems(){
  const tbody = document.querySelector('#tbl-recibo-items tbody');
  tbody.innerHTML = itemsActuales.map((it, i) => `
    <tr data-i="${i}">
      <td><input type="text" class="ri-codigo" value="${it.codigo||''}" style="width:36px"></td>
      <td><input type="text" class="ri-desc" value="${it.descripcion||''}" style="width:100%;min-width:160px"></td>
      <td><input type="number" class="ri-cantidad num" value="${it.cantidad||0}" style="width:70px"></td>
      <td><input type="number" class="ri-unitario num" value="${it.valor_unitario||0}" style="width:90px"></td>
      <td><input type="number" class="ri-iva num" value="${it.iva_pct||0}" style="width:55px"></td>
      <td><input type="number" class="ri-reten num" value="${it.retencion_pct||0}" style="width:55px"></td>
      <td><input type="number" class="ri-credito num" value="${it.valor_credito||0}" style="width:100px"></td>
      <td><select class="ri-orden">${opcionesOrden(it.orden)}</select></td>
      <td><input type="text" class="ri-obs" value="${it.observacion||''}" placeholder="opcional" style="width:100%;min-width:120px"></td>
      <td><button type="button" class="row-btn row-btn-danger ri-del">✕</button></td>
    </tr>`).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--ink-faint)">Sin líneas todavía — agrega una manualmente</td></tr>';

  tbody.querySelectorAll('tr').forEach(tr => {
    const i = parseInt(tr.dataset.i, 10);
    if(isNaN(i)) return;
    tr.querySelector('.ri-codigo').addEventListener('input', e => itemsActuales[i].codigo = e.target.value);
    tr.querySelector('.ri-desc').addEventListener('input', e => itemsActuales[i].descripcion = e.target.value);
    tr.querySelector('.ri-cantidad').addEventListener('input', e => { itemsActuales[i].cantidad = parseFloat(e.target.value)||0; actualizarResumen(); });
    tr.querySelector('.ri-unitario').addEventListener('input', e => { itemsActuales[i].valor_unitario = parseFloat(e.target.value)||0; actualizarResumen(); });
    tr.querySelector('.ri-iva').addEventListener('input', e => { itemsActuales[i].iva_pct = parseFloat(e.target.value)||0; actualizarResumen(); });
    tr.querySelector('.ri-reten').addEventListener('input', e => { itemsActuales[i].retencion_pct = parseFloat(e.target.value)||0; actualizarResumen(); });
    tr.querySelector('.ri-credito').addEventListener('input', e => { itemsActuales[i].valor_credito = parseFloat(e.target.value)||0; actualizarResumen(); });
    tr.querySelector('.ri-orden').addEventListener('change', e => itemsActuales[i].orden = e.target.value ? parseInt(e.target.value,10) : null);
    tr.querySelector('.ri-obs').addEventListener('input', e => itemsActuales[i].observacion = e.target.value);
    tr.querySelector('.ri-del').addEventListener('click', () => { itemsActuales.splice(i,1); renderTablaItems(); actualizarResumen(); });
  });
}

function actualizarResumen(){
  const hint = document.getElementById('recibo-total-hint');
  if(!hint) return;
  const totalItems = itemsActuales.reduce((s,it)=>s+(it.valor_credito||0),0);
  const baseAprox = itemsActuales.reduce((s,it)=>s+((it.valor_unitario||0)*(it.cantidad||0)),0);
  const conOrden = itemsActuales.filter(it => it.orden).length;
  hint.innerHTML = `Total de líneas: ${fmtCOP(totalItems)} · Base aprox. (unitario × cantidad): ${fmtCOP(baseAprox)}`
    + (conOrden ? ` · ${conOrden}/${itemsActuales.length} línea(s) con orden asociada` : '');
}

// ---------- flujo principal ----------
async function manejarArchivo(file){
  const hint = document.getElementById('recibo-file-hint');
  document.getElementById('recibo-review').style.display = '';

  if(file.type === 'application/pdf'){
    hint.textContent = 'Leyendo el PDF…';
    try{
      const texto = await extraerTextoPDF(file);
      const { cabecera, items } = parseCompraTexto(texto);
      document.getElementById('recibo-numero').value = cabecera.numero_recibo;
      document.getElementById('recibo-fecha').value = cabecera.fecha;
      document.getElementById('recibo-nit').value = cabecera.nit;
      document.getElementById('recibo-tercero').value = cabecera.tercero;
      itemsActuales = items;
      cabeceraTotalesActuales = cabecera;
      const conOrden = items.filter(it => it.orden).length;
      const yaCargado = cabecera.numero_recibo && DB.recibos_caja.some(r => r.numero_recibo === cabecera.numero_recibo);
      const avisoDuplicado = yaCargado ? ` ⚠️ Este documento (${cabecera.numero_recibo}) ya se había cargado antes — revisa que no sea un duplicado.` : '';
      hint.textContent = (items.length
        ? `Se leyeron ${items.length} línea(s) automáticamente${conOrden ? ` (${conOrden} con orden sugerida por el número de OP)` : ''} — revisa que estén correctas antes de guardar.`
        : 'No se pudieron reconocer líneas automáticamente en este PDF — agrégalas manualmente abajo.') + avisoDuplicado;
      if(yaCargado) toast('Este documento ya se había cargado antes — revisa que no sea un duplicado');
    }catch(err){
      console.error(err);
      hint.textContent = 'No se pudo leer el PDF automáticamente — completa los datos manualmente abajo.';
      itemsActuales = [];
      cabeceraTotalesActuales = {};
    }
  } else {
    // imagen/foto: por ahora no se lee automático, solo se habilita la captura manual
    hint.textContent = 'Es una imagen — no se puede leer sola todavía. Completa los datos manualmente abajo.';
    itemsActuales = [];
    cabeceraTotalesActuales = {};
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

  const valorTotal = cabeceraTotalesActuales.valor_total || itemsActuales.reduce((s,it)=>s+(it.valor_credito||0),0);
  const user = getCurrentUser();

  btn.disabled = true; btn.textContent = 'Guardando…';
  try{
    const { data: recibo, error: errRecibo } = await sb.from('recibos_caja').insert([{
      numero_recibo: numero || null, fecha, nit, tercero,
      valor_total: valorTotal || null,
      tipo_documento: 'Compra',
      total_bruto: cabeceraTotalesActuales.total_bruto ?? null,
      iva: cabeceraTotalesActuales.iva ?? null,
      retefuente: cabeceraTotalesActuales.retefuente ?? null,
      archivo_nombre: document.getElementById('recibo-file').files[0]?.name || null,
      cargado_por: user ? user.nombre : null
    }]).select();
    if(errRecibo) throw errRecibo;
    const reciboId = recibo[0].id;

    const payloadItems = itemsActuales.map(it => ({
      recibo_id: reciboId, codigo: it.codigo || null, descripcion: it.descripcion || null,
      cantidad: it.cantidad || null, valor_unitario: it.valor_unitario || null,
      iva_pct: it.iva_pct || null, retencion_pct: it.retencion_pct || null,
      valor_debito: it.valor_debito || 0, valor_credito: it.valor_credito || 0,
      orden: it.orden || null, observacion: it.observacion || null
    }));
    const { error: errItems } = await sb.from('recibos_caja_items').insert(payloadItems);
    if(errItems) throw errItems;

    toast('Documento ' + (numero || reciboId) + ' guardado con ' + payloadItems.length + ' línea(s)');
    DB.recibos_caja.unshift(recibo[0]);

    // limpia el formulario para el próximo documento
    document.getElementById('recibo-file').value = '';
    document.getElementById('recibo-numero').value = '';
    document.getElementById('recibo-fecha').value = '';
    document.getElementById('recibo-nit').value = '';
    document.getElementById('recibo-tercero').value = '';
    itemsActuales = [];
    cabeceraTotalesActuales = {};
    renderTablaItems();
    actualizarResumen();
    document.getElementById('recibo-review').style.display = 'none';
  }catch(err){
    console.error(err);
    toast('Error al guardar el documento — revisa la consola');
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
    itemsActuales.push({ codigo:'', descripcion:'', cantidad:0, valor_unitario:0, iva_pct:0, retencion_pct:0, valor_credito:0, valor_debito:0, orden:null, observacion:'' });
    document.getElementById('recibo-review').style.display = '';
    renderTablaItems();
    actualizarResumen();
  });
  document.getElementById('recibo-guardar').addEventListener('click', guardarRecibo);
}
