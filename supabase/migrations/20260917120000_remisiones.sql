-- Remisión (documento de despacho) — pedido explícito 17sep26: reemplaza el
-- campo de texto libre "numero_remision" (ver migración
-- 20260812100000_remision_y_despacho.sql, que sigue existiendo tal cual)
-- por un documento real: cliente elegido de un desplegable, órdenes del
-- cliente, ítems con cantidad/valor editables, numeración automática y
-- listado imprimible.
--
-- El consecutivo vive en `consecutivos_documentos` (genérico por tipo, no
-- solo para "remision") para que el próximo número se pueda ajustar desde
-- un maestro (Maestros > Documentos) sin tocar código.

create table if not exists consecutivos_documentos (
  tipo text primary key,
  descripcion text,
  siguiente_numero int not null default 1,
  activo boolean not null default true
);
insert into consecutivos_documentos (tipo, descripcion, siguiente_numero)
values ('remision', 'Remisión de despacho', 1)
on conflict (tipo) do nothing;

-- Entrega el próximo número y lo reserva de forma atómica (evita que dos
-- personas guardando una remisión al mismo tiempo se lleven el mismo
-- número) — crea la fila del tipo sobre la marcha si todavía no existe.
create or replace function siguiente_consecutivo(p_tipo text, p_descripcion text default null)
returns int
language plpgsql
as $$
declare
  v_numero int;
begin
  update consecutivos_documentos
    set siguiente_numero = siguiente_numero + 1
    where tipo = p_tipo
    returning siguiente_numero - 1 into v_numero;

  if v_numero is null then
    insert into consecutivos_documentos (tipo, descripcion, siguiente_numero)
    values (p_tipo, coalesce(p_descripcion, p_tipo), 2)
    returning siguiente_numero - 1 into v_numero;
  end if;

  return v_numero;
end;
$$;
grant execute on function siguiente_consecutivo(text, text) to authenticated;

create table if not exists remisiones (
  id bigint generated always as identity primary key,
  numero int not null unique,
  fecha date not null default current_date,
  cliente text not null,
  nit text,
  telefono text,
  direccion text,
  observaciones text,
  total numeric not null default 0,
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz
);

-- Órdenes de producción cubiertas por la remisión (una remisión puede
-- despachar varias órdenes de un mismo cliente a la vez) — `orden` sin FK a
-- opp_ordenes, mismo criterio que facturas_venta_items.orden.
create table if not exists remision_ordenes (
  id bigint generated always as identity primary key,
  remision_id bigint not null references remisiones(id) on delete cascade,
  orden int not null
);

create table if not exists remision_items (
  id bigint generated always as identity primary key,
  remision_id bigint not null references remisiones(id) on delete cascade,
  orden int, -- de qué orden salió este ítem (null = agregado a mano)
  descripcion text not null,
  cantidad numeric,
  unidad text,
  valor_unitario numeric not null default 0,
  valor_total numeric not null default 0
);

create index if not exists idx_remision_ordenes_remision on remision_ordenes (remision_id);
create index if not exists idx_remision_ordenes_orden on remision_ordenes (orden);
create index if not exists idx_remision_items_remision on remision_items (remision_id);
create index if not exists idx_remisiones_fecha on remisiones (fecha);
create index if not exists idx_remisiones_cliente on remisiones (cliente);

alter table consecutivos_documentos enable row level security;
alter table remisiones enable row level security;
alter table remision_ordenes enable row level security;
alter table remision_items enable row level security;

drop policy if exists "lectura publica consecutivos_documentos" on consecutivos_documentos;
create policy "lectura publica consecutivos_documentos" on consecutivos_documentos for select using (true);
drop policy if exists "insertar consecutivos_documentos" on consecutivos_documentos;
create policy "insertar consecutivos_documentos" on consecutivos_documentos for insert with check (auth.uid() is not null);
drop policy if exists "actualizar consecutivos_documentos" on consecutivos_documentos;
create policy "actualizar consecutivos_documentos" on consecutivos_documentos for update using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "lectura publica remisiones" on remisiones;
create policy "lectura publica remisiones" on remisiones for select using (true);
drop policy if exists "insertar remisiones" on remisiones;
create policy "insertar remisiones" on remisiones for insert with check (auth.uid() is not null);
drop policy if exists "actualizar remisiones" on remisiones;
create policy "actualizar remisiones" on remisiones for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "borrar remisiones" on remisiones;
create policy "borrar remisiones" on remisiones for delete using (auth.uid() is not null);

drop policy if exists "lectura publica remision_ordenes" on remision_ordenes;
create policy "lectura publica remision_ordenes" on remision_ordenes for select using (true);
drop policy if exists "insertar remision_ordenes" on remision_ordenes;
create policy "insertar remision_ordenes" on remision_ordenes for insert with check (auth.uid() is not null);
drop policy if exists "actualizar remision_ordenes" on remision_ordenes;
create policy "actualizar remision_ordenes" on remision_ordenes for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "borrar remision_ordenes" on remision_ordenes;
create policy "borrar remision_ordenes" on remision_ordenes for delete using (auth.uid() is not null);

drop policy if exists "lectura publica remision_items" on remision_items;
create policy "lectura publica remision_items" on remision_items for select using (true);
drop policy if exists "insertar remision_items" on remision_items;
create policy "insertar remision_items" on remision_items for insert with check (auth.uid() is not null);
drop policy if exists "actualizar remision_items" on remision_items;
create policy "actualizar remision_items" on remision_items for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "borrar remision_items" on remision_items;
create policy "borrar remision_items" on remision_items for delete using (auth.uid() is not null);
