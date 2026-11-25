// Inductores de cada suborden, tal como los describe el Excel de la OP 6018
// (pedido de Julián, nov-2026): con ellos se evalúan las actividades de piso.
//
//  · Tiros de litografía   = (pasadas tiro + pasadas retiro) × tamaños
//      Máquina según el área del tamaño: hasta 1750 cm² = GTO, más = Adast.
//      GTO: 0 tintas = 0 pasadas; 1 a 4 tintas = 1; más de 4 = 2.
//      Adast: cada tinta es una pasada.
//  · Tiros de troqueladora = tamaños, si la pieza va troquelada.
//  · m² laminados          = tamaños × área del tamaño (m²) × lados laminados
//  · m² engomados          = tamaños × área de la carátula (m²) × 2
//      (carátula y guarda), solo si la orden va encaratulada.
//
// "Programado" usa los tamaños programados de la orden. "Real" usa la cantidad
// que reportan los operarios en esa área (tiros: × pasadas; laminados: × área;
// engomados: × área × 2, solo la actividad de poner carátula).
import { DB } from './store.js';

const AREA_GTO_MAX = 1750; // cm²
export const INDUCTORES = [
  { clave: 'tiros', nombre: 'Tiros litografía', unidad: 'tiros', area: /litograf/i, dec: 0 },
  { clave: 'troquel', nombre: 'Tiros troqueladora', unidad: 'tiros', area: /troquel/i, dec: 0 },
  { clave: 'laminado', nombre: 'm² laminados', unidad: 'm²', area: /plastific|lamin/i, dec: 2 },
  { clave: 'engomado', nombre: 'm² engomados', unidad: 'm²', area: /engom/i, dec: 2 }
];
export const inductorDeArea = area => INDUCTORES.find(i => i.area.test(area || '')) || null;

const num = v => Number(v) || 0;
export const piezasDeOrden = orden => DB.opp_piezas.filter(p => p.orden === orden).sort((a, b) => a.suborden - b.suborden);
export const registrosDePieza = (registros, p) => registros.filter(r => r.orden === p.orden && (r.suborden === p.suborden || (p.op && r.op === p.op)));

export function datosPieza(p){
  const area = num(p.medida_tamano_ancho) * num(p.medida_tamano_alto); // cm²
  const maquina = area > 0 ? (area <= AREA_GTO_MAX ? 'GTO' : 'Adast') : null;
  const pasadas = t => maquina === 'GTO' ? (num(t) === 0 ? 0 : num(t) <= 4 ? 1 : 2) : num(t);
  return { areaCm2: area, areaM2: area / 10000, maquina, pasadas: maquina ? pasadas(p.tintas_frente) + pasadas(p.tintas_atras) : 0 };
}

function vaEngomada(p){
  if(!/car[aá]tula/i.test(p.pieza || '')) return false;
  return DB.opp_piezas.some(x => x.orden === p.orden && /encaratul/i.test(x.otros_acabados || ''));
}

// Devuelve, para una suborden, solo los inductores que le aplican:
// [{ clave, nombre, unidad, dec, programado, real (null si no hay registros), reportado, aviso }]
export function inductoresDePieza(p, registros = DB.produccion){
  const d = datosPieza(p);
  const tam = num(p.tamanos_programados);
  const requeridos = Array.isArray(p.procesos_requeridos) ? p.procesos_requeridos : [];
  const recs = registrosDePieza(registros, p);
  const salida = [];

  const agregar = (clave, programado, factor, filtroActividad) => {
    const def = INDUCTORES.find(i => i.clave === clave);
    let delArea = recs.filter(r => def.area.test(r.area || ''));
    if(filtroActividad) delArea = delArea.filter(r => filtroActividad.test(r.actividad || ''));
    const reportado = delArea.reduce((s, r) => s + num(r.cantidad), 0);
    const real = reportado > 0 ? reportado * factor : null;
    let aviso = '';
    if(delArea.length && !reportado) aviso = 'Hay registros, pero sin cantidad reportada';
    else if(programado > 0 && real != null && real > programado * 1.5) aviso = 'Real muy por encima de lo programado: revisar la cantidad reportada (unidad distinta o la misma cantidad reportada por varias personas)';
    salida.push({ ...def, programado, real, reportado, aviso });
  };

  if(tam > 0 && d.pasadas > 0) agregar('tiros', tam * d.pasadas, d.pasadas);
  if(tam > 0 && (p.troquelado || requeridos.includes('Troquelado'))) agregar('troquel', tam, 1);
  if(tam > 0 && d.areaM2 > 0 && num(p.laminado_lados) > 0) agregar('laminado', tam * d.areaM2 * num(p.laminado_lados), d.areaM2);
  if(tam > 0 && d.areaM2 > 0 && vaEngomada(p)) agregar('engomado', tam * d.areaM2 * 2, d.areaM2 * 2, /poner\s+car[aá]tula/i);
  return salida;
}
