-- LitoColor ERP — permiso para borrar documentos de compra y movimientos de
-- costo (pedido del 12ago26: poder corregir un error sin tener que pedirle
-- a alguien que entre directo a la base de datos).
--
-- No existía ninguna política DELETE para estas 3 tablas — sin esto, el
-- botón "Eliminar" nuevo en Registrar costo (js/recibos.js / js/costos.js)
-- se hubiera quedado sin hacer nada: la fila hubiera "coincidido" con el
-- filtro pero Postgres, con RLS activo y sin política de DELETE, borra
-- cero filas y no avisa ningún error (devuelve 200 OK vacío).
create policy "borrar recibos_caja" on recibos_caja for delete using (auth.uid() is not null);
create policy "borrar recibos_caja_items" on recibos_caja_items for delete using (auth.uid() is not null);
create policy "borrar costos_movimientos" on costos_movimientos for delete using (auth.uid() is not null);
