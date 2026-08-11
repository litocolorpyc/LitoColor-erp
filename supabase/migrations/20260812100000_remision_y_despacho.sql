-- LitoColor ERP — "Remisión y Despacho" cierra la orden (pedido del 12ago26)
--
-- Nueva área/actividad final del flujo: cuando un operario finaliza (no
-- pausa) una actividad "Remisión y Despacho" de una orden, esa orden pasa
-- a estado 'Cerrada' automáticamente (ver js/registrar.js, finishActivity).
-- Se le pide el número de remisión en ese momento — por ahora es un campo
-- manual; la generación automática de la remisión completa queda para
-- más adelante (ver memoria del proyecto).
insert into areas (nombre, orden) values ('Remisión y Despacho', 13)
on conflict (nombre) do nothing;

update areas set orden = 14 where nombre = 'General';

-- actividades no tiene una restricción unique (area, etiqueta) como sí
-- tienen los maestros más nuevos, así que se protege con WHERE NOT EXISTS
-- en vez de ON CONFLICT.
insert into actividades (area, etiqueta, actividad)
select 'Remisión y Despacho', 'Remisión y Despacho', 'Remisión y Despacho'
where not exists (
  select 1 from actividades where area = 'Remisión y Despacho' and etiqueta = 'Remisión y Despacho'
);

alter table opp_ordenes add column if not exists numero_remision text;
alter table produccion add column if not exists numero_remision text;
