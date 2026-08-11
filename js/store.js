import { sb } from './supabase-client.js';
import { setNote } from './helpers.js';

// Objeto único compartido por todos los módulos. Como es el mismo objeto
// en memoria, cualquier módulo que lo importe ve los mismos datos.
export const DB = {
  personal: [], maquinas: [], actividades: [], pedidos: [], produccion: [],
  materias_primas: [], clientes: [], proveedores: [], opp_ordenes: [], opp_piezas: [],
  productos: [], costos_conceptos: [], costos_movimientos: [], insumos_area: [],
  piezas_producto: [], presupuesto_orden: [], recibos_caja: [], motivos_pausa: [], subprocesos: [],
  categorias_materia_prima: [], materias_primas_areas: [], areas: []
};

export function normProd(r){
  return {
    id: r.id, fecha: r.fecha, operario: r.operario, horaIni: r.hora_ini, horaFin: r.hora_fin,
    actividad: r.actividad, area: r.area, maquina: r.maquina, cantidad: r.cantidad, orden: r.orden,
    suborden: r.suborden, op: r.op,
    cliente: r.cliente, trabajo: r.trabajo, materiaPrima: r.materia_prima,
    consumoMP: r.consumo_mp, comentario: r.comentario, tiempoHr: r.tiempo_hr,
    valorActividad: r.valor_actividad, despachado: r.despachado, inventario: r.inventario,
    reproceso: r.reproceso, opp: r.opp,
    // true/null = el operario dio por terminado el proceso en esta sesión;
    // false = "voy a continuar después" (ej. troquelado que sigue mañana) o
    // fue una pausa (ver motivoPausa). Ver areasCompletadasPorPieza() en
    // ordenes.js — solo los terminados de verdad cuentan como área
    // completada para el avance de la orden.
    procesoCompleto: r.proceso_completo,
    // Quién asignó esta actividad al operario (si nació desde "Prioridad de
    // producción" en vez de que el operario la iniciara él mismo) — null en
    // el caso normal. Mientras horaIni sea null, es una asignación pendiente
    // de que el operario la empiece (ver js/registrar.js).
    asignadoPor: r.asignado_por,
    // Motivo de la pausa (Desayuno, Almuerzo, Cambio de actividad, Daño de
    // máquina, etc. — catálogo "Motivos de pausa" en Maestros), solo cuando
    // el registro se cerró como pausa en vez de como terminado.
    motivoPausa: r.motivo_pausa,
    // Subproceso puntual dentro del área (catálogo "Subprocesos" en
    // Maestros, ej. área "Terminado" → "Doblar pestañas"/"Engomado") —
    // solo aplica si el área tiene subprocesos definidos. Ver
    // areasCompletadasPorPieza() en ordenes.js.
    subproceso: r.subproceso
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
    sb.from('proveedores').select('*').order('nombre'),
    sb.from('productos').select('*').order('nombre'),
    sb.from('costos_conceptos').select('*').order('tipo'),
    sb.from('costos_movimientos').select('*').order('fecha', { ascending: false }),
    sb.from('insumos_area').select('*').order('area'),
    sb.from('piezas_producto').select('*').order('producto'),
    sb.from('presupuesto_orden').select('*'),
    sb.from('recibos_caja').select('*').order('cargado_en', { ascending: false }).limit(100),
    sb.from('motivos_pausa').select('*').order('nombre'),
    sb.from('subprocesos').select('*').order('proceso').order('orden'),
    sb.from('categorias_materia_prima').select('*').order('nombre'),
    sb.from('materias_primas_areas').select('*'),
    sb.from('areas').select('*').order('orden')
  ]);
  const [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19] = results;
  // Solo personal/maquinas/actividades/pedidos son indispensables para arrancar.
  // Las tablas más nuevas (materias_primas, clientes, proveedores, insumos_area)
  // pueden no existir todavía si no se ha corrido el SQL más reciente — no
  // rompen el arranque.
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
  DB.productos = p8.data || [];
  DB.costos_conceptos = p9.data || [];
  DB.costos_movimientos = p10.data || [];
  DB.insumos_area = p11.data || [];
  DB.piezas_producto = p12.data || [];
  DB.presupuesto_orden = p13.data || [];
  DB.recibos_caja = p14.data || [];
  DB.motivos_pausa = p15.data || [];
  DB.subprocesos = p16.data || [];
  DB.categorias_materia_prima = p17.data || [];
  DB.materias_primas_areas = p18.data || [];
  DB.areas = p19.data || [];
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
