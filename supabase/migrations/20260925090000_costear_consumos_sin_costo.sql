-- LitoColor ERP — costos automáticos que faltaban (25sep26).
-- Consumos registrados desde registro.html ANTES del arreglo del 24sep26
-- (20260924120000_mover_stock_atomico.sql): el INSERT del costo lo
-- bloqueaba la seguridad de la base, y el re-costeo automático solo corre
-- cuando se le carga costo a un material — como estos YA tenían costo,
-- nunca se volvieron a revisar. Mismo criterio que
-- aplicarCosteoConsumosPendientes (js/registrar.js): cantidad × costo
-- unitario actual del material, ligado a la orden (salvo insumo Indirecto).
-- El 'where not exists' evita duplicar si ya se hubiera costeado.

insert into costos_movimientos (concepto_id,tipo,fecha,valor,proveedor,comentario,orden,suborden,produccion_id) select 22,'Variable','2026-09-21',1200,null,'Consumo automático (recalculado) — Pegante Colbón (0,15)',6015,1,955 where not exists (select 1 from costos_movimientos where produccion_id=955 and comentario like 'Consumo automático%');
insert into costos_movimientos (concepto_id,tipo,fecha,valor,proveedor,comentario,orden,suborden,produccion_id) select 22,'Variable','2026-09-22',22040.61,null,'Consumo automático (recalculado) — Pegante Fuller (1,26)',6019,1,975 where not exists (select 1 from costos_movimientos where produccion_id=975 and comentario like 'Consumo automático%');
insert into costos_movimientos (concepto_id,tipo,fecha,valor,proveedor,comentario,orden,suborden,produccion_id) select 22,'Variable','2026-09-22',4000,null,'Consumo automático (recalculado) — Pegante Colbón (0,5)',5979,3,984 where not exists (select 1 from costos_movimientos where produccion_id=984 and comentario like 'Consumo automático%');
insert into costos_movimientos (concepto_id,tipo,fecha,valor,proveedor,comentario,orden,suborden,produccion_id) select 22,'Variable','2026-09-23',4800,null,'Consumo automático (recalculado) — Pegante Colbón (0,6)',5979,7,995 where not exists (select 1 from costos_movimientos where produccion_id=995 and comentario like 'Consumo automático%');
insert into costos_movimientos (concepto_id,tipo,fecha,valor,proveedor,comentario,orden,suborden,produccion_id) select 22,'Variable','2026-09-23',249696,null,'Consumo automático (recalculado) — Cote 300 gr C1S 70x100 (288)',6024,1,1008 where not exists (select 1 from costos_movimientos where produccion_id=1008 and comentario like 'Consumo automático%');
insert into costos_movimientos (concepto_id,tipo,fecha,valor,proveedor,comentario,orden,suborden,produccion_id) select 22,'Variable','2026-09-24',31671,null,'Consumo automático (recalculado) — Polipropileno Mate 22 mc 30 cm (1,86)',6024,1,1012 where not exists (select 1 from costos_movimientos where produccion_id=1012 and comentario like 'Consumo automático%');
insert into costos_movimientos (concepto_id,tipo,fecha,valor,proveedor,comentario,orden,suborden,produccion_id) select 22,'Variable','2026-09-24',39910.69,null,'Consumo automático (recalculado) — Cote 200 gr C2S 60x90 (88)',6021,1,1016 where not exists (select 1 from costos_movimientos where produccion_id=1016 and comentario like 'Consumo automático%');
insert into costos_movimientos (concepto_id,tipo,fecha,valor,proveedor,comentario,orden,suborden,produccion_id) select 22,'Variable','2026-09-24',39910.69,null,'Consumo automático (recalculado) — Cote 200 gr C2S 60x90 (88)',6021,3,1017 where not exists (select 1 from costos_movimientos where produccion_id=1017 and comentario like 'Consumo automático%');
insert into costos_movimientos (concepto_id,tipo,fecha,valor,proveedor,comentario,orden,suborden,produccion_id) select 22,'Variable','2026-09-24',39910.69,null,'Consumo automático (recalculado) — Cote 200 gr C2S 60x90 (88)',6021,4,1018 where not exists (select 1 from costos_movimientos where produccion_id=1018 and comentario like 'Consumo automático%');
