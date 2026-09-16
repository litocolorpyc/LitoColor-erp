import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast, fmtCOP } from './helpers.js';
import { getCurrentUser } from './auth.js';

if(typeof pdfjsLib !== 'undefined'){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ---------- lectura del PDF (misma técnica que recibos.js para las
// compras — ver ese archivo para el porqué de agruparLineas/parseItemsPor-
// Columnas: los PDF de Siigo meten un fragmento de "espacio en blanco"
// entre cada título de columna que puede descuadrar dónde el sistema cree
// que empieza/termina cada columna, y a veces la línea base de una fila
// viene corrida entre columnas). Se duplica acá (no se comparte código con
// recibos.js) porque la tabla de la Factura de venta tiene columnas
// distintas (sin "Impto. Rete.", con "Unidad de medida").

function agruparLineas(items, tol){
  const ordenados = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lineas = [];
  let actual = [];
  let anclaY = null;
  ordenados.forEach(it => {
    if(anclaY === null || Math.abs(it.y - anclaY) <= tol){
      actual.push(it);
      if(anclaY === null) anclaY = it.y;
    } else {
      lineas.push(actual);
      actual = [it];
      anclaY = it.y;
    }
  });
  if(actual.length) lineas.push(actual);
  return lineas.map(l => l.slice().sort((a,b) => a.x - b.x));
}

async function extraerTextoPDF(file){
  if(typeof pdfjsLib === 'undefined'){
    throw new Error('La librería para leer PDF no cargó (revisa tu conexión a internet)');
  }
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  let texto = '';
  const paginas = [];
  for(let i = 1; i <= pdf.numPages; i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.map(it => ({ x: it.transform[4], y: it.transform[5], str: it.str, width: it.width || 0 }));
    paginas.push(items);
    const lineas = agruparLineas(items, 3);
    texto += lineas.map(l => l.map(it => it.str).join(' ')).join('\n') + '\n';
  }
  return { texto, paginas };
}

function parseMoneyUS(str){
  if(str == null) return 0;
  const n = parseFloat(String(str).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function parsePct(str){
  if(str == null) return 0;
  const n = parseFloat(String(str).replace(',', '.').replace(/[^\d.]/g, ''));
  return isNaN(n) ? 0 : n;
}

// El "Vr. Total" de cada línea ya trae el IVA sumado — pedido explícito
// 16sep26: el valor que se asocia a la orden de producción debe ser el
// NETO (sin IVA), no ese total crudo. Mismo criterio que calcularNeto en
// recibos.js para las compras (ahí también se resta Retención, que en
// ventas no aplica).
function calcularNeto(it){
  const factor = 1 + ((it.iva_pct || 0) / 100);
  return factor ? (it.valor_total || 0) / factor : (it.valor_total || 0);
}

// ---------- cabecera ----------
function parseCabeceraVenta(texto){
  const cabecera = { numero_factura: '', fecha: '', nit: '', cliente: '', total_bruto: null, iva: null, valor_total: null };
  const mNumero = texto.match(/No\.?\s*FE\s*(\d+)/i);
  if(mNumero) cabecera.numero_factura = 'FE ' + mNumero[1];

  const lineaCliente = texto.split('\n').find(l => /^\s*Señores\b/i.test(l));
  if(lineaCliente){
    const m = lineaCliente.match(/Señores\s+(.+?)(?:\s+NIT\b.*)?$/i);
    if(m) cabecera.cliente = m[1].trim();
  }
  const mNit = texto.match(/NIT\s+([\d.\-]{6,})\s+Tel[eé]fono/i);
  if(mNit) cabecera.nit = mNit[1].trim();

  const mFecha = texto.match(/Generaci[oó]n\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  if(mFecha) cabecera.fecha = `${mFecha[3]}-${mFecha[2]}-${mFecha[1]}`;

  const mBruto = texto.match(/Total Bruto\s+([\d.,]+)/i);
  if(mBruto) cabecera.total_bruto = parseMoneyUS(mBruto[1]);
  const mIva = texto.match(/IVA\s+[\d.]+\s*%\s+([\d.,]+)/i);
  if(mIva) cabecera.iva = parseMoneyUS(mIva[1]);
  const mPagar = texto.match(/Total a Pagar\s+([\d.,]+)/i);
  if(mPagar) cabecera.valor_total = parseMoneyUS(mPagar[1]);

  // Siigo imprime "Total items: N" — sirve para saber si el parser de una
  // sola línea se quedó corto (ver parseItemsVenta más abajo).
  const mTotalItems = texto.match(/Total items:\s*(\d+)/i);
  cabecera.totalItemsDeclarado = mTotalItems ? parseInt(mTotalItems[1], 10) : null;
  return cabecera;
}

// ---------- ítems: parser "de una sola línea" ----------
// Fila: N° · Descripción · Cantidad · Unidad de medida · Impto. Cargo% ·
// Vr. Unitario · Vr. Total. El ancla confiable es el N° al inicio; el resto
// se reconoce con un solo patrón porque, a diferencia de las compras, acá
// no hay una "Descripción" que se siga en la línea de abajo cuando es larga
// (Siigo la deja toda en un renglón en las facturas de venta que se
// probaron) — si algún día aparece una que sí se parte, cae al respaldo por
// columnas de abajo, igual que en recibos.js.
const inicioFilaRegex = /^(\d+)\s+\S/;
const filaRegex = /^(\d+)\s+(.+?)\s+([\d.,]+)\s+(\S+)\s+(\d+(?:[.,]\d+)?)\s*%\s+([\d.,]+)\s+([\d.,]+)\s*$/;

const ENCABEZADOS_TABLA_ITEMS = [
  { key: 'item', re: /^ítem$|^item$/i },
  { key: 'descripcion', re: /^descripci[oó]n$/i },
  { key: 'cantidad', re: /^cantidad$/i },
  { key: 'unidad', re: /^unidad\s*de\s*medida$/i },
  { key: 'iva', re: /^impto\.?\s*cargo$/i },
  { key: 'unitario', re: /^vr\.?\s*unitario$/i },
  { key: 'total', re: /^vr\.?\s*total$/i }
];

// Ver detectarColumnasEncabezado en recibos.js: mismo arreglo (16sep26) para
// que el fragmento "espacio en blanco" que Siigo mete entre cada título de
// columna no se cuele como si fuera parte del título y descuadre el centro
// calculado — necesario sobre todo para "Descripción", que es mucho más
// ancha que su propio título.
function detectarColumnasEncabezado(lineas){
  for(const linea of lineas){
    const encontrados = {};
    for(let i = 0; i < linea.length; i++){
      for(let span = 1; span <= 3 && i + span <= linea.length; span++){
        const grupo = linea.slice(i, i + span);
        const texto = grupo.map(t => t.str).join(' ').trim();
        const def = ENCABEZADOS_TABLA_ITEMS.find(h => h.re.test(texto));
        if(def && !encontrados[def.key]){
          const tokensReales = grupo.filter(t => t.str.trim() !== '');
          const base = tokensReales.length ? tokensReales : grupo;
          const xIni = base[0].x;
          const ultimo = base[base.length - 1];
          const xFin = ultimo.x + (ultimo.width || 0);
          encontrados[def.key] = { xCentro: (xIni + xFin) / 2, xIni, xFin, y: linea[0].y };
        }
      }
    }
    if(Object.keys(encontrados).length >= 5) return encontrados;
  }
  return null;
}

function parseItemsPorColumnas(paginas){
  const items = [];
  for(const pageItems of (paginas || [])){
    if(!pageItems || !pageItems.length) continue;
    const lineas = agruparLineas(pageItems, 3);
    const encontrados = detectarColumnasEncabezado(lineas);
    if(!encontrados || !encontrados.item || !encontrados.cantidad || !encontrados.total || !encontrados.descripcion) continue;

    const claves = Object.keys(encontrados).sort((a, b) => encontrados[a].xCentro - encontrados[b].xCentro);
    const limites = claves.map((k, i) => {
      const centro = encontrados[k].xCentro;
      const centroAnt = i > 0 ? encontrados[claves[i-1]].xCentro : null;
      const centroSig = i < claves.length - 1 ? encontrados[claves[i+1]].xCentro : null;
      return {
        key: k,
        inicio: centroAnt != null ? (centroAnt + centro) / 2 : -Infinity,
        fin: centroSig != null ? (centro + centroSig) / 2 : Infinity
      };
    });
    // "Descripción" es texto libre y mucho más ancha que su propio título —
    // se le da el hueco COMPLETO entre el borde real de la columna anterior
    // y el de la siguiente en vez de repartir por mitad (ver la nota larga
    // en recibos.js sobre la compra C-1899 de AXIO, mismo motivo acá).
    const idxDesc = claves.indexOf('descripcion');
    if(idxDesc !== -1){
      if(idxDesc > 0){
        const borde = encontrados[claves[idxDesc - 1]].xFin;
        limites[idxDesc - 1].fin = borde;
        limites[idxDesc].inicio = borde;
      }
      if(idxDesc < claves.length - 1){
        const borde = encontrados[claves[idxDesc + 1]].xIni;
        limites[idxDesc].fin = borde;
        limites[idxDesc + 1].inicio = borde;
      }
    }
    const columnaDe = x => {
      const l = limites.find(l => x >= l.inicio && x < l.fin);
      return l ? l.key : null;
    };

    const headerY = encontrados.item.y;
    const lineaValorLetras = lineas.find(l => /valor\s+en\s+letras/i.test(l.map(t => t.str).join(' ')));
    const limiteInferiorY = lineaValorLetras ? lineaValorLetras[0].y : -Infinity;

    const tokensDatos = pageItems.filter(it => it.y < headerY - 1 && it.y > limiteInferiorY);
    if(!tokensDatos.length) continue;

    const anclas = tokensDatos
      .filter(it => columnaDe(it.x) === 'item' && /^\d+$/.test(it.str.trim()))
      .sort((a, b) => b.y - a.y);
    if(!anclas.length) continue;

    const alturas = [];
    for(let i = 1; i < anclas.length; i++) alturas.push(anclas[i-1].y - anclas[i].y);
    alturas.sort((a,b) => a - b);
    const alturaFila = alturas.length ? alturas[Math.floor(alturas.length/2)] : 20;

    anclas.forEach((ancla, idx) => {
      const yPrevAncla = idx > 0 ? anclas[idx-1].y : null;
      const ySigAncla = idx < anclas.length - 1 ? anclas[idx+1].y : null;
      const yTope = yPrevAncla != null ? (ancla.y + yPrevAncla) / 2 : ancla.y + alturaFila / 2;
      const yPiso = ySigAncla != null ? (ancla.y + ySigAncla) / 2 : ancla.y - alturaFila / 2;
      const tokensFila = tokensDatos.filter(it => it.y <= yTope && it.y > yPiso);

      const porColumna = {};
      tokensFila.forEach(it => {
        const col = columnaDe(it.x);
        if(!col) return;
        (porColumna[col] = porColumna[col] || []).push(it);
      });
      const textoColumna = col => (porColumna[col] || []).sort((a,b) => a.x - b.x).map(t => t.str).join(' ').trim();

      const descripcion = textoColumna('descripcion');
      const cantidadTxt = textoColumna('cantidad');
      const totalTxt = textoColumna('total');
      if(!descripcion || !cantidadTxt || !totalTxt) return;

      items.push({
        codigo: textoColumna('item') || ancla.str,
        descripcion,
        cantidad: parseMoneyUS(cantidadTxt),
        unidad_medida: textoColumna('unidad') || 'Unidad',
        iva_pct: parsePct(textoColumna('iva')),
        valor_unitario: parseMoneyUS(textoColumna('unitario')),
        valor_total: parseMoneyUS(totalTxt)
      });
    });
  }
  return items;
}

// `totalItemsDeclarado` es el "Total items: N" que Siigo imprime en la
// factura — la única forma confiable de notar que el parser de una línea
// se quedó corto SIN que ninguna fila se vea rota. Descubierto con la
// factura FE 1147 (CAMACOL, 16sep26): cuando una "Descripción" es larga y
// se parte en 2 líneas, el N° de ítem queda solo en un renglón intermedio
// ("5" sin nada más al lado) — esa línea no arranca como una fila (no
// matchea inicioFilaRegex, que espera dígito+espacio+algo más) y tampoco
// la línea de arriba (empieza directo con texto) ni la de abajo (el resto
// de la descripción) — ninguna de las 3 se ve nunca como "una fila que
// casi calzó", así que antes esto pasaba TOTALMENTE en silencio: la
// factura cargaba con 4 de 6 ítems y ningún aviso en consola. Por eso ya
// no basta con revisar si quedaron 0 ítems para decidir si hace falta el
// respaldo por columnas — hay que comparar contra el total declarado.
function parseItemsVenta(texto, paginas, totalItemsDeclarado){
  const items = [];
  const lineas = texto.split('\n');
  const filasNoReconocidas = [];
  for(const lineaRaw of lineas){
    const linea = lineaRaw.trim();
    if(!linea || !inicioFilaRegex.test(linea)) continue;
    const m = linea.match(filaRegex);
    if(!m){ filasNoReconocidas.push(linea); continue; }
    items.push({
      codigo: m[1], descripcion: m[2].trim(), cantidad: parseMoneyUS(m[3]), unidad_medida: m[4],
      iva_pct: parsePct(m[5]), valor_unitario: parseMoneyUS(m[6]), valor_total: parseMoneyUS(m[7])
    });
  }
  if(filasNoReconocidas.length){
    console.warn('Importar factura de venta: se reconocieron', items.length, 'línea(s), pero', filasNoReconocidas.length, 'fila(s) parecían un ítem y no se pudieron leer completas:', filasNoReconocidas);
  }

  const faltanItems = totalItemsDeclarado != null && items.length < totalItemsDeclarado;
  if((!items.length || faltanItems) && paginas && paginas.length){
    const itemsPorColumnas = parseItemsPorColumnas(paginas);
    if(itemsPorColumnas.length > items.length){
      console.warn(`Importar factura de venta: el parser de una línea encontró ${items.length} de ${totalItemsDeclarado ?? '?'} ítem(s) declarados — se usó el respaldo por columnas y se encontraron ${itemsPorColumnas.length}.`);
      return itemsPorColumnas;
    }
  }
  return items;
}

// ---------- cruce automático con Órdenes ----------
function normalizarTexto(s){
  return String(s||'').toLowerCase().trim().replace(/\s+/g,' ');
}

// Cuántas palabras comparte la descripción del ítem de la factura con el
// producto de una orden — mismo criterio que puntajeSimilitud en
// recibos.js (materiales), aplicado acá a "producto" de la orden.
function puntajeSimilitud(descripcion, nombre){
  const palabrasDesc = new Set(normalizarTexto(descripcion).split(' ').filter(Boolean));
  const palabrasNom = normalizarTexto(nombre).split(' ').filter(Boolean);
  let comunes = 0;
  palabrasNom.forEach(p => { if(palabrasDesc.has(p)) comunes++; });
  return comunes;
}

// Todas las órdenes GENÉRICAS (opp_ordenes.orden — nunca una pieza -1/-2,
// esas viven aparte en opp_piezas) cuyo cliente calza con el de la factura,
// más recientes primero. Primero intenta calce exacto por nombre
// normalizado; si no hay ninguna, intenta que uno contenga al otro (para
// tolerar variaciones menores de escritura, ej. "Jiper SAS" vs "JIPER S.A.S").
function ordenesDeCliente(clienteFactura){
  if(!clienteFactura) return [];
  const texto = normalizarTexto(clienteFactura);
  let candidatas = DB.opp_ordenes.filter(o => normalizarTexto(o.cliente) === texto);
  if(!candidatas.length){
    candidatas = DB.opp_ordenes.filter(o => {
      const nc = normalizarTexto(o.cliente);
      return nc && (nc.includes(texto) || texto.includes(nc));
    });
  }
  return candidatas.slice().sort((a,b) => b.orden - a.orden);
}

// Para cada línea de la factura, sugiere la orden genérica asociada: si el
// cliente tiene una sola orden, se la asigna a todas las líneas (caso más
// común: una factura = una orden); si tiene varias, elige por parecido de
// nombre entre la descripción del ítem y el "producto" de cada orden — solo
// si hay un candidato mejor que el resto, sin empate. Si no hay forma de
// saber, se deja sin asociar para que la persona la elija a mano (nunca se
// inventa una asociación dudosa).
function autoAsociarOrdenes(items, clienteFactura){
  const candidatas = ordenesDeCliente(clienteFactura);
  items.forEach(it => {
    if(candidatas.length === 1){
      it.orden = candidatas[0].orden;
    } else if(candidatas.length > 1){
      const puntuadas = candidatas
        .map(o => ({ orden: o.orden, puntaje: puntajeSimilitud(it.descripcion, o.producto || '') }))
        .filter(x => x.puntaje > 0)
        .sort((a,b) => b.puntaje - a.puntaje);
      it.orden = (puntuadas.length && (puntuadas.length === 1 || puntuadas[0].puntaje > puntuadas[1].puntaje))
        ? puntuadas[0].orden : null;
    } else {
      it.orden = null;
    }
  });
}

function opcionesOrdenVenta(ordenSel, clienteFactura){
  const candidatas = ordenesDeCliente(clienteFactura);
  const opcion = o => `<option value="${o.orden}"${o.orden===ordenSel?' selected':''}>${o.orden} — ${o.producto||'(sin producto)'}${o.fecha?' · '+o.fecha.slice(0,10):''}</option>`;
  if(candidatas.length){
    const idsCandidatas = new Set(candidatas.map(o => o.orden));
    const resto = DB.opp_ordenes.filter(o => !idsCandidatas.has(o.orden)).slice().sort((a,b) => b.orden - a.orden).slice(0, 150);
    const etiquetaCliente = String(clienteFactura||'').replace(/"/g, "'").slice(0,40);
    return '<option value="">— Ninguna —</option>'
      + `<optgroup label="Órdenes de ${etiquetaCliente}">` + candidatas.map(opcion).join('') + '</optgroup>'
      + '<optgroup label="Todas las demás">' + resto.map(opcion).join('') + '</optgroup>';
  }
  const todas = DB.opp_ordenes.slice().sort((a,b) => b.orden - a.orden).slice(0, 200);
  return '<option value="">— Ninguna —</option>' + todas.map(opcion).join('');
}

// ---------- estado del formulario ----------
let itemsActuales = [];
let cabeceraActual = {};
let facturaEditandoId = null;
let editarFacturaSeq = 0;

function limpiarFormularioVenta(){
  editarFacturaSeq++;
  document.getElementById('fv-file').value = '';
  document.getElementById('fv-numero').value = '';
  document.getElementById('fv-fecha').value = '';
  document.getElementById('fv-nit').value = '';
  document.getElementById('fv-cliente').value = '';
  itemsActuales = [];
  cabeceraActual = {};
  facturaEditandoId = null;
  document.getElementById('fv-guardar').textContent = 'Guardar factura';
  const aviso = document.getElementById('fv-editando-aviso');
  if(aviso) aviso.style.display = 'none';
  renderTablaItemsVenta();
  actualizarResumenVenta();
  document.getElementById('fv-review').style.display = 'none';
}

async function manejarArchivoVenta(file){
  const hint = document.getElementById('fv-file-hint');
  document.getElementById('fv-review').style.display = '';
  editarFacturaSeq++;

  if(file.type === 'application/pdf'){
    hint.textContent = 'Leyendo el PDF…';
    try{
      const { texto, paginas } = await extraerTextoPDF(file);
      const cabecera = parseCabeceraVenta(texto);
      const items = parseItemsVenta(texto, paginas, cabecera.totalItemsDeclarado);
      items.forEach(it => { it.valor_neto = calcularNeto(it); });
      document.getElementById('fv-numero').value = cabecera.numero_factura;
      document.getElementById('fv-fecha').value = cabecera.fecha;
      document.getElementById('fv-nit').value = cabecera.nit;
      document.getElementById('fv-cliente').value = cabecera.cliente;
      autoAsociarOrdenes(items, cabecera.cliente);
      itemsActuales = items;
      cabeceraActual = cabecera;
      const conOrden = items.filter(it => it.orden).length;
      const yaCargada = cabecera.numero_factura && DB.facturas_venta.some(f => f.numero_factura === cabecera.numero_factura);
      const faltanTrasAmbosParsers = cabecera.totalItemsDeclarado != null && items.length < cabecera.totalItemsDeclarado;
      hint.textContent = (items.length
        ? `Se leyeron ${items.length} línea(s) automáticamente${conOrden ? ` (${conOrden} con orden de producción sugerida)` : ''} — revisa que estén correctas antes de guardar.`
        : 'No se pudieron reconocer líneas automáticamente en este PDF — agrégalas manualmente abajo.')
        + (faltanTrasAmbosParsers ? ` ⚠️ La factura dice tener ${cabecera.totalItemsDeclarado} ítem(s) pero solo se leyeron ${items.length} — agrega el resto a mano abajo.` : '')
        + (yaCargada ? ' ⚠️ Esta factura ya se había cargado antes — revisa que no sea un duplicado.' : '');
    }catch(err){
      console.error(err);
      hint.textContent = 'No se pudo leer el PDF automáticamente — completa los datos manualmente abajo.';
      itemsActuales = [];
      cabeceraActual = {};
    }
  } else {
    hint.textContent = 'Es una imagen — no se puede leer sola todavía. Completa los datos manualmente abajo.';
    itemsActuales = [];
    cabeceraActual = {};
  }

  renderTablaItemsVenta();
  actualizarResumenVenta();
}

function renderTablaItemsVenta(){
  const tbody = document.querySelector('#tbl-fv-items tbody');
  const clienteFactura = document.getElementById('fv-cliente')?.value || cabeceraActual.cliente || '';
  tbody.innerHTML = itemsActuales.map((it, i) => {
    const sinOrden = !it.orden;
    return `
    <tr data-i="${i}" style="${sinOrden?'background:var(--bg-warning,rgba(163,45,45,.05))':''}">
      <td><input type="text" class="fv-codigo" value="${it.codigo||''}" style="width:36px"></td>
      <td><input type="text" class="fv-desc" value="${it.descripcion||''}" style="width:100%;min-width:200px"></td>
      <td><input type="number" class="fv-cantidad num" value="${it.cantidad||0}" style="width:70px"></td>
      <td><input type="text" class="fv-unidad" value="${it.unidad_medida||''}" style="width:70px"></td>
      <td><input type="number" class="fv-iva num" value="${it.iva_pct||0}" style="width:55px"></td>
      <td><input type="number" class="fv-unitario num" value="${it.valor_unitario||0}" style="width:100px"></td>
      <td><input type="number" class="fv-total num" value="${it.valor_total||0}" style="width:110px"></td>
      <td class="num" title="Vr. Total ÷ (1 + IVA%) — lo que cuenta como ingreso de la orden">${fmtCOP(it.valor_neto ?? calcularNeto(it))}</td>
      <td><select class="fv-orden" title="${sinOrden?'No se pudo sugerir sola — elegí a cuál orden de producción corresponde':'Sugerida automáticamente por cliente/producto — cambiala si no es la correcta'}">${opcionesOrdenVenta(it.orden, clienteFactura)}</select></td>
      <td><input type="text" class="fv-obs" value="${it.observacion||''}" placeholder="opcional" style="width:100%;min-width:120px"></td>
      <td><button type="button" class="row-btn row-btn-danger fv-del">✕</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="11" style="text-align:center;color:var(--ink-faint)">Sin líneas todavía — agrega una manualmente</td></tr>';

  tbody.querySelectorAll('tr').forEach(tr => {
    const i = parseInt(tr.dataset.i, 10);
    if(isNaN(i)) return;
    // Recalcula el valor neto (sin IVA) de ESTA línea y refresca la celda
    // — depende de Vr. Total e IVA%, ver calcularNeto.
    const actualizarNetoFila = () => {
      itemsActuales[i].valor_neto = calcularNeto(itemsActuales[i]);
      tr.querySelector('td.num[title]').textContent = fmtCOP(itemsActuales[i].valor_neto);
      actualizarResumenVenta();
    };
    tr.querySelector('.fv-codigo').addEventListener('input', e => itemsActuales[i].codigo = e.target.value);
    tr.querySelector('.fv-desc').addEventListener('input', e => itemsActuales[i].descripcion = e.target.value);
    tr.querySelector('.fv-cantidad').addEventListener('input', e => { itemsActuales[i].cantidad = parseFloat(e.target.value)||0; actualizarResumenVenta(); });
    tr.querySelector('.fv-unidad').addEventListener('input', e => itemsActuales[i].unidad_medida = e.target.value);
    tr.querySelector('.fv-iva').addEventListener('input', e => { itemsActuales[i].iva_pct = parseFloat(e.target.value)||0; actualizarNetoFila(); });
    tr.querySelector('.fv-unitario').addEventListener('input', e => { itemsActuales[i].valor_unitario = parseFloat(e.target.value)||0; actualizarResumenVenta(); });
    tr.querySelector('.fv-total').addEventListener('input', e => { itemsActuales[i].valor_total = parseFloat(e.target.value)||0; actualizarNetoFila(); });
    tr.querySelector('.fv-orden').addEventListener('change', e => {
      itemsActuales[i].orden = e.target.value ? parseInt(e.target.value,10) : null;
      tr.style.background = itemsActuales[i].orden ? '' : 'var(--bg-warning,rgba(163,45,45,.05))';
      actualizarResumenVenta();
    });
    tr.querySelector('.fv-obs').addEventListener('input', e => itemsActuales[i].observacion = e.target.value);
    tr.querySelector('.fv-del').addEventListener('click', () => { itemsActuales.splice(i,1); renderTablaItemsVenta(); actualizarResumenVenta(); });
  });
}

function actualizarResumenVenta(){
  const hint = document.getElementById('fv-total-hint');
  if(!hint) return;
  const total = itemsActuales.reduce((s,it)=>s+(it.valor_total||0),0);
  const itemsConOrden = itemsActuales.filter(it => it.orden);
  // Solo las líneas CON orden asociada aportan a este total — las que no
  // tienen orden no se cuentan en ningún lado (pedido explícito 16sep26).
  const netoAsociado = itemsConOrden.reduce((s,it)=>s+(it.valor_neto ?? calcularNeto(it)),0);
  hint.innerHTML = `Total de líneas (con IVA): ${fmtCOP(total)} · ${itemsConOrden.length}/${itemsActuales.length} línea(s) con orden de producción asociada · Valor neto asociado a órdenes (sin IVA): ${fmtCOP(netoAsociado)}`;
}

async function guardarFacturaVenta(){
  const btn = document.getElementById('fv-guardar');
  const numero = document.getElementById('fv-numero').value.trim();
  const fecha = document.getElementById('fv-fecha').value || null;
  const nit = document.getElementById('fv-nit').value.trim() || null;
  const cliente = document.getElementById('fv-cliente').value.trim() || null;

  if(!itemsActuales.length){ toast('Agrega al menos una línea antes de guardar'); return; }

  const sinOrden = itemsActuales.filter(it => !it.orden);
  if(sinOrden.length){
    const listado = sinOrden.slice(0, 8).map(it => `• ${it.descripcion || it.codigo || '(sin descripción)'}`).join('\n')
      + (sinOrden.length > 8 ? `\n… y ${sinOrden.length - 8} más` : '');
    const seguir = confirm(
      `${sinOrden.length} línea(s) no tienen una orden de producción asociada:\n\n${listado}\n\n` +
      `Se pueden guardar igual y asociarlas después editando la factura.\n\n` +
      `Aceptar = guardar de todos modos · Cancelar = volver a revisar`
    );
    if(!seguir) return;
  }

  if(numero){
    const existente = DB.facturas_venta.find(f => f.numero_factura === numero && f.id !== facturaEditandoId);
    if(existente){
      const continuar = confirm(`Ya existe una factura guardada con el número "${numero}".\n\n¿Seguro que quieres guardarla de nuevo? Esto va a crear un registro duplicado.\n\nAceptar = guardar de todos modos · Cancelar = no guardar`);
      if(!continuar) return;
    }
  }

  const valorTotal = cabeceraActual.valor_total || itemsActuales.reduce((s,it)=>s+(it.valor_total||0),0);
  const user = getCurrentUser();
  const esEdicion = facturaEditandoId != null;
  btn.disabled = true; btn.textContent = 'Guardando…';
  try{
    const camposFactura = {
      numero_factura: numero || null, fecha, nit, cliente,
      total_bruto: cabeceraActual.total_bruto ?? null,
      iva: cabeceraActual.iva ?? null,
      valor_total: valorTotal || null,
      cargado_por: user ? user.nombre : null
    };

    let facturaId, facturaGuardada;
    if(esEdicion){
      facturaId = facturaEditandoId;
      const { error: errDelItems } = await sb.from('facturas_venta_items').delete().eq('factura_id', facturaId);
      if(errDelItems) throw errDelItems;
      const { data, error } = await sb.from('facturas_venta').update(camposFactura).eq('id', facturaId).select();
      if(error) throw error;
      facturaGuardada = data[0];
    } else {
      camposFactura.archivo_nombre = document.getElementById('fv-file').files[0]?.name || null;
      const { data, error } = await sb.from('facturas_venta').insert([camposFactura]).select();
      if(error) throw error;
      facturaGuardada = data[0];
      facturaId = facturaGuardada.id;
    }

    const payloadItems = itemsActuales.map(it => ({
      factura_id: facturaId, codigo: it.codigo || null, descripcion: it.descripcion || null,
      cantidad: it.cantidad || null, unidad_medida: it.unidad_medida || null,
      iva_pct: it.iva_pct || null, valor_unitario: it.valor_unitario || null, valor_total: it.valor_total || null,
      // Solo tiene sentido como "ingreso de la orden" en las líneas que sí
      // tienen una orden asociada — en las que no, igual se guarda el neto
      // calculado (es solo un dato de la línea), pero no cuenta para
      // ninguna orden porque `orden` queda null.
      valor_neto: it.valor_neto ?? calcularNeto(it),
      orden: it.orden || null, observacion: it.observacion || null
    }));
    const { error: errItems } = await sb.from('facturas_venta_items').insert(payloadItems);
    if(errItems) throw errItems;

    toast('Factura ' + (numero || facturaId) + (esEdicion ? ' actualizada con ' : ' guardada con ') + payloadItems.length + ' línea(s)'
      + (sinOrden.length ? ` · ${sinOrden.length} sin orden asociada todavía` : ''));

    if(esEdicion){
      const idx = DB.facturas_venta.findIndex(f => f.id === facturaId);
      if(idx>=0) DB.facturas_venta[idx] = facturaGuardada; else DB.facturas_venta.unshift(facturaGuardada);
    } else {
      DB.facturas_venta.unshift(facturaGuardada);
    }
    limpiarFormularioVenta();
    renderFacturasVentaCargadas();
  }catch(err){
    console.error(err);
    toast('Error al guardar la factura — revisa la consola');
  }finally{
    btn.disabled = false; btn.textContent = 'Guardar factura';
  }
}

async function editarFacturaVenta(facturaId){
  const factura = DB.facturas_venta.find(f => f.id === facturaId);
  if(!factura) return;
  const miSeq = ++editarFacturaSeq;
  try{
    const { data: items, error } = await sb.from('facturas_venta_items').select('*').eq('factura_id', facturaId).order('id');
    if(error) throw error;
    if(miSeq !== editarFacturaSeq) return; // se pidió editar otra factura mientras esta respuesta llegaba

    facturaEditandoId = facturaId;
    document.getElementById('fv-file').value = '';
    document.getElementById('fv-numero').value = factura.numero_factura || '';
    document.getElementById('fv-fecha').value = factura.fecha || '';
    document.getElementById('fv-nit').value = factura.nit || '';
    document.getElementById('fv-cliente').value = factura.cliente || '';
    cabeceraActual = { total_bruto: factura.total_bruto, iva: factura.iva, valor_total: factura.valor_total };
    itemsActuales = (items||[]).map(it => ({
      codigo: it.codigo || '', descripcion: it.descripcion || '', cantidad: it.cantidad || 0,
      unidad_medida: it.unidad_medida || '', iva_pct: it.iva_pct || 0, valor_unitario: it.valor_unitario || 0,
      valor_total: it.valor_total || 0, valor_neto: it.valor_neto ?? calcularNeto(it), orden: it.orden || null, observacion: it.observacion || ''
    }));

    document.getElementById('fv-review').style.display = '';
    document.getElementById('fv-guardar').textContent = 'Guardar cambios';
    const aviso = document.getElementById('fv-editando-aviso');
    if(aviso){
      aviso.style.display = '';
      aviso.textContent = `Editando "${factura.numero_factura || facturaId}" — al guardar se corrige esta factura (no se crea una nueva). "Limpiar" cancela la edición.`;
    }
    renderTablaItemsVenta();
    actualizarResumenVenta();
    document.getElementById('fv-import-card').scrollIntoView({ behavior:'smooth', block:'start' });
  }catch(err){
    console.error(err);
    toast('No se pudo cargar la factura para editar — revisa la consola');
  }
}

async function eliminarFacturaVenta(facturaId){
  const factura = DB.facturas_venta.find(f => f.id === facturaId);
  if(!factura) return;
  const seguro = confirm(`¿Eliminar la factura "${factura.numero_factura || facturaId}" (${factura.cliente || 'sin cliente'})?\n\nSe borra la factura y sus líneas. No se puede deshacer.`);
  if(!seguro) return;
  try{
    const { error: errDelItems } = await sb.from('facturas_venta_items').delete().eq('factura_id', facturaId);
    if(errDelItems) throw errDelItems;
    const { error: errDel } = await sb.from('facturas_venta').delete().eq('id', facturaId);
    if(errDel) throw errDel;
    const i = DB.facturas_venta.findIndex(f => f.id === facturaId);
    if(i >= 0) DB.facturas_venta.splice(i, 1);
    if(facturaEditandoId === facturaId) limpiarFormularioVenta();
    renderFacturasVentaCargadas();
    toast('Factura eliminada');
  }catch(err){
    console.error(err);
    toast('Error al eliminar la factura — revisa la consola');
  }
}

export function renderFacturasVentaCargadas(){
  const tbody = document.querySelector('#tbl-fv-cargadas tbody');
  if(!tbody) return;
  const recientes = [...DB.facturas_venta].sort((a,b) => (b.cargado_en||'').localeCompare(a.cargado_en||'')).slice(0, 30);
  tbody.innerHTML = recientes.map(f => `<tr data-id="${f.id}">
    <td>${(f.fecha||'').slice(0,10) || '—'}</td>
    <td>${f.numero_factura || '—'}</td>
    <td>${f.cliente || '—'}</td>
    <td class="num">${fmtCOP(f.valor_total||0)}</td>
    <td>${f.cargado_por || '—'}</td>
    <td><div class="row-actions">
      <button type="button" class="row-btn" data-edit-fv="${f.id}">Editar</button>
      <button type="button" class="row-btn row-btn-danger" data-del-fv="${f.id}">Eliminar</button>
    </div></td>
  </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Sin facturas de venta cargadas todavía</td></tr>';

  tbody.querySelectorAll('[data-edit-fv]').forEach(b => b.addEventListener('click', () => editarFacturaVenta(parseInt(b.dataset.editFv, 10))));
  tbody.querySelectorAll('[data-del-fv]').forEach(b => b.addEventListener('click', () => eliminarFacturaVenta(parseInt(b.dataset.delFv, 10))));
}

export function initVentas(){
  const fileInput = document.getElementById('fv-file');
  if(!fileInput) return; // esta pestaña no existe para este rol/página
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if(file) manejarArchivoVenta(file);
  });
  document.getElementById('fv-add-item').addEventListener('click', () => {
    itemsActuales.push({ codigo:'', descripcion:'', cantidad:0, unidad_medida:'Unidad', iva_pct:19, valor_unitario:0, valor_total:0, valor_neto:0, orden:null, observacion:'' });
    document.getElementById('fv-review').style.display = '';
    renderTablaItemsVenta();
    actualizarResumenVenta();
  });
  document.getElementById('fv-guardar').addEventListener('click', guardarFacturaVenta);
  document.getElementById('fv-limpiar').addEventListener('click', () => {
    if(itemsActuales.length && !confirm('¿Limpiar el formulario? Se perderá lo que hayas leído o escrito sin guardar.')) return;
    limpiarFormularioVenta();
  });
  // Si se corrige el cliente a mano (ej. la factura no trajo el nombre
  // exacto que usa Órdenes), recalcula las sugerencias de orden para las
  // líneas que todavía no tienen una asociada a mano.
  document.getElementById('fv-cliente').addEventListener('change', e => {
    autoAsociarOrdenes(itemsActuales.filter(it => !it.orden), e.target.value);
    renderTablaItemsVenta();
    actualizarResumenVenta();
  });
  renderFacturasVentaCargadas();
}
