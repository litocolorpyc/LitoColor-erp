import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast, fmtCOP, fechaHoyLocal } from './helpers.js';
import { getCurrentUser } from './auth.js';
import { renderMovimientosRecientes, renderResumenCostosMes } from './costos.js';
import { renderInventario } from './inventario.js';

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
  if(!texto) return { orden: null, suborden: null };
  const m = String(texto).match(/OP\s?-?\s?(\d{3,6})\s?-\s?(\d{1,3})?/i);
  if(!m) return { orden: null, suborden: null };
  return { orden: parseInt(m[1], 10), suborden: m[2] ? parseInt(m[2], 10) : null };
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
    const detectado = detectarOrdenEnTexto(descripcion);
    const conceptoSugerido = sugerirConceptoId(descripcion);
    items.push({
      codigo: m[1],
      descripcion,
      valor_unitario: parseMoneyUS(m[5]),
      iva_pct: parseFloat(m[3]),
      retencion_pct: parseFloat(m[4]),
      cantidad: parseMoneyUS(m[7]),
      valor_credito: parseMoneyUS(m[8]), // se usa esta columna como "Vr. Total" del ítem
      valor_debito: 0,
      orden: detectado.orden,
      suborden: detectado.suborden,
      observacion: detectado.suborden ? `Pieza sugerida: ${detectado.orden}-${detectado.suborden}` : '',
      concepto_id: conceptoSugerido,
      tipo_costo: tipoDeConcepto(conceptoSugerido)
    });
  });

  return { cabecera, items };
}

// Sugiere un concepto de costo para la línea, buscando si el nombre de
// algún concepto ya existente aparece mencionado en la descripción; si no
// encuentra nada, no sugiere ninguno — mejor vacío que una sugerencia rara.
function sugerirConceptoId(descripcion){
  if(!descripcion) return null;
  const texto = descripcion.toLowerCase();
  const activos = DB.costos_conceptos.filter(c => c.activo !== false);
  const porNombre = activos.find(c => c.nombre && texto.includes(c.nombre.toLowerCase()));
  return porNombre ? porNombre.id : null;
}

function tipoDeConcepto(conceptoId){
  const c = DB.costos_conceptos.find(x => x.id === conceptoId);
  return c ? c.tipo : null;
}
let itemsActuales = [];
let cabeceraTotalesActuales = {};
// Si no es null, "Guardar recibo" corrige ESTE documento ya guardado en
// vez de crear uno nuevo — ver editarRecibo() más abajo.
let reciboEditandoId = null;
// IVA%/Retención% de ESTE documento — se piden una sola vez (modal) y se
// aplican a todas sus líneas para calcular el costo neto que se descarga
// al inventario (pedido: "el costo del material se ingresa al inventario
// como valor neto, descontando IVA y sumando retención").
let ivaPctAplicado = 0;
let retencionPctAplicado = 0;

// El IVA%/Retención% que YA viene leído por línea en el PDF (columnas
// "IVA %"/"Reten. %" de la tabla de Siigo) — puramente informativo hasta
// ahora, nunca se usaba para nada. Eso hacía fácil pasar por alto el modal
// (la tabla ya mostraba 19%/4% por línea, así que se veía "completo" aunque
// el % del documento completo — el que sí se descuenta del costo — hubiera
// quedado en 0). Ahora se usa para PRELLENAR el modal con lo detectado, en
// vez de dejarlo en blanco.
let pctSugeridos = { iva: null, rete: null };

function moda(valores){
  if(!valores.length) return null;
  const cuenta = {};
  valores.forEach(v => { cuenta[v] = (cuenta[v]||0) + 1; });
  return parseFloat(Object.keys(cuenta).sort((a,b) => cuenta[b]-cuenta[a])[0]);
}

function calcularPctSugeridos(items, cabecera){
  const ivaVals = items.map(it => it.iva_pct).filter(v => v != null && !isNaN(v));
  const reteVals = items.map(it => it.retencion_pct).filter(v => v != null && !isNaN(v));
  let iva = moda(ivaVals);
  let rete = moda(reteVals);
  if(iva == null && cabecera && cabecera.iva && cabecera.total_bruto){
    iva = Math.round((cabecera.iva / cabecera.total_bruto) * 100 * 100) / 100;
  }
  if(rete == null && cabecera && cabecera.retefuente && cabecera.total_bruto){
    rete = Math.round((cabecera.retefuente / cabecera.total_bruto) * 100 * 100) / 100;
  }
  return { iva, rete };
}

// El "Vr. Total" que trae la factura (columna Vr. Total / valor_credito) ya
// viene con el ajuste de impuestos del documento aplicado — Siigo arma ese
// total como Base + IVA − Retención (así cierra con la cabecera: Total Bruto
// + IVA − Retefuente = Total a Pagar). Por eso el costo neto real de la
// línea se saca DESHACIENDO ese ajuste sobre el total (dividiendo entre
// 1 + IVA% − Retención%), no restándole/sumándole el % al "Vr. Unitario"
// — ese valor unitario casi siempre YA es el costo base, y volver a
// ajustarlo lo descuadra (bug reportado 12ago26: 4 planchas a 9.000 c/u
// debían dar 36.000 de costo neto y el sistema daba 41.400 — ese 41.400
// era el Vr. Total CRUDO de la factura, sin deshacerle el 19% IVA/4% Rete).
function totalLineaFactura(it){
  // Si la línea viene del PDF (o se corrigió a mano) ya trae su propio
  // "Vr. Total" — se usa ese, que es el dato real de la factura. Si la
  // línea se agregó manualmente y no tiene total cargado, se arma con
  // unitario × cantidad como respaldo.
  if(it.valor_credito) return it.valor_credito;
  return (it.valor_unitario || 0) * (it.cantidad || 0);
}
function calcularNeto(it){
  const total = totalLineaFactura(it);
  const factor = 1 + (ivaPctAplicado / 100) - (retencionPctAplicado / 100);
  const netoTotal = factor ? total / factor : total;
  const cantidad = it.cantidad || 1;
  return netoTotal / cantidad;
}

function normalizarNombreMaterial(s){
  return String(s||'').toLowerCase().trim().replace(/\s+/g,' ');
}

// Intenta ligar la descripción de una línea a un material real del
// inventario (Materias primas o Materiales por área). Solo devuelve una
// coincidencia si es ÚNICA — si el texto calza con más de un material a
// la vez, mejor dejarlo sin marcar y que la persona lo revise a mano que
// arriesgarse a actualizar el material equivocado.
function buscarMaterialParaLinea(descripcion){
  if(!descripcion) return null;
  const texto = normalizarNombreMaterial(descripcion);
  const mpExacta = DB.materias_primas.find(m => normalizarNombreMaterial(m.nombre) === texto);
  if(mpExacta) return { tabla:'materias_primas', key: mpExacta.codigo };
  const insExactos = DB.insumos_area.filter(m => normalizarNombreMaterial(m.nombre) === texto);
  if(insExactos.length === 1) return { tabla:'insumos_area', key: String(insExactos[0].id) };
  if(insExactos.length > 1) return null; // mismo nombre en varias áreas — ambiguo, que elijan a mano

  const candidatosMP = DB.materias_primas.filter(m => {
    const n = normalizarNombreMaterial(m.nombre);
    return texto.includes(n) || n.includes(texto);
  });
  const candidatosIns = DB.insumos_area.filter(m => {
    const n = normalizarNombreMaterial(m.nombre);
    return texto.includes(n) || n.includes(texto);
  });
  if(candidatosMP.length + candidatosIns.length === 1){
    if(candidatosMP.length) return { tabla:'materias_primas', key: candidatosMP[0].codigo };
    return { tabla:'insumos_area', key: String(candidatosIns[0].id) };
  }
  return null;
}

// Cuántas palabras comparte la descripción de la factura con el nombre de
// un material — no decide nada solo, solo ordena la lista para que, cuando
// no hubo coincidencia automática (ej. "BOND BLANCO 75 60 X90" vs "Bond 75
// gr 60x90"), los candidatos más parecidos aparezcan primero en vez de
// tener que buscar a mano entre ~200 materiales.
function puntajeSimilitud(descripcion, nombre){
  const palabrasDesc = new Set(normalizarNombreMaterial(descripcion).split(' ').filter(Boolean));
  const palabrasNom = normalizarNombreMaterial(nombre).split(' ').filter(Boolean);
  let comunes = 0;
  palabrasNom.forEach(p => { if(palabrasDesc.has(p)) comunes++; });
  return comunes;
}

function opcionesMaterialInventario(tablaSel, keySel, descripcion){
  const todos = [
    ...DB.materias_primas.filter(m=>m.activo!==false).map(m => ({ tabla:'materias_primas', key:m.codigo, nombre:m.nombre, etiqueta:`📄 ${m.nombre} (${m.codigo})` })),
    ...DB.insumos_area.filter(m=>m.activo!==false).map(m => ({ tabla:'insumos_area', key:String(m.id), nombre:m.nombre, etiqueta:`🧰 ${m.nombre} (${m.area||'—'})` }))
  ];
  const opcion = m => {
    const sel = tablaSel===m.tabla && keySel===m.key;
    return `<option value="${m.tabla}|${m.key}"${sel?' selected':''}>${m.etiqueta}</option>`;
  };

  if(descripcion){
    const puntuados = todos.map(m => ({ ...m, puntaje: puntajeSimilitud(descripcion, m.nombre) }))
      .filter(m => m.puntaje > 0)
      .sort((a,b) => b.puntaje - a.puntaje)
      .slice(0, 8);
    if(puntuados.length){
      const restoKeys = new Set(puntuados.map(m => m.tabla+'|'+m.key));
      const resto = todos.filter(m => !restoKeys.has(m.tabla+'|'+m.key));
      const etiquetaGrupo = ('Parecidos a: ' + descripcion.slice(0,40)).replace(/"/g, "'");
      return '<option value="">— sin coincidencia, elegí uno —</option>'
        + `<optgroup label="${etiquetaGrupo}">` + puntuados.map(opcion).join('') + '</optgroup>'
        + '<optgroup label="Todos los materiales">' + resto.map(opcion).join('') + '</optgroup>';
    }
  }
  return '<option value="">— sin coincidencia, elegí uno —</option>' + todos.map(opcion).join('');
}

function opcionesOrden(ordenSeleccionada){
  const activas = DB.opp_ordenes.slice().sort((a,b) => b.orden - a.orden).slice(0, 200);
  return '<option value="">— Ninguna —</option>' +
    activas.map(o => `<option value="${o.orden}"${o.orden===ordenSeleccionada?' selected':''}>${o.orden} — ${o.cliente||''}</option>`).join('');
}

function opcionesConcepto(conceptoIdSeleccionado){
  const activos = DB.costos_conceptos.filter(c => c.activo !== false)
    .sort((a,b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre));
  return '<option value="">— Sin concepto (no se contará en Costos) —</option>' +
    activos.map(c => `<option value="${c.id}"${c.id===conceptoIdSeleccionado?' selected':''}>${c.tipo} — ${c.nombre}</option>`).join('');
}

// Recalcula el costo neto de cada línea con el IVA%/Retención% vigente
// de este documento — se llama al aplicar el modal y cada vez que cambia
// un "Vr. Unit." a mano.
function recalcularNetos(){
  itemsActuales.forEach(it => { it.valor_neto_unitario = calcularNeto(it); });
}

function renderTablaItems(){
  const tbody = document.querySelector('#tbl-recibo-items tbody');
  tbody.innerHTML = itemsActuales.map((it, i) => {
    const sinMaterial = !it.material_tabla || !it.material_key;
    return `
    <tr data-i="${i}" style="${sinMaterial?'background:var(--bg-warning,rgba(163,45,45,.05))':''}">
      <td><input type="text" class="ri-codigo" value="${it.codigo||''}" style="width:36px"></td>
      <td><input type="text" class="ri-desc" value="${it.descripcion||''}" style="width:100%;min-width:160px"></td>
      <td><input type="number" class="ri-cantidad num" value="${it.cantidad||0}" style="width:70px"></td>
      <td><input type="number" class="ri-unitario num" value="${it.valor_unitario||0}" style="width:90px"></td>
      <td><input type="number" class="ri-iva num" value="${it.iva_pct||0}" style="width:55px"></td>
      <td><input type="number" class="ri-reten num" value="${it.retencion_pct||0}" style="width:55px"></td>
      <td><input type="number" class="ri-credito num" value="${it.valor_credito||0}" style="width:100px"></td>
      <td class="num" title="Vr. Total de la factura ÷ (1 + IVA% − Retención%) ÷ cantidad">${fmtCOP(it.valor_neto_unitario||0)}</td>
      <td><select class="ri-material" title="${sinMaterial?'Sin coincidencia — elegí el material real para que actualice el inventario':'Se va a sumar la cantidad al stock y actualizar el costo por unidad de este material'}">${opcionesMaterialInventario(it.material_tabla, it.material_key, it.descripcion)}</select></td>
      <td><select class="ri-orden">${opcionesOrden(it.orden)}</select></td>
      <td><input type="number" class="ri-suborden" value="${it.suborden||''}" placeholder="sub." title="Suborden / pieza (ej. el 2 de OP5955-2)" style="width:55px"></td>
      <td><select class="ri-concepto">${opcionesConcepto(it.concepto_id)}</select></td>
      <td><select class="ri-tipo"><option value="">—</option><option value="Fijo"${it.tipo_costo==='Fijo'?' selected':''}>Fijo</option><option value="Variable"${it.tipo_costo==='Variable'?' selected':''}>Variable</option></select></td>
      <td><input type="text" class="ri-obs" value="${it.observacion||''}" placeholder="opcional" style="width:100%;min-width:120px"></td>
      <td><button type="button" class="row-btn row-btn-danger ri-del">✕</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="15" style="text-align:center;color:var(--ink-faint)">Sin líneas todavía — agrega una manualmente</td></tr>';

  tbody.querySelectorAll('tr').forEach(tr => {
    const i = parseInt(tr.dataset.i, 10);
    if(isNaN(i)) return;
    // Recalcula el costo neto de ESTA línea (depende del Vr. Total y de la
    // cantidad, ver calcularNeto) y refresca la celda mostrada.
    const actualizarNetoFila = () => {
      itemsActuales[i].valor_neto_unitario = calcularNeto(itemsActuales[i]);
      tr.querySelector('td.num[title]').textContent = fmtCOP(itemsActuales[i].valor_neto_unitario);
      actualizarResumen();
    };
    tr.querySelector('.ri-codigo').addEventListener('input', e => itemsActuales[i].codigo = e.target.value);
    tr.querySelector('.ri-desc').addEventListener('input', e => itemsActuales[i].descripcion = e.target.value);
    tr.querySelector('.ri-cantidad').addEventListener('input', e => { itemsActuales[i].cantidad = parseFloat(e.target.value)||0; actualizarNetoFila(); });
    tr.querySelector('.ri-unitario').addEventListener('input', e => {
      itemsActuales[i].valor_unitario = parseFloat(e.target.value)||0;
      actualizarNetoFila();
    });
    tr.querySelector('.ri-iva').addEventListener('input', e => { itemsActuales[i].iva_pct = parseFloat(e.target.value)||0; actualizarResumen(); });
    tr.querySelector('.ri-reten').addEventListener('input', e => { itemsActuales[i].retencion_pct = parseFloat(e.target.value)||0; actualizarResumen(); });
    tr.querySelector('.ri-credito').addEventListener('input', e => { itemsActuales[i].valor_credito = parseFloat(e.target.value)||0; actualizarNetoFila(); });
    tr.querySelector('.ri-material').addEventListener('change', e => {
      const [tabla, key] = e.target.value ? e.target.value.split('|') : [null, null];
      itemsActuales[i].material_tabla = tabla;
      itemsActuales[i].material_key = key;
      tr.style.background = (tabla && key) ? '' : 'var(--bg-warning,rgba(163,45,45,.05))';
      actualizarResumen();
    });
    tr.querySelector('.ri-orden').addEventListener('change', e => itemsActuales[i].orden = e.target.value ? parseInt(e.target.value,10) : null);
    tr.querySelector('.ri-suborden').addEventListener('input', e => itemsActuales[i].suborden = e.target.value ? parseInt(e.target.value,10) : null);
    tr.querySelector('.ri-concepto').addEventListener('change', e => {
      const conceptoId = e.target.value ? parseInt(e.target.value,10) : null;
      itemsActuales[i].concepto_id = conceptoId;
      const tipo = tipoDeConcepto(conceptoId);
      if(tipo){ itemsActuales[i].tipo_costo = tipo; tr.querySelector('.ri-tipo').value = tipo; }
      actualizarResumen();
    });
    tr.querySelector('.ri-tipo').addEventListener('change', e => itemsActuales[i].tipo_costo = e.target.value || null);
    tr.querySelector('.ri-obs').addEventListener('input', e => itemsActuales[i].observacion = e.target.value);
    tr.querySelector('.ri-del').addEventListener('click', () => { itemsActuales.splice(i,1); renderTablaItems(); actualizarResumen(); });
  });
}

function actualizarResumen(){
  const hint = document.getElementById('recibo-total-hint');
  if(!hint) return;
  const totalItems = itemsActuales.reduce((s,it)=>s+(it.valor_credito||0),0);
  const totalNeto = itemsActuales.reduce((s,it)=>s+((it.valor_neto_unitario||0)*(it.cantidad||0)),0);
  const conOrden = itemsActuales.filter(it => it.orden).length;
  const conConcepto = itemsActuales.filter(it => it.concepto_id).length;
  const conMaterial = itemsActuales.filter(it => it.material_tabla && it.material_key).length;
  hint.innerHTML = `Total de líneas (Vr. Total factura, con IVA/Retención): ${fmtCOP(totalItems)} · Total neto (lo que cuenta como costo/inventario): ${fmtCOP(totalNeto)}`
    + (conOrden ? ` · ${conOrden}/${itemsActuales.length} línea(s) con orden asociada` : '')
    + ` · ${conConcepto}/${itemsActuales.length} línea(s) con concepto de costo (solo esas cuentan en Costos)`
    + ` · ${conMaterial}/${itemsActuales.length} línea(s) van a actualizar inventario`;
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

  // Intenta ligar cada línea a un material real del inventario — la
  // persona revisa/corrige las que queden sin coincidencia (resaltadas)
  // antes de guardar. Ver buscarMaterialParaLinea.
  itemsActuales.forEach(it => {
    const match = buscarMaterialParaLinea(it.descripcion);
    it.material_tabla = match ? match.tabla : null;
    it.material_key = match ? match.key : null;
  });

  pctSugeridos = calcularPctSugeridos(itemsActuales, cabeceraTotalesActuales);
  mostrarModalIva();
}

// Pide el IVA%/Retención% de ESTE documento (una vez, se aplica a todas
// las líneas) — aparece apenas se carga el archivo, antes de mostrar la
// tabla de revisión final con los costos netos ya calculados. Se prellena
// con lo que el propio PDF ya trae por línea (pctSugeridos) para que no
// quede en blanco/0 por descuido — igual se puede corregir a mano.
function mostrarModalIva(){
  document.getElementById('recibo-iva-modal-pct').value = ivaPctAplicado || pctSugeridos.iva || '';
  document.getElementById('recibo-retencion-modal-pct').value = retencionPctAplicado || pctSugeridos.rete || '';
  const nota = document.getElementById('recibo-iva-modal-nota');
  if(nota){
    nota.textContent = (pctSugeridos.iva != null || pctSugeridos.rete != null)
      ? `Detectado en el documento: IVA ${pctSugeridos.iva ?? '—'}% · Retención ${pctSugeridos.rete ?? '—'}% — ya lo dejamos escrito abajo, confírmalo o corrígelo.`
      : 'No se detectó IVA%/Retención% en el texto del documento — escríbelo a mano (revisa la factura física).';
  }
  document.getElementById('recibo-iva-modal').style.display = 'flex';
  document.getElementById('recibo-iva-modal-pct').focus();
}

function aplicarModalIva(){
  const ivaInput = document.getElementById('recibo-iva-modal-pct').value;
  const reteInput = document.getElementById('recibo-retencion-modal-pct').value;
  const iva = parseFloat(ivaInput) || 0;
  const rete = parseFloat(reteInput) || 0;

  // Antes se podía aplicar 0%/0% sin ningún aviso aunque la factura
  // mostrara IVA/Retención reales por línea — así fue como quedó guardado
  // en null el 12ago26. Ahora, si se intenta aplicar 0 habiendo una
  // sugerencia distinta de 0, se pide confirmar explícitamente.
  const dudaIva = iva === 0 && pctSugeridos.iva > 0;
  const dudaRete = rete === 0 && pctSugeridos.rete > 0;
  if(dudaIva || dudaRete){
    const seguir = confirm(
      `El documento muestra IVA ${pctSugeridos.iva ?? 0}% / Retención ${pctSugeridos.rete ?? 0}% en sus líneas, pero vas a aplicar ${iva}% / ${rete}% — el costo que baja al inventario NO va a descontar impuestos.\n\n` +
      `Aceptar = aplicar ${iva}%/${rete}% de todos modos · Cancelar = volver a escribir el %`
    );
    if(!seguir) return;
  }

  ivaPctAplicado = iva;
  retencionPctAplicado = rete;
  document.getElementById('recibo-iva-pct').value = ivaPctAplicado;
  document.getElementById('recibo-retencion-pct').value = retencionPctAplicado;
  recalcularNetos();
  document.getElementById('recibo-iva-modal').style.display = 'none';
  renderTablaItems();
  actualizarResumen();
}

// Limpia el formulario completo (archivo, cabecera y tabla de líneas) para
// empezar de cero con el próximo documento — igual que "Nueva orden" en
// Órdenes. También sirve para descartar un intento si algo salió mal.
function limpiarFormularioRecibo(){
  document.getElementById('recibo-file').value = '';
  document.getElementById('recibo-numero').value = '';
  document.getElementById('recibo-fecha').value = '';
  document.getElementById('recibo-nit').value = '';
  document.getElementById('recibo-tercero').value = '';
  itemsActuales = [];
  cabeceraTotalesActuales = {};
  ivaPctAplicado = 0;
  retencionPctAplicado = 0;
  pctSugeridos = { iva: null, rete: null };
  reciboEditandoId = null;
  document.getElementById('recibo-iva-pct').value = '';
  document.getElementById('recibo-retencion-pct').value = '';
  document.getElementById('recibo-guardar').textContent = 'Guardar recibo';
  const avisoEdicion = document.getElementById('recibo-editando-aviso');
  if(avisoEdicion) avisoEdicion.style.display = 'none';
  renderTablaItems();
  actualizarResumen();
  document.getElementById('recibo-review').style.display = 'none';
}

// Recarga en el formulario una compra ya guardada, tal cual quedó, para
// corregirla — misma pantalla que se usa para cargar una nueva, solo que
// "Guardar recibo" va a actualizar este documento en vez de crear otro.
async function editarRecibo(reciboId){
  const recibo = DB.recibos_caja.find(r => r.id === reciboId);
  if(!recibo) return;
  try{
    const { data: items, error } = await sb.from('recibos_caja_items').select('*').eq('recibo_id', reciboId).order('id');
    if(error) throw error;

    reciboEditandoId = reciboId;
    document.getElementById('recibo-file').value = '';
    document.getElementById('recibo-numero').value = recibo.numero_recibo || '';
    document.getElementById('recibo-fecha').value = recibo.fecha || '';
    document.getElementById('recibo-nit').value = recibo.nit || '';
    document.getElementById('recibo-tercero').value = recibo.tercero || '';
    cabeceraTotalesActuales = {
      total_bruto: recibo.total_bruto, iva: recibo.iva, retefuente: recibo.retefuente, valor_total: recibo.valor_total
    };
    itemsActuales = (items||[]).map(it => ({
      codigo: it.codigo || '', descripcion: it.descripcion || '', cantidad: it.cantidad || 0,
      valor_unitario: it.valor_unitario || 0, iva_pct: it.iva_pct, retencion_pct: it.retencion_pct,
      valor_credito: it.valor_credito || 0, valor_debito: it.valor_debito || 0,
      valor_neto_unitario: it.valor_neto_unitario || 0,
      material_tabla: it.material_tabla || null, material_key: it.material_key || null,
      orden: it.orden || null, suborden: it.suborden || null, observacion: it.observacion || '',
      concepto_id: it.concepto_id || null, tipo_costo: it.tipo_costo || null
    }));
    ivaPctAplicado = recibo.iva_pct_aplicado || 0;
    retencionPctAplicado = recibo.retencion_pct_aplicado || 0;
    pctSugeridos = calcularPctSugeridos(itemsActuales, cabeceraTotalesActuales);
    document.getElementById('recibo-iva-pct').value = ivaPctAplicado || '';
    document.getElementById('recibo-retencion-pct').value = retencionPctAplicado || '';

    document.getElementById('recibo-review').style.display = '';
    document.getElementById('recibo-guardar').textContent = 'Guardar cambios';
    const avisoEdicion = document.getElementById('recibo-editando-aviso');
    if(avisoEdicion){
      avisoEdicion.style.display = '';
      avisoEdicion.textContent = `Editando "${recibo.numero_recibo || reciboId}" — al guardar se corrige este documento (no se crea uno nuevo). "Limpiar" cancela la edición.`;
    }
    renderTablaItems();
    actualizarResumen();
    document.getElementById('recibo-import-card').scrollIntoView({ behavior:'smooth', block:'start' });
  }catch(err){
    console.error(err);
    toast('No se pudo cargar el documento para editar — revisa la consola');
  }
}

// Deshace lo que UNA compra ya guardada le sumó al inventario y borra sus
// líneas y los costos que había generado — SIN borrar el documento en sí
// (eliminarRecibo lo borra después de llamar esto; guardarRecibo lo llama
// antes de volver a insertar las líneas corregidas). Centraliza la lógica
// para que borrar y editar queden consistentes entre sí.
async function revertirEfectosRecibo(reciboId){
  const { data: items, error: errItems } = await sb.from('recibos_caja_items').select('*').eq('recibo_id', reciboId);
  if(errItems) throw errItems;

  for(const it of (items||[])){
    if(!it.material_tabla || !it.material_key || !it.cantidad || it.cantidad <= 0) continue;
    try{
      const tabla = it.material_tabla;
      const keyCol = tabla === 'materias_primas' ? 'codigo' : 'id';
      const keyVal = tabla === 'materias_primas' ? it.material_key : parseInt(it.material_key, 10);
      const mat = tabla === 'materias_primas'
        ? DB.materias_primas.find(m => m.codigo === it.material_key)
        : DB.insumos_area.find(m => String(m.id) === it.material_key);
      if(!mat) continue;
      const nuevoStock = (mat.stock_actual || 0) - it.cantidad;
      const { data, error } = await sb.from(tabla).update({ stock_actual: nuevoStock }).eq(keyCol, keyVal).select();
      if(error) throw error;
      Object.assign(mat, data[0]);
    }catch(err){
      console.error('No se pudo devolver al inventario "' + it.descripcion + '":', err);
    }
  }

  const { error: errDelItems } = await sb.from('recibos_caja_items').delete().eq('recibo_id', reciboId);
  if(errDelItems) throw errDelItems;

  const { error: errDelCostos } = await sb.from('costos_movimientos').delete().eq('recibo_id', reciboId);
  if(errDelCostos) throw errDelCostos;
  let idx;
  while((idx = DB.costos_movimientos.findIndex(m => m.recibo_id === reciboId)) >= 0) DB.costos_movimientos.splice(idx, 1);
}

async function guardarRecibo(){
  const btn = document.getElementById('recibo-guardar');
  const numero = document.getElementById('recibo-numero').value.trim();
  const fecha = document.getElementById('recibo-fecha').value || null;
  const nit = document.getElementById('recibo-nit').value.trim() || null;
  const tercero = document.getElementById('recibo-tercero').value.trim() || null;

  if(!itemsActuales.length){ toast('Agrega al menos una línea antes de guardar'); return; }

  // Antes se podía guardar el documento entero sin que nada avisara que
  // había líneas con cantidad sin ligar a un material real — así fue como
  // el papel del 12ago26 quedó guardado como costo pero nunca sumó al
  // inventario. Ahora se detiene a preguntar, mostrando cuáles son.
  const sinMaterialConCantidad = itemsActuales.filter(it => (it.cantidad||0) > 0 && (!it.material_tabla || !it.material_key));
  if(sinMaterialConCantidad.length){
    const listado = sinMaterialConCantidad.slice(0, 8).map(it => `• ${it.descripcion || it.codigo || '(sin descripción)'}`).join('\n')
      + (sinMaterialConCantidad.length > 8 ? `\n… y ${sinMaterialConCantidad.length - 8} más` : '');
    const seguir = confirm(
      `${sinMaterialConCantidad.length} línea(s) con cantidad no están ligadas a ningún "Material del inventario" — NO van a sumar stock ni actualizar costo:\n\n${listado}\n\n` +
      `Si alguna es papel u otro insumo real, elígelo antes de guardar.\n\n` +
      `Aceptar = guardar de todos modos (sin tocar inventario en esas líneas) · Cancelar = volver a revisar`
    );
    if(!seguir) return;
  }

  // Vuelve a revisar duplicados justo antes de guardar (no solo al leer el
  // archivo) — por si la persona corrigió el número a mano, o ignoró el
  // aviso de la pantalla anterior. Aquí sí se detiene hasta que confirme.
  if(numero){
    const existente = DB.recibos_caja.find(r => r.numero_recibo === numero && r.id !== reciboEditandoId);
    if(existente){
      const fechaExistente = existente.cargado_en ? new Date(existente.cargado_en).toLocaleString('es-CO') : 'antes';
      const continuar = confirm(
        `Ya existe un documento guardado con el número "${numero}" (cargado ${fechaExistente}).\n\n` +
        `¿Seguro que quieres guardarlo de nuevo? Esto va a crear un registro duplicado — no reemplaza al anterior.\n\n` +
        `Aceptar = guardar de todos modos · Cancelar = no guardar`
      );
      if(!continuar) return;
    }
  }

  const valorTotal = cabeceraTotalesActuales.valor_total || itemsActuales.reduce((s,it)=>s+(it.valor_credito||0),0);
  const user = getCurrentUser();

  const esEdicion = reciboEditandoId != null;
  btn.disabled = true; btn.textContent = 'Guardando…';
  try{
    const camposRecibo = {
      numero_recibo: numero || null, fecha, nit, tercero,
      valor_total: valorTotal || null,
      tipo_documento: 'Compra',
      total_bruto: cabeceraTotalesActuales.total_bruto ?? null,
      iva: cabeceraTotalesActuales.iva ?? null,
      retefuente: cabeceraTotalesActuales.retefuente ?? null,
      iva_pct_aplicado: ivaPctAplicado || null,
      retencion_pct_aplicado: retencionPctAplicado || null,
      cargado_por: user ? user.nombre : null
    };

    let reciboId, reciboGuardado;
    if(esEdicion){
      // Deshace lo que la versión ANTERIOR de este documento había sumado
      // al inventario y borra sus líneas/costos viejos, antes de guardar
      // la versión corregida — así no queda duplicado ni desfasado.
      reciboId = reciboEditandoId;
      await revertirEfectosRecibo(reciboId);
      const { data, error } = await sb.from('recibos_caja').update(camposRecibo).eq('id', reciboId).select();
      if(error) throw error;
      reciboGuardado = data[0];
    } else {
      camposRecibo.archivo_nombre = document.getElementById('recibo-file').files[0]?.name || null;
      const { data, error } = await sb.from('recibos_caja').insert([camposRecibo]).select();
      if(error) throw error;
      reciboGuardado = data[0];
      reciboId = reciboGuardado.id;
    }

    const payloadItems = itemsActuales.map(it => ({
      recibo_id: reciboId, codigo: it.codigo || null, descripcion: it.descripcion || null,
      cantidad: it.cantidad || null, valor_unitario: it.valor_unitario || null,
      iva_pct: it.iva_pct || null, retencion_pct: it.retencion_pct || null,
      valor_debito: it.valor_debito || 0, valor_credito: it.valor_credito || 0,
      valor_neto_unitario: it.valor_neto_unitario || null,
      material_tabla: it.material_tabla || null, material_key: it.material_key || null,
      orden: it.orden || null, suborden: it.suborden || null, observacion: it.observacion || null,
      concepto_id: it.concepto_id || null, tipo_costo: it.tipo_costo || null
    }));
    const { error: errItems } = await sb.from('recibos_caja_items').insert(payloadItems);
    if(errItems) throw errItems;

    // Pedido: "el costo del material se ingresa al inventario como valor
    // neto" — cada línea con un material ligado y cantidad > 0 suma esa
    // cantidad al stock y deja el costo por unidad en el valor neto recién
    // calculado (Vr. Total de la factura deshaciendo IVA%/Retención%, ver
    // calcularNeto). Las líneas sin material ligado (sin coincidencia, sin
    // revisar) NO tocan inventario.
    let materialesActualizados = 0;
    const materialesFallidos = [];
    for(const it of itemsActuales){
      if(!it.material_tabla || !it.material_key || !it.cantidad || it.cantidad <= 0) continue;
      try{
        if(it.material_tabla === 'materias_primas'){
          const mat = DB.materias_primas.find(m => m.codigo === it.material_key);
          if(!mat) throw new Error('material no encontrado en memoria');
          const nuevoStock = (mat.stock_actual || 0) + it.cantidad;
          const { data, error } = await sb.from('materias_primas')
            .update({ stock_actual: nuevoStock, costo_unitario: it.valor_neto_unitario }).eq('codigo', it.material_key).select();
          if(error) throw error;
          Object.assign(mat, data[0]);
        } else {
          const mat = DB.insumos_area.find(m => String(m.id) === it.material_key);
          if(!mat) throw new Error('material no encontrado en memoria');
          const nuevoStock = (mat.stock_actual || 0) + it.cantidad;
          const { data, error } = await sb.from('insumos_area')
            .update({ stock_actual: nuevoStock, costo_unitario: it.valor_neto_unitario }).eq('id', mat.id).select();
          if(error) throw error;
          Object.assign(mat, data[0]);
        }
        materialesActualizados++;
      }catch(err){
        console.error('No se pudo actualizar el inventario de "' + it.descripcion + '":', err);
        materialesFallidos.push(it.descripcion || it.codigo || '(sin descripción)');
      }
    }
    if(materialesActualizados) renderInventario();

    // Esto es lo que faltaba antes: sin esto, el documento quedaba guardado
    // pero no contaba como costo real en ningún reporte. Cada línea con un
    // Concepto asignado se convierte en un movimiento de costo de verdad.
    const conCosto = itemsActuales.filter(it => it.concepto_id);
    let movimientosCreados = 0;
    if(conCosto.length){
      const payloadCostos = conCosto.map(it => ({
        concepto_id: it.concepto_id,
        tipo: it.tipo_costo || tipoDeConcepto(it.concepto_id) || 'Variable',
        fecha: fecha || fechaHoyLocal(),
        // Valor NETO de la línea (sin el IVA/Retención de la factura, ver
        // calcularNeto) — no el Vr. Total crudo: el IVA no es un costo real
        // (es recuperable) y la retención tampoco cambia el costo, solo el
        // pago. Pedido explícito 12ago26.
        valor: (it.valor_neto_unitario != null ? it.valor_neto_unitario * (it.cantidad || 0) : it.valor_credito) || 0,
        proveedor: tercero,
        comentario: (numero ? numero + ' — ' : '') + (it.descripcion || ''),
        orden: it.orden || null,
        suborden: it.suborden || null,
        recibo_id: reciboId // permite borrar/corregir en bloque desde "Compras cargadas" si hace falta
      }));
      const { data: costosData, error: errCostos } = await sb.from('costos_movimientos').insert(payloadCostos).select();
      if(errCostos){
        console.error(errCostos);
        toast('El documento se guardó, pero no se pudieron crear los movimientos de costo — revisa la consola');
      } else if(costosData){
        DB.costos_movimientos.unshift(...costosData);
        movimientosCreados = costosData.length;
        renderMovimientosRecientes();
        renderResumenCostosMes();
      }
    }

    const sinConcepto = itemsActuales.length - conCosto.length;
    toast('Documento ' + (numero || reciboId) + (esEdicion ? ' actualizado con ' : ' guardado con ') + payloadItems.length + ' línea(s)'
      + (movimientosCreados ? ` · ${movimientosCreados} línea(s) ya cuentan como costo real` : '')
      + (sinConcepto ? ` · ${sinConcepto} sin concepto, no se contaron en Costos` : '')
      + (materialesActualizados ? ` · ${materialesActualizados} material(es) de inventario actualizados (stock + costo neto)` : '')
      + (materialesFallidos.length ? ` · ⚠️ no se pudo actualizar: ${materialesFallidos.join(', ')}` : ''),
      materialesFallidos.length ? 7000 : undefined);

    if(esEdicion){
      const idx = DB.recibos_caja.findIndex(r => r.id === reciboId);
      if(idx>=0) DB.recibos_caja[idx] = reciboGuardado; else DB.recibos_caja.unshift(reciboGuardado);
    } else {
      DB.recibos_caja.unshift(reciboGuardado);
    }
    limpiarFormularioRecibo();
    renderRecibosCargados();
  }catch(err){
    console.error(err);
    toast('Error al guardar el documento — revisa la consola');
  }finally{
    btn.disabled = false; btn.textContent = 'Guardar recibo';
  }
}

// ---------- Compras cargadas: ver y corregir (borrar) ----------
// Antes no había ninguna forma de deshacer un documento ya guardado — un
// error de tecleo (ej. un cero de más) quedaba pegado para siempre, tanto
// en el costo como en el inventario que hubiera actualizado. "Eliminar"
// borra las líneas, le DEVUELVE al inventario lo que esa compra le había
// sumado, borra los movimientos de costo que generó (via recibo_id) y
// borra el documento — deja todo como si nunca se hubiera cargado.
export function renderRecibosCargados(){
  const tbody = document.querySelector('#tbl-recibos-cargados tbody');
  if(!tbody) return;
  const recientes = [...DB.recibos_caja].sort((a,b) => (b.cargado_en||'').localeCompare(a.cargado_en||'')).slice(0, 30);
  tbody.innerHTML = recientes.map(r => `<tr data-id="${r.id}">
    <td>${(r.fecha||'').slice(0,10) || '—'}</td>
    <td>${r.numero_recibo || '—'}</td>
    <td>${r.tercero || '—'}</td>
    <td class="num">${fmtCOP(r.valor_total||0)}</td>
    <td>${r.cargado_por || '—'}</td>
    <td><div class="row-actions">
      <button type="button" class="row-btn" data-edit-recibo="${r.id}">Editar</button>
      <button type="button" class="row-btn row-btn-danger" data-del-recibo="${r.id}">Eliminar</button>
    </div></td>
  </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Sin compras cargadas todavía</td></tr>';

  tbody.querySelectorAll('[data-edit-recibo]').forEach(b => b.addEventListener('click', () => {
    editarRecibo(parseInt(b.dataset.editRecibo, 10));
  }));
  tbody.querySelectorAll('[data-del-recibo]').forEach(b => b.addEventListener('click', () => {
    eliminarRecibo(parseInt(b.dataset.delRecibo, 10));
  }));
}

async function eliminarRecibo(reciboId){
  const recibo = DB.recibos_caja.find(r => r.id === reciboId);
  if(!recibo) return;
  const seguro = confirm(
    `¿Eliminar el documento "${recibo.numero_recibo || reciboId}" (${recibo.tercero || 'sin proveedor'})?\n\n` +
    `Esto va a:\n· Devolver al inventario el stock que esta compra le sumó\n· Borrar los costos que generó\n· Borrar el documento y sus líneas\n\n` +
    `No se puede deshacer.`
  );
  if(!seguro) return;

  try{
    await revertirEfectosRecibo(reciboId);

    const { error: errDelRecibo } = await sb.from('recibos_caja').delete().eq('id', reciboId);
    if(errDelRecibo) throw errDelRecibo;
    const i = DB.recibos_caja.findIndex(r => r.id === reciboId);
    if(i >= 0) DB.recibos_caja.splice(i, 1);

    // Si justo se estaba editando este mismo documento, limpia el
    // formulario — si no, quedaría "editando" un documento que ya no existe.
    if(reciboEditandoId === reciboId) limpiarFormularioRecibo();

    renderInventario();
    renderMovimientosRecientes();
    renderResumenCostosMes();
    renderRecibosCargados();
    toast('Documento eliminado — inventario y costos revertidos');
  }catch(err){
    console.error(err);
    toast('Error al eliminar el documento — revisa la consola');
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
    // Si es la primera línea de un documento nuevo (sin archivo cargado —
    // ej. una factura que no se puede leer sola), igual hay que preguntar
    // el IVA%/Retención% antes de seguir — antes esto se saltaba por
    // completo cuando se agregaba a mano en vez de subir un archivo.
    const esPrimeraLinea = itemsActuales.length === 0;
    itemsActuales.push({ codigo:'', descripcion:'', cantidad:0, valor_unitario:0, iva_pct:0, retencion_pct:0, valor_credito:0, valor_debito:0, valor_neto_unitario:0, material_tabla:null, material_key:null, orden:null, suborden:null, observacion:'', concepto_id:null, tipo_costo:null });
    document.getElementById('recibo-review').style.display = '';
    renderTablaItems();
    actualizarResumen();
    if(esPrimeraLinea) mostrarModalIva();
  });
  document.getElementById('recibo-guardar').addEventListener('click', guardarRecibo);
  document.getElementById('recibo-limpiar').addEventListener('click', () => {
    if(itemsActuales.length && !confirm('¿Limpiar el formulario? Se perderá lo que hayas leído o escrito sin guardar.')) return;
    limpiarFormularioRecibo();
  });
  document.getElementById('recibo-editar-iva').addEventListener('click', mostrarModalIva);
  document.getElementById('recibo-iva-modal-aplicar').addEventListener('click', aplicarModalIva);
  renderRecibosCargados();
}
