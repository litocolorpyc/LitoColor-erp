-- LitoColor ERP — punto 13 del doc AjustesERP: control de inventario de
-- materia prima (papel y demás insumos), con descuento automático al
-- consumo del operario y alerta de compra al crear una orden.
--
-- Se agregan campos de stock a los DOS catálogos que ya existían y que
-- representan lo que se consume en producción:
--   - materias_primas: el papel/cartulina/laminado que se elige al crear
--     una orden (campo "papel" de cada pieza).
--   - insumos_area: lo que cada área consume aparte del papel (planchas
--     CTP, colbón, rollos de laminado, etc.), elegido al finalizar una
--     actividad en Registrar.
--
-- stock_actual y stock_minimo arrancan en 0 para todo lo que ya existía
-- (226 papeles precargados, etc.) — 0/0 se trata como "todavía sin
-- configurar seguimiento de stock para este material", no como alerta de
-- inventario agotado. Un material entra a seguimiento real solo cuando se
-- le pone un stock_minimo o un stock_actual mayor a 0 desde Maestros.
alter table materias_primas
  add column if not exists unidad text default 'pliegos',
  add column if not exists stock_actual numeric default 0,
  add column if not exists stock_minimo numeric default 0,
  add column if not exists costo_unitario numeric;

alter table insumos_area
  add column if not exists stock_actual numeric default 0,
  add column if not exists stock_minimo numeric default 0,
  add column if not exists costo_unitario numeric;

-- Concepto de costo fijo al que se cargan los movimientos automáticos que
-- genera el consumo de material (ver js/registrar.js,
-- descontarInventarioYCargarCosto) — así ese consumo entra a Rentabilidad
-- por Orden con la orden/suborden ya asociada (mismo mecanismo del punto 10).
insert into costos_conceptos (nombre, tipo, categoria, activo)
values ('Consumo de materia prima (automático)', 'Variable', 'Materia prima', true)
on conflict (nombre) do nothing;
