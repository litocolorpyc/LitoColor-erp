import { sb } from './supabase-client.js';
import { DB } from './store.js';
import { toast, fmtCOP, fechaHoyLocal, etiquetaOrden } from './helpers.js';
import { getCurrentUser } from './auth.js';
import { renderMovimientosRecientes, renderResumenCostosMes, renderInformeCostos } from './costos.js';
import { renderInventario, invalidarEntradasInventario } from './inventario.js';
import { recostearConsumosDeMaterial, moverStockMaterial } from './registrar.js';

if(typeof pdfjsLib !== 'undefined'){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ---------- lectura del archivo ----------

// Agrupa fragmentos de texto (con su posición x/y) en líneas "a barrido":
// los ordena de arriba hacia abajo y agrupa los que caen a menos de `tol`
// de distancia vertical entre sí — una sola tabla puede tener columnas con
// la línea base a una fracción de punto de diferencia, y redondear con una
// rejilla fija a veces parte una misma fila en dos. Cada línea devuelta
// queda ordenada de izquierda a derecha.
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

// Los PDF que descarga Siigo (documentos "Compra") tienen el texto ya
// seleccionable (no son una imagen escaneada), así que se leen con pdf.js
// directamente en el navegador — sin subir el archivo a ningún servidor.
// Devuelve el texto ya armado en líneas (para la cabecera y el parser
// "de una línea") Y, por separado, los fragmentos crudos con su posición
// por página (para el parser "por columnas" que se usa como respaldo —
// ver parseItemsPorColumnas).
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
  // Admite "19.5" y "19,5" (coma decimal) — antes solo se quitaba todo lo
  // que no fuera dígito/punto, así que una coma decimal (posible en el
  // texto del PDF) se perdía entera y "19,5" quedaba leído como 195.
  const n = parseFloat(String(str).replace(',', '.').replace(/[^\d.]/g, ''));
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

// Etiquetas de encabezado de la tabla de ítems en el PDF de Siigo, en el
// orden en que aparecen de izquierda a derecha.
const ENCABEZADOS_TABLA_ITEMS = [
  { key: 'item', re: /^ítem$|^item$/i },
  { key: 'valor_desc', re: /^valor\s*desc\.?$/i },
  { key: 'iva', re: /^impto\.?\s*cargo$/i },
  { key: 'rete', re: /^impto\.?\s*rete\.?$/i },
  { key: 'unitario', re: /^vr\.?\s*unitario$/i },
  { key: 'descripcion', re: /^descripci[oó]n$/i },
  { key: 'cantidad', re: /^cantidad$/i },
  { key: 'total', re: /^vr\.?\s*total$/i }
];

// Busca, entre las líneas ya agrupadas de una página, la fila de
// encabezados de la tabla de ítems y devuelve el centro-x de cada columna
// reconocida (probando de a 1, 2 o 3 fragmentos seguidos, porque un mismo
// título como "Impto. Cargo" a veces llega en fragmentos separados).
function detectarColumnasEncabezado(lineas){
  for(const linea of lineas){
    const encontrados = {};
    for(let i = 0; i < linea.length; i++){
      for(let span = 1; span <= 3 && i + span <= linea.length; span++){
        const grupo = linea.slice(i, i + span);
        const texto = grupo.map(t => t.str).join(' ').trim();
        const def = ENCABEZADOS_TABLA_ITEMS.find(h => h.re.test(texto));
        if(def && !encontrados[def.key]){
          // Entre cada título de columna, Siigo mete un fragmento de texto
          // "espacio" que ocupa casi todo el hueco hasta el próximo título
          // (a veces 150-180pt de ancho). Si ese fragmento queda como el
          // primero del grupo que hizo match (grupo[0]), xIni terminaba
          // siendo el borde del espacio y no el de la palabra real del
          // título — eso descuadraba el centro calculado para columnas
          // anchas como "Descripción"/"Cantidad" y hacía que sus límites
          // quedaran mal ubicados. Por eso acá se ignoran los fragmentos
          // que son solo espacio en blanco al medir el ancho real.
          const tokensReales = grupo.filter(t => t.str.trim() !== '');
          const base = tokensReales.length ? tokensReales : grupo;
          const xIni = base[0].x;
          const ultimo = base[base.length - 1];
          const xFin = ultimo.x + (ultimo.width || 0);
          encontrados[def.key] = { xCentro: (xIni + xFin) / 2, xIni, xFin, y: linea[0].y };
        }
      }
    }
    // Si esta línea trae al menos 6 de los 8 encabezados esperados, es la fila de encabezado
    if(Object.keys(encontrados).length >= 6) return encontrados;
  }
  return null;
}

// Respaldo del parser "de una sola línea" (parseCompraTexto): en vez de
// reconstruir cada fila por su texto en orden de lectura, ubica cada
// fragmento de texto por su posición (x,y) real en la página y lo asigna a
// la columna de la tabla que le corresponde según su x. Esto es más lento
// de razonar pero mucho más tolerante a que "Cantidad"/"Vr. Total" queden
// con la línea base un poco corrida respecto al resto de la fila — algo
// que algunos PDF de Siigo hacen y que rompía por completo el parser de
// una línea (reportado 15sep26 con la compra C-1899 — Axio: subía la
// cabecera pero CERO artículos). Solo se usa cuando el parser normal no
// encontró ningún ítem, para no arriesgar los casos que ya funcionan bien.
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
    // "Descripción" es la única columna de texto libre (bastante más ancha
    // que su propio título) — al resto de columnas (numéricas, angostas) sí
    // les sirve repartir el límite a la mitad entre sus centros porque el
    // título ocupa casi todo el ancho de la columna. A "Descripción" en
    // cambio hay que darle el hueco COMPLETO entre el borde real de la
    // columna anterior y el de la siguiente, sin repartir por mitad —
    // si no, una descripción corta (ej. "OP 6002-1", que en esta factura
    // arranca pegada al final de "Vr. Unitario") cae mal clasificada en la
    // columna vecina y la fila entera se descarta por no tener descripción
    // (reportado con la compra C-1899 de AXIO, 16sep26).
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

    // Fragmentos de datos: debajo del encabezado, encima del cierre de la tabla
    const tokensDatos = pageItems.filter(it => it.y < headerY - 1 && it.y > limiteInferiorY);
    if(!tokensDatos.length) continue;

    // Anclas de fila: fragmentos en la columna "Ítem" que son solo un
    // número (1, 2, 3…) — son el dato más confiable para saber dónde
    // empieza cada fila, aunque el resto de la fila esté corrido.
    const anclas = tokensDatos
      .filter(it => columnaDe(it.x) === 'item' && /^\d+$/.test(it.str.trim()))
      .sort((a, b) => b.y - a.y);
    if(!anclas.length) continue;

    const alturas = [];
    for(let i = 1; i < anclas.length; i++) alturas.push(anclas[i-1].y - anclas[i].y);
    alturas.sort((a,b) => a - b);
    const alturaFila = alturas.length ? alturas[Math.floor(alturas.length/2)] : 20;

    // La banda de cada fila llega hasta la MITAD de camino hacia la fila
    // anterior/siguiente (partición por punto medio) — así dos filas nunca
    // se solapan y un dato con la línea base corrida (el jitter que
    // this respaldo existe para tolerar) cae en su fila real mientras el
    // corrimiento sea menor a medio renglón, sin arrastrar texto de la
    // fila vecina.
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
      // Si no se pudo armar lo esencial de la fila, se descarta — mejor
      // dejarla afuera (la persona la agrega a mano) que inventar un dato.
      if(!descripcion || !cantidadTxt || !totalTxt) return;

      const detectado = detectarOrdenEnTexto(descripcion);
      const conceptoSugerido = sugerirConceptoId(descripcion);
      items.push({
        codigo: textoColumna('item') || ancla.str,
        descripcion,
        valor_unitario: parseMoneyUS(textoColumna('unitario')),
        iva_pct: parsePct(textoColumna('iva')),
        retencion_pct: parsePct(textoColumna('rete')),
        cantidad: parseMoneyUS(cantidadTxt),
        valor_credito: parseMoneyUS(totalTxt),
        valor_debito: 0,
        orden: detectado.orden,
        suborden: detectado.suborden,
        observacion: detectado.suborden ? `Pieza sugerida: ${etiquetaOrden(detectado.orden)}-${detectado.suborden}` : '',
        concepto_id: conceptoSugerido,
        tipo_costo: tipoDeConcepto(conceptoSugerido)
      });
    });
  }
  return items;
}

// Intenta reconocer el formato "Compra" que genera Siigo. Si algo no
// calza, simplemente no lo llena — la persona lo completa a mano en la
// tabla de revisión, nunca se guarda nada sin que alguien lo confirme.
function parseCompraTexto(texto, paginas){
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
  // El inicio de la fila (N°, Valor desc., IVA%, Retención%, Vr. Unitario)
  // es el ancla confiable — casi no varía entre documentos. Lo que sí
  // varía es el final: cuando la Descripción es larga, Siigo la sigue en
  // la línea de abajo, y ahí es donde terminan quedando Cantidad/Vr. Total
  // — antes eso hacía que la fila NO calzara con el patrón de una sola
  // línea y se perdiera ENTERA (reportado 13sep26: "del PDF solo sube el
  // encabezado, sin ninguna línea"). Ahora, si la fila arranca bien pero no
  // completa el patrón, se le van pegando hasta 2 líneas siguientes antes
  // de darla por perdida.
  const inicioFilaRegex = /^(\d+)\s+([\d.,]+)\s+(\d+(?:[.,]\d+)?)\s*%\s+(\d+(?:[.,]\d+)?)\s*%\s+([\d.,]+)\s/;
  const filaRegex = /^(\d+)\s+([\d.,]+)\s+(\d+(?:[.,]\d+)?)\s*%\s+(\d+(?:[.,]\d+)?)\s*%\s+([\d.,]+)\s+(.+?)\s+([\d.,]+)\s+([\d.,]+)\s*$/;
  const lineas = texto.split('\n');
  const filasNoReconocidas = [];
  for(let i = 0; i < lineas.length; i++){
    let linea = lineas[i].trim();
    if(!linea || !inicioFilaRegex.test(linea)) continue;
    let m = linea.match(filaRegex);
    let usadas = 1;
    while(!m && usadas <= 2 && (i + usadas) < lineas.length){
      linea = (linea + ' ' + lineas[i + usadas].trim()).trim();
      m = linea.match(filaRegex);
      usadas++;
    }
    if(!m){
      filasNoReconocidas.push(lineas[i].trim());
      continue;
    }
    i += usadas - 1; // no reprocesar las líneas ya consumidas para completar esta fila
    const descripcion = m[6].trim();
    const detectado = detectarOrdenEnTexto(descripcion);
    const conceptoSugerido = sugerirConceptoId(descripcion);
    items.push({
      codigo: m[1],
      descripcion,
      valor_unitario: parseMoneyUS(m[5]),
      iva_pct: parsePct(m[3]),
      retencion_pct: parsePct(m[4]),
      cantidad: parseMoneyUS(m[7]),
      valor_credito: parseMoneyUS(m[8]), // se usa esta columna como "Vr. Total" del ítem
      valor_debito: 0,
      orden: detectado.orden,
      suborden: detectado.suborden,
      observacion: detectado.suborden ? `Pieza sugerida: ${etiquetaOrden(detectado.orden)}-${detectado.suborden}` : '',
      concepto_id: conceptoSugerido,
      tipo_costo: tipoDeConcepto(conceptoSugerido)
    });
  }
  // Si alguna fila arrancó como ítem (N°/valor desc./IVA%/Retención%/Vr.
  // Unitario reconocibles) pero no se pudo cerrar ni pegando líneas
  // siguientes, se deja registrado en consola — antes esto se perdía en
  // silencio total. Sirve para diagnosticar de una vez si vuelve a pasar
  // (F12 → Consola, después de subir el PDF).
  if(filasNoReconocidas.length){
    console.warn('Importar compra: se reconocieron', items.length, 'línea(s), pero', filasNoReconocidas.length, 'fila(s) parecían un ítem y no se pudieron leer completas:', filasNoReconocidas);
  }

  // Si el parser "de una línea" no encontró NINGÚN ítem, se intenta el
  // respaldo por columnas antes de rendirse — ver parseItemsPorColumnas.
  if(!items.length && paginas && paginas.length){
    const itemsPorColumnas = parseItemsPorColumnas(paginas);
    if(itemsPorColumnas.length){
      console.warn('Importar compra: el parser de una línea no reconoció ítems — se usó el respaldo por columnas y se encontraron', itemsPorColumnas.length, 'línea(s).');
      return { cabecera, items: itemsPorColumnas };
    }
  }

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
// Se incrementa cada vez que se pide "Editar" una compra — permite que
// editarRecibo() descarte una respuesta vieja de Supabase que llegue tarde
// (ej. si se hace clic en "Editar" de una compra y enseguida en la de otra):
// sin esto, si la primera petición de red tarda más que la segunda, sus
// datos pisan a los de la compra que sí se pidió ver al final, y en pantalla
// quedan dos compras con número distinto pero mostrando las mismas líneas.
let editarReciboSeq = 0;
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

// Muchas facturas (ej. las de AXIO por Siigo) no traen el nombre real del
// material en "Descripción" — solo el N° de orden ("OP 6002-1") — así que
// buscarMaterialParaLinea no tiene con qué adivinar y la línea queda "sin
// material" pidiendo elegir a mano entre ~200 (materias primas + insumos
// juntos). Por eso el selector de material ahora depende de `tipoFiltro`
// ('materias_primas' o 'insumos_area', elegido en la columna "¿Materia
// prima o insumo?" de al lado): sin ese tipo elegido todavía no se lista
// nada (para no hacer buscar entre los ~200 mezclados), y una vez elegido
// la lista se acorta a solo esa tabla.
function opcionesMaterialInventario(keySel, descripcion, tipoFiltro){
  if(!tipoFiltro){
    return '<option value="">— elegí primero si es materia prima o insumo —</option>';
  }
  const todos = tipoFiltro === 'materias_primas'
    ? DB.materias_primas.filter(m=>m.activo!==false).map(m => ({ key:m.codigo, nombre:m.nombre, etiqueta:`${m.nombre} (${m.codigo})` }))
    : DB.insumos_area.filter(m=>m.activo!==false).map(m => ({ key:String(m.id), nombre:m.nombre, etiqueta:`${m.nombre} (${m.area||'—'})` }));
  const opcion = m => `<option value="${m.key}"${keySel===m.key?' selected':''}>${m.etiqueta}</option>`;

  if(descripcion){
    const puntuados = todos.map(m => ({ ...m, puntaje: puntajeSimilitud(descripcion, m.nombre) }))
      .filter(m => m.puntaje > 0)
      .sort((a,b) => b.puntaje - a.puntaje)
      .slice(0, 8);
    if(puntuados.length){
      const restoKeys = new Set(puntuados.map(m => m.key));
      const resto = todos.filter(m => !restoKeys.has(m.key));
      const etiquetaGrupo = ('Parecidos a: ' + descripcion.slice(0,40)).replace(/"/g, "'");
      return '<option value="">— sin coincidencia, elegí uno —</option>'
        + `<optgroup label="${etiquetaGrupo}">` + puntuados.map(opcion).join('') + '</optgroup>'
        + '<optgroup label="Todos">' + resto.map(opcion).join('') + '</optgroup>';
    }
  }
  return '<option value="">— sin coincidencia, elegí uno —</option>' + todos.map(opcion).join('');
}

function opcionesOrden(ordenSeleccionada){
  const activas = DB.opp_ordenes.slice().sort((a,b) => b.orden - a.orden).slice(0, 200);
  return '<option value="">— Ninguna —</option>' +
    activas.map(o => `<option value="${o.orden}"${o.orden===ordenSeleccionada?' selected':''}>${etiquetaOrden(o.orden)} — ${o.cliente||''}</option>`).join('');
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
      <td><select class="ri-tipo-mat" title="Elegí esto primero — de eso depende qué lista aparece en 'Material del inventario'">
        <option value="">— Elegí —</option>
        <option value="materias_primas"${it.material_tabla==='materias_primas'?' selected':''}>Materia prima</option>
        <option value="insumos_area"${it.material_tabla==='insumos_area'?' selected':''}>Insumo</option>
      </select></td>
      <td><select class="ri-material" title="${sinMaterial?'Sin coincidencia — elegí el material real para que actualice el inventario':'Se va a sumar la cantidad al stock y actualizar el costo por unidad de este material'}">${opcionesMaterialInventario(it.material_key, it.descripcion, it.material_tabla)}</select></td>
      <td><select class="ri-orden">${opcionesOrden(it.orden)}</select></td>
      <td><input type="number" class="ri-suborden" value="${it.suborden||''}" placeholder="sub." title="Suborden / pieza (ej. el 2 de OP5955-2)" style="width:55px"></td>
      <td><select class="ri-concepto">${opcionesConcepto(it.concepto_id)}</select></td>
      <td><select class="ri-tipo"><option value="">—</option><option value="Fijo"${it.tipo_costo==='Fijo'?' selected':''}>Fijo</option><option value="Variable"${it.tipo_costo==='Variable'?' selected':''}>Variable</option></select></td>
      <td><input type="text" class="ri-obs" value="${it.observacion||''}" placeholder="opcional" style="width:100%;min-width:120px"></td>
      <td><button type="button" class="row-btn row-btn-danger ri-del">✕</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="16" style="text-align:center;color:var(--ink-faint)">Sin líneas todavía — agrega una manualmente</td></tr>';

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
    // "¿Materia prima o insumo?": al cambiar, la selección de material
    // anterior ya no aplica (podía ser de la otra tabla) — se limpia y se
    // recarga la lista de "Material del inventario" acotada a la tabla
    // elegida, ver opcionesMaterialInventario.
    tr.querySelector('.ri-tipo-mat').addEventListener('change', e => {
      const tipo = e.target.value || null;
      itemsActuales[i].material_tabla = tipo;
      itemsActuales[i].material_key = null;
      tr.querySelector('.ri-material').innerHTML = opcionesMaterialInventario(null, itemsActuales[i].descripcion, tipo);
      tr.style.background = 'var(--bg-warning,rgba(163,45,45,.05))';
      actualizarResumen();
    });
    tr.querySelector('.ri-material').addEventListener('change', e => {
      itemsActuales[i].material_key = e.target.value || null;
      tr.style.background = (itemsActuales[i].material_tabla && itemsActuales[i].material_key) ? '' : 'var(--bg-warning,rgba(163,45,45,.05))';
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
  // Invalida cualquier "Editar" en curso — si su respuesta llega después de
  // elegir este archivo nuevo, no debe pisar lo que se acaba de leer aquí.
  editarReciboSeq++;

  if(file.type === 'application/pdf'){
    hint.textContent = 'Leyendo el PDF…';
    try{
      const { texto, paginas } = await extraerTextoPDF(file);
      const { cabecera, items } = parseCompraTexto(texto, paginas);
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
  editarReciboSeq++; // invalida cualquier "Editar" en curso, ver arriba
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
  const miSeq = ++editarReciboSeq;
  try{
    const { data: items, error } = await sb.from('recibos_caja_items').select('*').eq('recibo_id', reciboId).order('id');
    if(error) throw error;

    // Si mientras se esperaba esta respuesta se pidió "Editar" otra compra,
    // esta ya quedó vieja — no pisar lo que se está mostrando ahora.
    if(miSeq !== editarReciboSeq) return;

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

// ---------- costo promedio ponderado (pedido 23sep26) ----------
// El mismo papel se compra a varios proveedores con precios distintos.
// Antes, cada compra REEMPLAZABA el costo por unidad del material por el
// precio de esa última compra — todo el papel en bodega (incluido el que se
// compró antes a otro precio) salía en guillotina al último precio, y una
// línea sin valor neto dejaba el costo en blanco. Ahora el costo por unidad
// es el promedio ponderado entre lo que había en bodega y lo que entra:
//   (stock × costo actual + cantidad comprada × costo de la compra) ÷ (stock + cantidad)
// Si no había stock (0 o negativo, típico cuando se consumió antes de
// registrar la compra) o el material no tenía costo, queda el de la compra.
export function costoPromedioConCompra(stockPrevio, costoPrevio, cantidad, costoCompra){
  const cp = Number(costoCompra);
  if(!cp || cp <= 0) return costoPrevio ?? null; // la compra no trae costo: no se toca el que había
  const s = Number(stockPrevio) || 0, c = Number(costoPrevio) || 0, q = Number(cantidad) || 0;
  if(s <= 0 || c <= 0 || q <= 0) return cp;
  return (s * c + q * cp) / (s + q);
}

// Contrario del anterior: al borrar/editar una compra, saca del promedio lo
// que esa compra había aportado. Si no queda stock o el resultado no tiene
// sentido (porque en el medio hubo otras compras/consumos), deja el costo
// como está en vez de inventar uno. Devuelve null = no cambiar el costo.
function costoPromedioSinCompra(stockActual, costoActual, cantidad, costoCompra){
  const s = Number(stockActual) || 0, c = Number(costoActual) || 0, q = Number(cantidad) || 0, cp = Number(costoCompra) || 0;
  const restante = s - q;
  if(!cp || !c || restante <= 0) return null;
  const costo = (s * c - q * cp) / restante;
  return isFinite(costo) && costo > 0 ? costo : null;
}

// Trae el stock y costo reales del momento (no los de cuando se abrió la
// página) antes de promediar — si no, dos personas registrando compras o
// consumos a la vez harían el promedio con números viejos.
async function refrescarMaterial(tabla, keyCol, keyVal, mat){
  try{
    const { data, error } = await sb.from(tabla).select('*').eq(keyCol, keyVal).single();
    if(error) throw error;
    if(data) Object.assign(mat, data);
  }catch(err){
    console.error('No se pudo refrescar el material antes de actualizar su costo (se usa el dato en memoria):', err);
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
      await refrescarMaterial(tabla, keyCol, keyVal, mat);
      const costoSinEstaCompra = costoPromedioSinCompra(mat.stock_actual, mat.costo_unitario, it.cantidad, it.valor_neto_unitario);
      // El stock se resta directo en la base (ver moverStockMaterial en
      // registrar.js) — nunca se escribe un número calculado en la página.
      await moverStockMaterial(tabla, keyVal, -it.cantidad);
      if(costoSinEstaCompra != null){
        const { data, error } = await sb.from(tabla).update({ costo_unitario: costoSinEstaCompra }).eq(keyCol, keyVal).select();
        if(error) throw error;
        Object.assign(mat, data[0]);
      }
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
          await refrescarMaterial('materias_primas', 'codigo', it.material_key, mat);
          const nuevoCosto = costoPromedioConCompra(mat.stock_actual, mat.costo_unitario, it.cantidad, it.valor_neto_unitario);
          // Stock: se suma directo en la base (ver moverStockMaterial en
          // registrar.js); el costo promedio se guarda aparte.
          await moverStockMaterial('materias_primas', it.material_key, it.cantidad);
          const { data, error } = await sb.from('materias_primas')
            .update({ costo_unitario: nuevoCosto }).eq('codigo', it.material_key).select();
          if(error) throw error;
          Object.assign(mat, data[0]);
          recostearConsumosDeMaterial(mat.nombre);
        } else {
          const mat = DB.insumos_area.find(m => String(m.id) === it.material_key);
          if(!mat) throw new Error('material no encontrado en memoria');
          await refrescarMaterial('insumos_area', 'id', mat.id, mat);
          const nuevoCosto = costoPromedioConCompra(mat.stock_actual, mat.costo_unitario, it.cantidad, it.valor_neto_unitario);
          await moverStockMaterial('insumos_area', mat.id, it.cantidad);
          const { data, error } = await sb.from('insumos_area')
            .update({ costo_unitario: nuevoCosto }).eq('id', mat.id).select();
          if(error) throw error;
          Object.assign(mat, data[0]);
          recostearConsumosDeMaterial(mat.nombre);
        }
        materialesActualizados++;
      }catch(err){
        console.error('No se pudo actualizar el inventario de "' + it.descripcion + '":', err);
        materialesFallidos.push(it.descripcion || it.codigo || '(sin descripción)');
      }
    }
    // Las líneas de esta compra recién insertadas (payloadItems, arriba) son
    // justo la fuente de las "Entradas" del Kardex de Inventario — sin
    // invalidar el caché, la tabla de Movimientos seguiría mostrando la
    // versión vieja hasta recargar la página.
    if(materialesActualizados){ invalidarEntradasInventario(); renderInventario(); }

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
        renderInformeCostos();
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
// Filtra sobre lo que YA está en memoria (las últimas 100 que carga la app
// al abrir, ver store.js) — no consulta Supabase de nuevo. Para buscar una
// compra más vieja que ya se salió de ese caché, está el Informe de compras
// más abajo, que sí busca directo en la base.
function filtrarRecibosCargados(){
  const desde = document.getElementById('rec-cargados-desde')?.value || '';
  const hasta = document.getElementById('rec-cargados-hasta')?.value || '';
  const numero = (document.getElementById('rec-cargados-numero')?.value || '').trim().toLowerCase();
  const proveedor = (document.getElementById('rec-cargados-proveedor')?.value || '').trim().toLowerCase();
  const sinFiltros = !desde && !hasta && !numero && !proveedor;

  let filas = [...DB.recibos_caja];
  if(desde) filas = filas.filter(r => (r.fecha||'') >= desde);
  if(hasta) filas = filas.filter(r => (r.fecha||'') <= hasta);
  if(numero) filas = filas.filter(r => (r.numero_recibo||'').toLowerCase().includes(numero));
  if(proveedor) filas = filas.filter(r => (r.tercero||'').toLowerCase().includes(proveedor));
  filas.sort((a,b) => (b.cargado_en||'').localeCompare(a.cargado_en||''));
  // Sin filtros: se mantiene el comportamiento de siempre (solo las 30 más
  // recientes). Con algún filtro puesto, se muestran todas las que calcen
  // entre las que ya están cargadas — la persona está buscando algo puntual.
  return sinFiltros ? filas.slice(0, 30) : filas;
}

export function renderRecibosCargados(){
  const tbody = document.querySelector('#tbl-recibos-cargados tbody');
  if(!tbody) return;
  const recientes = filtrarRecibosCargados();
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
  </tr>`).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">${DB.recibos_caja.length ? 'Ninguna de las cargadas recientemente calza con ese filtro' : 'Sin compras cargadas todavía'}</td></tr>`;

  tbody.querySelectorAll('[data-edit-recibo]').forEach(b => b.addEventListener('click', () => {
    editarRecibo(parseInt(b.dataset.editRecibo, 10));
  }));
  tbody.querySelectorAll('[data-del-recibo]').forEach(b => b.addEventListener('click', () => {
    eliminarRecibo(parseInt(b.dataset.delRecibo, 10));
  }));
}

// `reciboConocido` es opcional: lo manda el Informe de compras cuando el
// documento a borrar es viejo y ya no está en el caché local de las
// últimas 100 (DB.recibos_caja) — sin esto, borrar desde el informe una
// compra vieja fallaba en silencio porque no la encontraba ahí.
async function eliminarRecibo(reciboId, reciboConocido){
  const recibo = reciboConocido || DB.recibos_caja.find(r => r.id === reciboId);
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

    invalidarEntradasInventario();
    renderInventario();
    renderMovimientosRecientes();
    renderResumenCostosMes();
    renderInformeCostos();
    renderRecibosCargados();
    document.getElementById('informe-compra-detalle-modal')?.style.setProperty('display', 'none');
    if(document.getElementById('informe-compras-buscar')) buscarInformeCompras();
    toast('Documento eliminado — inventario y costos revertidos');
  }catch(err){
    console.error(err);
    toast('Error al eliminar el documento — revisa la consola');
  }
}

// ---------- Informe de compras: buscar y ver detalle (solo lectura) ----------
// A diferencia de "Compras cargadas" (que solo muestra las últimas 100 que
// ya están en memoria, para editar/eliminar), este informe consulta
// Supabase directo cada vez que se busca — así también encuentra compras
// viejas que ya no están en el caché local. Filtra por rango de fecha y/o
// por N° de compra (coincidencia parcial); sin ningún filtro, trae las 50
// más recientes.
async function buscarInformeCompras(){
  const desde = document.getElementById('informe-compras-desde').value || null;
  const hasta = document.getElementById('informe-compras-hasta').value || null;
  const numero = document.getElementById('informe-compras-numero').value.trim();
  const hint = document.getElementById('informe-compras-hint');
  const tbody = document.querySelector('#tbl-informe-compras tbody');
  hint.textContent = 'Buscando…';
  tbody.innerHTML = '';
  try{
    let query = sb.from('recibos_caja').select('*').order('fecha', { ascending: false }).order('cargado_en', { ascending: false });
    if(desde) query = query.gte('fecha', desde);
    if(hasta) query = query.lte('fecha', hasta);
    if(numero) query = query.ilike('numero_recibo', `%${numero}%`);
    if(!desde && !hasta && !numero) query = query.limit(50);
    const { data, error } = await query;
    if(error) throw error;

    const filas = data || [];
    tbody.innerHTML = filas.map(r => `<tr data-id="${r.id}" style="cursor:pointer">
      <td>${(r.fecha||'').slice(0,10) || '—'}</td>
      <td>${r.numero_recibo || '—'}</td>
      <td>${r.tercero || '—'}</td>
      <td class="num">${fmtCOP(r.valor_total||0)}</td>
      <td>${r.cargado_por || '—'}</td>
      <td><button type="button" class="row-btn row-btn-danger" data-del-informe="${r.id}">Eliminar</button></td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">No se encontraron compras con esos filtros</td></tr>';

    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => mostrarDetalleCompra(parseInt(tr.dataset.id, 10), filas.find(r => r.id === parseInt(tr.dataset.id, 10))));
    });
    // Botón "Eliminar" de la fila: para el clic antes de que llegue a la
    // fila (si no, además de borrar se abriría el detalle de un documento
    // que ya no existe).
    tbody.querySelectorAll('[data-del-informe]').forEach(b => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = parseInt(b.dataset.delInforme, 10);
      eliminarRecibo(id, filas.find(r => r.id === id));
    }));

    hint.textContent = filas.length
      ? `${filas.length} compra(s) encontrada(s)` + (!desde && !hasta && !numero ? ' (las 50 más recientes — usa los filtros para buscar más atrás)' : '')
      : 'Sin resultados';
  }catch(err){
    console.error(err);
    hint.textContent = 'Error al buscar — revisa la consola';
  }
}

// Recuerda qué compra está abierta en el modal de detalle, para que el
// botón "Eliminar esta compra" del modal sepa cuál borrar.
let reciboDetalleActual = null;

async function mostrarDetalleCompra(reciboId, cabecera){
  reciboDetalleActual = { id: reciboId, cabecera };
  const modal = document.getElementById('informe-compra-detalle-modal');
  const titulo = document.getElementById('informe-compra-detalle-titulo');
  const cabeceraEl = document.getElementById('informe-compra-detalle-cabecera');
  const tbody = document.querySelector('#tbl-informe-compra-detalle tbody');
  titulo.textContent = 'Detalle de la compra ' + (cabecera?.numero_recibo || reciboId);
  cabeceraEl.textContent = [
    cabecera?.fecha ? 'Fecha: ' + cabecera.fecha.slice(0,10) : null,
    cabecera?.tercero ? 'Proveedor: ' + cabecera.tercero : null,
    cabecera?.nit ? 'NIT: ' + cabecera.nit : null,
    'Total: ' + fmtCOP(cabecera?.valor_total||0),
    cabecera?.cargado_por ? 'Cargado por: ' + cabecera.cargado_por : null
  ].filter(Boolean).join(' · ');
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--ink-faint)">Cargando…</td></tr>';
  modal.style.display = 'flex';

  try{
    const { data: items, error } = await sb.from('recibos_caja_items').select('*').eq('recibo_id', reciboId).order('id');
    if(error) throw error;
    tbody.innerHTML = (items||[]).map(it => `<tr>
      <td>${it.codigo || '—'}</td>
      <td>${it.descripcion || '—'}</td>
      <td class="num">${it.cantidad ?? '—'}</td>
      <td class="num">${fmtCOP(it.valor_unitario||0)}</td>
      <td class="num">${it.iva_pct ?? '—'}</td>
      <td class="num">${it.retencion_pct ?? '—'}</td>
      <td class="num">${fmtCOP(it.valor_credito||0)}</td>
      <td class="num">${fmtCOP(it.valor_neto_unitario||0)}</td>
      <td>${it.orden ? etiquetaOrden(it.orden) + (it.suborden ? '-' + it.suborden : '') : '—'}</td>
      <td>${DB.costos_conceptos.find(c => c.id === it.concepto_id)?.nombre || '—'}</td>
    </tr>`).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--ink-faint)">Sin líneas</td></tr>';
  }catch(err){
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--ink-faint)">Error al cargar el detalle — revisa la consola</td></tr>';
  }
}

function initInformeCompras(){
  const buscarBtn = document.getElementById('informe-compras-buscar');
  if(!buscarBtn) return; // esta tarjeta no existe en esta página
  buscarBtn.addEventListener('click', buscarInformeCompras);
  document.getElementById('informe-compras-limpiar').addEventListener('click', () => {
    document.getElementById('informe-compras-desde').value = '';
    document.getElementById('informe-compras-hasta').value = '';
    document.getElementById('informe-compras-numero').value = '';
    buscarInformeCompras();
  });
  document.getElementById('informe-compra-detalle-cerrar').addEventListener('click', () => {
    document.getElementById('informe-compra-detalle-modal').style.display = 'none';
  });
  document.getElementById('informe-compra-detalle-eliminar').addEventListener('click', () => {
    if(!reciboDetalleActual) return;
    eliminarRecibo(reciboDetalleActual.id, reciboDetalleActual.cabecera);
  });
  buscarInformeCompras();
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
  ['rec-cargados-desde','rec-cargados-hasta','rec-cargados-numero','rec-cargados-proveedor'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderRecibosCargados);
  });
  renderRecibosCargados();
  initInformeCompras();
}
