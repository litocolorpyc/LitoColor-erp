-- LitoColor ERP — permite editar una compra ya guardada (pedido del
-- 12ago26, después de agregar "Compras cargadas" > Eliminar).
--
-- recibos_caja_items no guardaba a qué Concepto de costo ni a qué Tipo
-- (Fijo/Variable) quedaba asignada cada línea — esos dos campos solo
-- vivían en memoria (itemsActuales, js/recibos.js) el rato que tomaba
-- guardar el documento, usados una sola vez para crear los
-- costos_movimientos correspondientes, y después se perdían. Sin
-- guardarlos, "Editar" no podría recargar la tabla tal cual había
-- quedado — cada línea aparecería sin concepto, como si nunca se
-- hubiera clasificado.
alter table recibos_caja_items
  add column if not exists concepto_id bigint references costos_conceptos(id) on delete set null,
  add column if not exists tipo_costo text;
