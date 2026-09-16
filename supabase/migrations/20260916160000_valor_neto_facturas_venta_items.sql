-- Pedido 16sep26: el valor que se asocia a una orden de producción desde
-- una línea de factura de venta debe ser el valor NETO del ítem (sin el
-- IVA de esa línea) — no el "Vr. Total" crudo de la factura, que ya trae
-- el IVA sumado. Mismo criterio que ya existía del lado de compras
-- (recibos_caja_items.valor_neto_unitario, ver calcularNeto en
-- js/recibos.js), aplicado ahora del lado de venta.
alter table facturas_venta_items
  add column if not exists valor_neto numeric;
