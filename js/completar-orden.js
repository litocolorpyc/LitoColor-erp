// Reimportar el Excel de una orden que YA existe (pedido nov-2026): solo se
// rellena lo que está en blanco. Un dato que ya existe NO se toca, aunque el
// Excel traiga otro. Este módulo solo calcula qué hay que rellenar; no lee ni
// escribe en la base.

const norm = s => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
export const estaVacio = v => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
// "Según Excel: —" es el relleno que deja el importador cuando la celda venía vacía.
const texto = v => estaVacio(v) || v === 'Según Excel: —' ? null : String(v).trim();
const numero = v => { if(estaVacio(v)) return null; const n = parseFloat(v); return isNaN(n) ? null : n; };
const igual = (a, b) => typeof b === 'number' ? Math.abs(Number(a) - b) < 0.01 : norm(a) === norm(b);

export const ETIQUETAS = {
  cliente: 'Cliente', producto: 'Producto', pieza: 'Nombre de la pieza', cantidad: 'Cantidad',
  tamano_ancho: 'Tamaño ancho', tamano_alto: 'Tamaño alto', papel: 'Papel', tintas_frente: 'Tintas tiro', tintas_atras: 'Tintas retiro',
  tintas_detalle_tiro: 'Detalle tintas tiro', tintas_detalle_retiro: 'Detalle tintas retiro', ctp: 'CTP', tira_retira: 'Tipo de montaje',
  laminado: 'Laminado', laminado_lados: 'Lados laminados', barniz_uv: 'Barniz UV', troquelado: 'Troquelado', troquel_detalle: 'Troquel',
  talonarios: 'Talonarios', otros_acabados: 'Otros acabados', unidades_por_montaje: 'Unidades por montaje',
  medida_tamano_ancho: 'Medida con margen (ancho)', medida_tamano_alto: 'Medida con margen (alto)', tamanos_por_pliego: 'Tamaños por pliego',
  tamanos_programados: 'Tamaños programados', tamanos_solicitados: 'Tamaños solicitados', pliegos: 'Pliegos',
  costo: 'Costo', imprevistos: 'Imprevistos', total_costo: 'Total costo', precio_venta_antes_iva: 'Precio antes de IVA', precio_con_iva: 'Precio con IVA', items: 'Detalle del presupuesto'
};

// Datos de una pieza tal como vienen en el Excel, ya con el tipo correcto.
// null = el Excel no lo trae (y por lo tanto no sirve para rellenar nada).
function valoresExcel(x){
  const v = {
    pieza: texto(x.pieza), cantidad: numero(x.cantidad), tamano_ancho: numero(x.tamano_ancho), tamano_alto: numero(x.tamano_alto),
    papel: texto(x.papel), tintas_frente: numero(x.tintas_frente), tintas_atras: numero(x.tintas_atras),
    tintas_detalle_tiro: texto(x.tintas_detalle_tiro), tintas_detalle_retiro: texto(x.tintas_detalle_retiro),
    ctp: texto(x.ctp), tira_retira: texto(x.tira_retira), laminado: texto(x.laminado), laminado_lados: numero(x.laminado_lados),
    troquel_detalle: texto(x.troquel_detalle), otros_acabados: texto(x.otros_acabados), unidades_por_montaje: numero(x.unidades_por_montaje),
    medida_tamano_ancho: numero(x.medida_tamano_ancho), medida_tamano_alto: numero(x.medida_tamano_alto),
    tamanos_por_pliego: numero(x.tamanos_por_pliego), tamanos_programados: numero(x.tamanos_programados),
    barniz_uv: x.barniz_uv ? true : null, troquelado: x.troquelado ? true : null, talonarios: x.talonarios ? true : null
  };
  if(v.cantidad > 0) v.tamanos_solicitados = Math.ceil(v.cantidad / (v.unidades_por_montaje || 1));
  return v;
}

// Empareja cada pieza del Excel con una guardada: primero por nombre y, si no,
// por número de suborden.
function emparejar(excel, guardadas){
  const libres = new Set(guardadas);
  const pares = excel.map(x => {
    const g = x.pieza ? [...libres].find(p => norm(p.pieza) === norm(x.pieza) && p.suborden === Number(x.suborden))
      || [...libres].find(p => norm(p.pieza) === norm(x.pieza)) : null;
    if(g) libres.delete(g);
    return { x, g };
  });
  pares.filter(p => !p.g).forEach(p => {
    const g = [...libres].find(q => q.suborden === Number(p.x.suborden));
    if(g){ p.g = g; libres.delete(g); }
  });
  return pares;
}

export function planCompletarOrden({ orden, piezas, presupuesto, presupuestoPiezas, excel }){
  const plan = { cabecera: {}, piezas: [], nuevas: [], presupuesto: null, presupuestoPiezas: [], distintos: [] };
  const rellenar = (actual, nuevos, donde, vacio = estaVacio) => {
    const cambios = {};
    Object.entries(nuevos).forEach(([k, v]) => {
      if(v == null) return;
      if(vacio(actual[k], k)) cambios[k] = v;
      else if(k !== 'items' && !igual(actual[k], v)) plan.distintos.push({ donde, campo: ETIQUETAS[k] || k, actual: actual[k], excel: v });
    });
    return cambios;
  };

  const primera = excel[0] || {};
  plan.cabecera = rellenar(orden, { cliente: texto(primera.cliente), producto: texto(primera.producto) }, 'Orden');

  const usadas = new Set(piezas.map(p => p.suborden));
  const subordenDe = new Map(); // pieza del Excel -> suborden en el aplicativo
  emparejar(excel, piezas).forEach(({ x, g }) => {
    if(!g){
      let n = Number(x.suborden) || 1;
      while(usadas.has(n)) n++;
      usadas.add(n); subordenDe.set(x, n);
      plan.nuevas.push({ suborden: n, excel: x });
      return;
    }
    subordenDe.set(x, g.suborden);
    const v = valoresExcel(x);
    // "0 lados" solo cuenta como vacío si la pieza tampoco tenía laminado.
    const sinLaminado = estaVacio(g.laminado);
    const cambios = rellenar(g, v, `SubOrden ${g.suborden}`, (actual, k) => estaVacio(actual) || (k === 'laminado_lados' && sinLaminado && !Number(actual) && v.laminado != null));
    // Pliegos: se calcula con lo que quede guardado (lo existente manda).
    const programados = Number(cambios.tamanos_programados ?? g.tamanos_programados), porPliego = Number(cambios.tamanos_por_pliego ?? g.tamanos_por_pliego);
    if(estaVacio(g.pliegos) && programados > 0 && porPliego > 0) cambios.pliegos = Math.ceil(programados / porPliego);
    if(Object.keys(cambios).length) plan.piezas.push({ id: g.id, suborden: g.suborden, cambios });
  });

  // Presupuesto: aquí un 0 también es "en blanco" (el aplicativo guarda 0 cuando no se escribe nada).
  const sinValor = v => estaVacio(v) || Number(v) === 0;
  const plata = x => ({ costo: numero(x.costo) || null, imprevistos: numero(x.imprevistos) || null,
    precio_venta_antes_iva: numero(x.precio_venta_antes_iva) || null, precio_con_iva: numero(x.precio_con_iva) || null });
  const completarPresupuesto = (actual, nuevos, donde) => {
    const cambios = rellenar(actual || {}, nuevos, donde, sinValor);
    if(!Object.keys(cambios).length) return null;
    const final = { ...(actual || {}), ...cambios };
    const total = Number(final.costo || 0) + Number(final.imprevistos || 0);
    // El total se actualiza solo si estaba vacío o si era exactamente la suma
    // anterior (un cálculo). Un total escrito distinto se respeta.
    const totalAnterior = Number(actual?.costo || 0) + Number(actual?.imprevistos || 0);
    const eraCalculo = !sinValor(actual?.total_costo) && igual(actual.total_costo, totalAnterior);
    if(total > 0 && (sinValor(actual?.total_costo) || (eraCalculo && ('costo' in cambios || 'imprevistos' in cambios)))) cambios.total_costo = total;
    return cambios;
  };

  const suma = k => excel.reduce((s, x) => s + (numero(x[k]) || 0), 0);
  const cambiosPres = completarPresupuesto(presupuesto, plata({ costo: suma('costo'), imprevistos: suma('imprevistos'),
    precio_venta_antes_iva: suma('precio_venta_antes_iva'), precio_con_iva: suma('precio_con_iva') }), 'Presupuesto de la orden');
  if(cambiosPres){
    const final = { ...(presupuesto || {}), ...cambiosPres };
    const precio = Number(final.precio_venta_antes_iva), total = Number(final.total_costo);
    const cambioBase = 'total_costo' in cambiosPres || 'precio_venta_antes_iva' in cambiosPres;
    if(precio > 0 && total > 0 && (cambioBase || estaVacio(presupuesto?.rentabilidad_esperada_pct))) cambiosPres.rentabilidad_esperada_pct = (precio - total) / precio * 100;
    plan.presupuesto = { existe: !!presupuesto, cambios: cambiosPres };
  }

  excel.forEach(x => {
    const suborden = subordenDe.get(x);
    const items = x.items_presupuesto || [];
    if(!(numero(x.costo) > 0 || items.length)) return;
    const actual = presupuestoPiezas.find(p => p.suborden === suborden);
    const cambios = completarPresupuesto(actual, { ...plata(x), items: items.length ? items : null }, `Presupuesto SubOrden ${suborden}`);
    if(cambios) plan.presupuestoPiezas.push({ suborden, pieza: texto(x.pieza), existe: !!actual, cambios });
  });

  plan.hayCambios = !!(Object.keys(plan.cabecera).length || plan.piezas.length || plan.nuevas.length || plan.presupuesto || plan.presupuestoPiezas.length);
  return plan;
}

// Texto para que la persona revise antes de aceptar.
export function resumenPlan(plan, etiquetaOrdenTxt){
  const nombres = o => Object.keys(o).filter(k => k !== 'rentabilidad_esperada_pct').map(k => ETIQUETAS[k] || k).join(', ');
  const lineas = [];
  if(Object.keys(plan.cabecera).length) lineas.push(`• Orden: ${nombres(plan.cabecera)}`);
  plan.piezas.forEach(p => lineas.push(`• SubOrden ${etiquetaOrdenTxt}-${p.suborden}: ${nombres(p.cambios)}`));
  plan.nuevas.forEach(p => lineas.push(`• SubOrden NUEVA ${etiquetaOrdenTxt}-${p.suborden}: ${p.excel.pieza || 'Pieza'} (no existía en el aplicativo)`));
  if(plan.presupuesto) lineas.push(`• Presupuesto de la orden: ${nombres(plan.presupuesto.cambios)}`);
  if(plan.presupuestoPiezas.length) lineas.push(`• Presupuesto por suborden: ${plan.presupuestoPiezas.map(p => p.suborden).join(', ')}`);
  const mostrar = v => v === true ? 'Sí' : v === false ? 'No' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
  const dif = plan.distintos.slice(0, 8).map(d => `• ${d.donde} — ${d.campo}: queda "${mostrar(d.actual)}" (el Excel dice "${mostrar(d.excel)}")`);
  if(plan.distintos.length > 8) dif.push(`• …y ${plan.distintos.length - 8} más`);
  return { rellena: lineas.join('\n'), distintos: plan.distintos.length ? `Datos distintos que NO se cambian (${plan.distintos.length}):\n${dif.join('\n')}` : '' };
}
