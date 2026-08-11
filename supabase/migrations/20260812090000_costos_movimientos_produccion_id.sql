-- LitoColor ERP — trazabilidad entre un registro de producción y el costo
-- automático que generó su consumo de materia prima/insumo (pedido del
-- 12ago26: "debe existir una correlación entre inventarios, insumos por
-- área y materia prima").
--
-- Hasta ahora, cuando un operario finalizaba una actividad con consumo de
-- material, descontarInventarioYCargarCosto (js/registrar.js) descontaba
-- el stock Y creaba un costos_movimientos con concepto "Consumo de
-- materia prima (automático)" — pero SIN quedar ligado al registro de
-- producción que lo originó. Si después alguien necesitaba corregir ese
-- consumo (Jefe de Producción/Gerencia ajustando un registro), no había
-- forma confiable de encontrar ni revertir el costo/stock exacto que ese
-- registro había generado.
alter table costos_movimientos
  add column if not exists produccion_id bigint references produccion(id) on delete set null;

create index if not exists idx_costos_movimientos_produccion_id on costos_movimientos (produccion_id);

-- Los movimientos automáticos que ya existen (antes de esta migración)
-- quedan con produccion_id en null — no hay forma confiable de
-- reconstruir ese vínculo en retrospectiva sin arriesgar cruzar mal un
-- registro con otro. Los que se generen de ahora en adelante sí quedan
-- ligados.
