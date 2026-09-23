-- Reprocesos por OP y con costo completo (pedido 23sep26):
-- 1) Para estadísticas, un reproceso se cuenta UNA vez por OP (ej. la OP
--    5972 tenía 13 registros de reproceso pero para la empresa es uno solo),
--    y se registra el ÁREA QUE LO GENERÓ (distinta del área donde se rehízo).
-- 2) Para costos se suman TODOS los procesos involucrados: mano de obra,
--    materia prima, insumos y otros costos — se pueden agregar consumos y
--    otros costos extra a cada proceso del reproceso. Para poder quitarlos
--    después devolviendo exactamente lo descontado del inventario, el
--    movimiento de costo guarda qué material y cuánta cantidad fue.

alter table produccion add column if not exists area_origen_reproceso text;

alter table costos_movimientos add column if not exists clase_reproceso text;   -- 'Materia prima' | 'Insumo' | 'Otros'
alter table costos_movimientos add column if not exists material_tabla text;    -- 'materias_primas' | 'insumos_area'
alter table costos_movimientos add column if not exists material_ref text;      -- codigo (materias_primas) o id (insumos_area)
alter table costos_movimientos add column if not exists cantidad numeric;
