import { DB } from './store.js';
import { normNombreMaterial } from './helpers.js';

// Costo completo de un reproceso (pedido 23sep26): antes el informe solo
// sumaba mano de obra (valor_actividad) + el "costo adicional" escrito a
// mano, y dejaba por fuera la materia prima y los insumos que se gastaron
// al rehacer el trabajo. Ahora cada registro de reproceso suma:
//  - Mano de obra: valor_actividad (horas × valor/hora), como siempre.
//  - Materia prima / Insumos: todo costos_movimientos ligado a ESE registro
//    (produccion_id) — el consumo que el operario anotó al terminar y los
//    consumos extra agregados desde la pestaña Reprocesos.
//  - Otros: el costo adicional del reproceso y los "otros costos" extra.
// Está en su propio archivo (y no en reprocesos.js) para que ordenes.js lo
// pueda usar sin crear una importación circular.

export const CLASES_COSTO = ['Materia prima', 'Insumo', 'Otros'];

// Movimientos de costo agrupados por produccion_id — se arma una vez por
// render en vez de recorrer todos los costos por cada registro.
export function movimientosPorProduccion(){
  const mapa = new Map();
  DB.costos_movimientos.forEach(m => {
    if(m.produccion_id == null) return;
    if(!mapa.has(m.produccion_id)) mapa.set(m.produccion_id, []);
    mapa.get(m.produccion_id).push(m);
  });
  return mapa;
}

// ¿El material del consumo propio del registro es un insumo (Materiales por
// área) o materia prima (papel/cartón)? Mismo criterio de búsqueda que
// buscarMaterialPorNombre en registrar.js: primero insumos del área, luego
// materias primas, con respaldo normalizado (coma/punto decimal).
function claseDelMaterialDelRegistro(r){
  const nombre = r.materiaPrima;
  if(!nombre) return 'Materia prima';
  if(DB.insumos_area.some(m => m.area === r.area && m.nombre === nombre)) return 'Insumo';
  if(DB.materias_primas.some(m => m.nombre === nombre)) return 'Materia prima';
  const norm = normNombreMaterial(nombre);
  if(DB.insumos_area.some(m => m.area === r.area && normNombreMaterial(m.nombre) === norm)) return 'Insumo';
  return 'Materia prima';
}

export function claseDeMovimiento(m, r){
  if(m.clase_reproceso) return m.clase_reproceso;
  if((m.comentario||'').startsWith('Consumo automático')) return claseDelMaterialDelRegistro(r);
  return 'Otros';
}

// { mo, mp, ins, otros, total } de un registro de reproceso.
export function costosDeRegistro(r, movsPorProd){
  const movs = (movsPorProd || movimientosPorProduccion()).get(r.id) || [];
  const c = { mo: Number(r.valorActividad) || 0, mp: 0, ins: 0, otros: 0 };
  let adicionalEnMovs = false;
  movs.forEach(m => {
    const v = Number(m.valor) || 0;
    const clase = claseDeMovimiento(m, r);
    if(clase === 'Insumo') c.ins += v;
    else if(clase === 'Materia prima') c.mp += v;
    else c.otros += v;
    if(m.comentario === 'Reproceso — costo adicional') adicionalEnMovs = true;
  });
  // Un reproceso creado con "costo adicional estimado" todavía no tiene su
  // movimiento de costo (se crea al finalizarlo en Registrar) — igual se
  // cuenta, sin duplicarlo cuando el movimiento ya existe.
  if(!adicionalEnMovs) c.otros += Number(r.costoAdicionalReproceso) || 0;
  c.total = c.mo + c.mp + c.ins + c.otros;
  return c;
}

export function sumarCostos(lista){
  return lista.reduce((s,c) => ({ mo: s.mo+c.mo, mp: s.mp+c.mp, ins: s.ins+c.ins, otros: s.otros+c.otros, total: s.total+c.total }),
    { mo:0, mp:0, ins:0, otros:0, total:0 });
}

// Estadística por OP: todos los registros de reproceso de una misma orden
// son UN solo reproceso (ej. OP 5972: 13 registros, para la empresa es 1).
// Los registros sin orden quedan como reproceso individual cada uno.
export function agruparReprocesosPorOP(registros, movsPorProd){
  const grupos = new Map();
  registros.forEach(r => {
    const key = r.orden != null ? 'o' + r.orden : 'r' + r.id;
    if(!grupos.has(key)) grupos.set(key, { key, orden: r.orden ?? null, registros: [] });
    grupos.get(key).registros.push(r);
  });
  const mpp = movsPorProd || movimientosPorProduccion();
  return [...grupos.values()].map(g => {
    g.registros.sort((a,b) => (a.fecha||'').localeCompare(b.fecha||'') || (a.id - b.id));
    g.fechaIni = g.registros[0].fecha || '';
    g.fechaFin = g.registros[g.registros.length-1].fecha || '';
    g.motivo = masFrecuente(g.registros.map(r => r.motivoReproceso));
    g.areaOrigen = masFrecuente(g.registros.map(r => r.areaOrigenReproceso));
    g.responsable = masFrecuente(g.registros.map(r => r.responsableReproceso));
    g.areasRehechas = [...new Set(g.registros.map(r => r.area).filter(Boolean))];
    g.operarios = [...new Set(g.registros.map(r => r.operario).filter(Boolean))];
    g.costosPorRegistro = new Map(g.registros.map(r => [r.id, costosDeRegistro(r, mpp)]));
    g.costos = sumarCostos([...g.costosPorRegistro.values()]);
    return g;
  });
}

function masFrecuente(valores){
  const cuenta = {};
  valores.filter(Boolean).forEach(v => cuenta[v] = (cuenta[v]||0) + 1);
  const top = Object.entries(cuenta).sort((a,b) => b[1]-a[1])[0];
  return top ? top[0] : null;
}
