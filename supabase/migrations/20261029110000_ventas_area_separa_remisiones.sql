-- El modelo de Julián trata las remisiones distinto de las facturas: el margen se calcula
-- sobre el subtotal (sin IVA) y el IVA de la remisión se suma completo como ganancia.
-- Para reproducirlo, la venta por área y mes se guarda en tres partes.
alter table ventas_area_mensual add column if not exists facturas_sub numeric not null default 0;     -- facturas antes de IVA
alter table ventas_area_mensual add column if not exists remisiones_sub numeric not null default 0;   -- remisiones sin IVA
alter table ventas_area_mensual add column if not exists remisiones_iva numeric not null default 0;   -- IVA de las remisiones
