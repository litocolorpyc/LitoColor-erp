import { esOrdenServicio } from './helpers.js';

// Áreas Comerciales (Fase 7): las cinco áreas con las que Julián analiza la
// empresa. Cada orden, línea de factura y línea de remisión pertenece a una.
//  · Litografía   — producción propia de litografía.
//  · Servicio     — el cliente trae el material y la empresa pone máquina y mano de obra
//                   (por defecto, las órdenes de servicio S-0001).
//  · Digital      — impresión digital.
//  · Gran formato — banners, pendones, vinilos…
//  · Tercero      — trabajos que el cliente encarga y se mandan a hacer por fuera
//                   ("Servicio de Impresión Externo" y "Trabajo Externo").
// El área sale por defecto del tipo de trabajo de la orden, pero se puede cambiar.

export const AREAS_COMERCIALES = ['Litografía', 'Servicio', 'Digital', 'Gran formato', 'Tercero'];

export function areaPorDefecto(tipoTrabajo, orden){
  if(orden != null && esOrdenServicio(orden)) return 'Servicio';
  switch(tipoTrabajo){
    case 'Impresión Digital': return 'Digital';
    case 'Gran Formato': return 'Gran formato';
    case 'Servicio de Impresión Externo':
    case 'Trabajo Externo': return 'Tercero';
    default: return 'Litografía';
  }
}

export const areaDeOrden = o => (o && o.area_comercial) || (o ? areaPorDefecto(o.tipo_trabajo, o.orden) : 'Litografía');
