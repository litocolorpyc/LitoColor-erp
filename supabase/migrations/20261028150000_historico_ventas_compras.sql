-- Fase 5 (dashboard gerencial): histórico de ventas y compras de materiales,
-- cargado del Excel "Datos Importantes Litocolor 2026" de Julián (agregado por
-- mes/año; no contiene nómina ni datos personales). Son datos financieros: a
-- diferencia de otras tablas, NO tienen lectura pública — solo las leen los
-- roles admin, gerente y administradora con sesión iniciada. Los datos se
-- cargan con una carga puntual (no hay políticas de escritura).
create or replace function public.rol_actual() returns text
language sql stable security definer set search_path = public as $$
  select rol from personal
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and coalesce(activo, true)
  limit 1
$$;
grant execute on function public.rol_actual() to authenticated;

create table if not exists ventas_mensual (
  anio int not null, mes int not null check (mes between 1 and 12),
  facturas numeric not null default 0,      -- facturas antes de IVA
  remisiones numeric not null default 0,    -- remisiones por su valor total (así las lleva el Excel)
  total numeric not null default 0,
  primary key (anio, mes)
);
create table if not exists ventas_area_mensual (
  anio int not null, mes int not null check (mes between 1 and 12),
  area text not null, valor numeric not null default 0,
  primary key (anio, mes, area)
);
create table if not exists ventas_cliente_anual (
  anio int not null, cliente text not null, valor numeric not null default 0,
  primary key (anio, cliente)
);
create table if not exists compras_mensual (
  anio int not null, mes int not null check (mes between 1 and 12),
  tipo text not null,                        -- Papel | Planchas | Troqueles | Polietileno
  subtotal numeric not null default 0,       -- antes de IVA
  unidades numeric,                          -- papel: hojas; planchas: unidades; troqueles: n.º de troqueles; polietileno: kg
  registros int not null default 0,
  primary key (anio, mes, tipo)
);

do $$
declare t text;
begin
  foreach t in array array['ventas_mensual','ventas_area_mensual','ventas_cliente_anual','compras_mensual'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "lectura financiera %1$s" on %1$I', t);
    execute format('create policy "lectura financiera %1$s" on %1$I for select using (public.rol_actual() in (''admin'',''gerente'',''administradora''))', t);
  end loop;
end $$;
