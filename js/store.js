import { sb } from './supabase-client.js';
import { setNote } from './helpers.js';

// Objeto único compartido por todos los módulos. Como es el mismo objeto
// en memoria, cualquier módulo que lo importe ve los mismos datos.
export const DB = {
  personal: [], maquinas: [], actividades: [], pedidos: [], produccion: [],
  materias_primas: [], clientes: [], proveedores: [], opp_ordenes: [], opp_piezas: []
};

export function normProd(r){
  return {
    id: r.id, fecha: r.fecha, operario: r.operario, horaIni: r.hora_ini, horaFin: r.hora_fin,
    actividad: r.actividad, area: r.area, maquina: r.maquina, cantidad: r.cantidad, orden: r.orden,
    suborden: r.suborden, op: r.op,
    cliente: r.cliente, trabajo: r.trabajo, materiaPrima: r.materia_prima,
    consumoMP: r.consumo_mp, comentario: r.comentario, tiempoHr: r.tiempo_hr,
    valorActividad: r.valor_actividad, despachado: r.despachado, inventario: r.inventario,
    reproceso: r.reproceso, opp: r.opp
  };
}

export async function fetchAllProduccion(){
  let all = [];
  let from = 0;
  const pageSize = 1000;
  while(true){
    const { data, error } = await sb.from('produccion').select('*')
      .order('fecha', { ascending: false })
      .range(from, from + pageSize - 1);
    if(error) throw error;
    all = all.concat(data || []);
    if(!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// Carga los catálogos "ligeros". produccion se carga por separado porque
// es grande y necesita paginación (ver fetchAllProduccion).
export async function loadCatalogos(){
  setNote('Cargando datos desde Supabase…');
  const results = await Promise.all([
    sb.from('personal').select('*'),
    sb.from('maquinas').select('*'),
    sb.from('actividades').select('*'),
    sb.from('pedidos').select('*'),
    sb.from('materias_primas').select('*').order('nombre'),
    sb.from('clientes').select('*').order('nombre'),
    sb.from('proveedores').select('*').order('nombre')
  ]);
  const [p1, p2, p3, p4, p5, p6, p7] = results;
  // Solo personal/maquinas/actividades/pedidos son indispensables para arrancar.
  // Las tablas más nuevas (materias_primas, clientes, proveedores) pueden no
  // existir todavía si no se ha corrido el SQL más reciente — no rompen el arranque.
  const erroresCriticos = [p1.error, p2.error, p3.error, p4.error].filter(Boolean);
  if(erroresCriticos.length){
    console.error(erroresCriticos);
    setNote('No se pudo conectar a Supabase. Revisa config.js', true);
    throw erroresCriticos[0];
  }
  DB.personal = p1.data || [];
  DB.maquinas = p2.data || [];
  DB.actividades = p3.data || [];
  DB.pedidos = p4.data || [];
  DB.materias_primas = p5.data || [];
  DB.clientes = p6.data || [];
  DB.proveedores = p7.data || [];
}

export async function loadProduccion(){
  DB.produccion = (await fetchAllProduccion()).map(normProd);
  setNote('Conectado · ' + DB.produccion.length + ' registros');
}

export async function loadOpp(){
  const [o1, o2] = await Promise.all([
    sb.from('opp_ordenes').select('*').order('orden', { ascending: false }),
    sb.from('opp_piezas').select('*')
  ]);
  DB.opp_ordenes = o1.data || [];
  DB.opp_piezas = o2.data || [];
}

export async function loadAll(){
  await loadCatalogos();
  await loadOpp();
  await loadProduccion();
}
