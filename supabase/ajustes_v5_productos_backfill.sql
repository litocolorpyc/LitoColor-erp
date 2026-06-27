-- ============================================================
-- LitoColor ERP — v5: maestro de Productos + backfill de estado
-- en las órdenes históricas (15 más recientes = Activa, resto = Cerrada)
-- Pégalo en Supabase > SQL Editor > New query > Run
-- ============================================================

-- 1) Maestro de Productos (descripción base)
create table if not exists productos (
  id serial primary key,
  nombre text not null unique,
  descripcion text,
  activo boolean default true
);
alter table productos enable row level security;
drop policy if exists "lectura publica productos" on productos;
create policy "lectura publica productos" on productos for select using (true);
drop policy if exists "insertar productos" on productos;
create policy "insertar productos" on productos for insert with check (true);
drop policy if exists "actualizar productos" on productos;
create policy "actualizar productos" on productos for update using (true) with check (true);

-- 2) Combinaciones válidas por producto (tamaño/papel/gramaje/impresión/acabados)
-- — viene de tu Excel "Tabla_combinaciones_productos_litografia", es información
-- de referencia para cuando se crea una pieza de ese producto.
create table if not exists productos_combinaciones (
  id serial primary key,
  producto text not null,
  tamano text,
  papel text,
  gramaje text,
  impresion text,
  acabados text
);
alter table productos_combinaciones enable row level security;
drop policy if exists "lectura publica productos_combinaciones" on productos_combinaciones;
create policy "lectura publica productos_combinaciones" on productos_combinaciones for select using (true);
drop policy if exists "insertar productos_combinaciones" on productos_combinaciones;
create policy "insertar productos_combinaciones" on productos_combinaciones for insert with check (true);
create index if not exists idx_prodcomb_producto on productos_combinaciones (producto);

-- 3) Backfill: toma TODAS las órdenes históricas de "pedidos" (las que no
--    tengan ya una fila en opp_ordenes) y les asigna estado. Las 15 con
--    fecha más reciente quedan "Activa" (en curso); el resto, "Cerrada".
with por_orden as (
  select orden,
         max(fecha) as fecha,
         (array_agg(cliente order by fecha desc nulls last))[1] as cliente,
         (array_agg(producto order by fecha desc nulls last))[1] as producto
  from pedidos
  where orden is not null
  group by orden
),
rankeado as (
  select *, row_number() over (order by fecha desc nulls last, orden desc) as rnk
  from por_orden
)
insert into opp_ordenes (orden, cliente, producto, fecha, estado)
select orden, cliente, producto, fecha,
       case when rnk <= 15 then 'Activa' else 'Cerrada' end
from rankeado
on conflict (orden) do update set
  estado = excluded.estado,
  cliente = coalesce(opp_ordenes.cliente, excluded.cliente),
  producto = coalesce(opp_ordenes.producto, excluded.producto);
