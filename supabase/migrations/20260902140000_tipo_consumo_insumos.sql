-- LitoColor ERP — distinguir, dentro de "Materiales por área" (insumos),
-- si el consumo de ese insumo se le debe cargar a la orden (Directo,
-- ej. una plancha CTP que es para un trabajo puntual) o si es un gasto
-- de planta que no se asocia a ninguna orden específica (Indirecto,
-- ej. grasa de mantenimiento, aseo) — pedido del 02sep26.
--
-- "Materia prima" (materias_primas) NO necesita este campo: por
-- definición siempre es el papel/insumo que la orden consume, o sea
-- siempre "Directo" — ver js/inventario.js (salidasDeInventario).
--
-- Con esta clasificación, al finalizar una actividad el consumo de un
-- insumo "Indirecto" sigue descontando el stock igual que siempre, pero
-- el costo generado (costos_movimientos) ya NO queda ligado a la orden
-- que el operario tenía activa en ese momento — ver
-- js/registrar.js (descontarInventarioYCargarCosto).
alter table insumos_area
  add column if not exists tipo_consumo text not null default 'Directo'
  check (tipo_consumo in ('Directo', 'Indirecto'));
