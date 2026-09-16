-- "Registrar Venta" (pedido 16sep26): cargar la Factura electrónica de venta
-- (PDF de Siigo) y asociar cada línea a la orden de producción GENÉRICA (el
-- N° de orden sin -1,-2…) que le corresponde. Es el espejo, del lado de
-- venta, de recibos_caja/recibos_caja_items (que hace lo mismo del lado de
-- compra) — misma idea: se revisa/corrige en una tabla antes de guardar,
-- nunca se guarda nada sin que alguien confirme.
--
-- A diferencia de recibos_caja_items, acá no hay `suborden` — el pedido fue
-- explícito: la orden asociada es siempre "la orden total, la genérica",
-- nunca una pieza -1/-2. Tampoco hay `material_tabla`/`material_key` (esto
-- no toca inventario, es información de venta) ni `concepto_id` (no es un
-- costo). `orden` es un entero simple sin FK, mismo criterio que
-- recibos_caja_items.orden y prioridad_area.orden_prod — el número de orden
-- no está forzado por una restricción de base, así se puede escribir aunque
-- la orden todavía no exista en el sistema.

create table if not exists facturas_venta (
  id bigint generated always as identity primary key,
  numero_factura text,
  fecha date,
  nit text,
  cliente text,
  total_bruto numeric,
  iva numeric,
  valor_total numeric,
  cargado_por text,
  archivo_nombre text,
  cargado_en timestamptz not null default now()
);

create table if not exists facturas_venta_items (
  id bigint generated always as identity primary key,
  factura_id bigint not null references facturas_venta(id) on delete cascade,
  codigo text,
  descripcion text,
  cantidad numeric,
  unidad_medida text,
  iva_pct numeric,
  valor_unitario numeric,
  valor_total numeric,
  orden int,           -- N° de orden de producción genérica asociada (sin -1,-2), sin FK — ver nota arriba
  observacion text
);

create index if not exists idx_facturas_venta_items_factura on facturas_venta_items (factura_id);
create index if not exists idx_facturas_venta_fecha on facturas_venta (fecha);
create index if not exists idx_facturas_venta_numero on facturas_venta (numero_factura);

alter table facturas_venta enable row level security;
alter table facturas_venta_items enable row level security;

drop policy if exists "lectura publica facturas_venta" on facturas_venta;
create policy "lectura publica facturas_venta" on facturas_venta for select using (true);
drop policy if exists "insertar facturas_venta" on facturas_venta;
create policy "insertar facturas_venta" on facturas_venta for insert with check (auth.uid() is not null);
drop policy if exists "actualizar facturas_venta" on facturas_venta;
create policy "actualizar facturas_venta" on facturas_venta for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "borrar facturas_venta" on facturas_venta;
create policy "borrar facturas_venta" on facturas_venta for delete using (auth.uid() is not null);

drop policy if exists "lectura publica facturas_venta_items" on facturas_venta_items;
create policy "lectura publica facturas_venta_items" on facturas_venta_items for select using (true);
drop policy if exists "insertar facturas_venta_items" on facturas_venta_items;
create policy "insertar facturas_venta_items" on facturas_venta_items for insert with check (auth.uid() is not null);
drop policy if exists "actualizar facturas_venta_items" on facturas_venta_items;
create policy "actualizar facturas_venta_items" on facturas_venta_items for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "borrar facturas_venta_items" on facturas_venta_items;
create policy "borrar facturas_venta_items" on facturas_venta_items for delete using (auth.uid() is not null);
