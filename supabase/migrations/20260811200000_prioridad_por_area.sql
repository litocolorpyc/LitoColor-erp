-- LitoColor ERP — prioridad de producción por ÁREA (pedido del 11ago26)
--
-- "Prioridad de producción" (opp_ordenes.prioridad) ya existía pero es
-- por ORDEN completa. El pedido es que también se pueda priorizar por
-- SUBORDEN y ÁREA: una cola de prioridad independiente POR ÁREA, que
-- cruza TODAS las órdenes activas — ej. la cola de "Litografía" prioriza
-- entre sí las piezas pendientes de Litografía de cualquier orden, sin
-- importar cómo esté priorizada Troquelado o Terminado.
--
-- No reemplaza la prioridad por orden (sigue siendo el criterio por
-- defecto/de respaldo cuando una pieza todavía no se priorizó a mano en
-- su área) — la complementa. Ver js/ordenes.js, piezasPendientesDeArea().
create table if not exists prioridad_area (
  id serial primary key,
  area text not null,
  orden_prod int not null,   -- número de la orden de producción (opp_ordenes.orden)
  suborden int not null,     -- suborden de la pieza (opp_piezas.suborden)
  orden int not null,        -- posición 1..N dentro de la cola de esa área (menor = antes)
  unique (area, orden_prod, suborden)
);

alter table prioridad_area enable row level security;
drop policy if exists "lectura publica prioridad_area" on prioridad_area;
create policy "lectura publica prioridad_area" on prioridad_area for select using (true);
drop policy if exists "insertar prioridad_area" on prioridad_area;
create policy "insertar prioridad_area" on prioridad_area for insert with check (auth.uid() is not null);
drop policy if exists "actualizar prioridad_area" on prioridad_area;
create policy "actualizar prioridad_area" on prioridad_area for update using (auth.uid() is not null) with check (auth.uid() is not null);
