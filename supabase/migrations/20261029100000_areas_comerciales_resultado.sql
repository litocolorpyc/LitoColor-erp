-- Fase 7: Áreas Comerciales y resultado (reunión 27oct26; modelo del Excel de Julián):
--  1) cada orden, línea de factura y línea de remisión pertenece a un ÁREA COMERCIAL
--     (Litografía, Servicio, Digital, Gran formato o Tercero);
--  2) plan de costos fijos por año (con opción de que cuente o no como costo de la
--     empresa, % a cargo de la empresa y área comercial asociada);
--  3) porcentaje de margen de contribución supuesto por área y año, y parámetros
--     (meta de margen, imprevistos).
-- Las tres tablas nuevas son SOLO del gerente: incluyen información financiera sensible.

alter table opp_ordenes add column if not exists area_comercial text
  check (area_comercial in ('Litografía','Servicio','Digital','Gran formato','Tercero'));
alter table facturas_venta_items add column if not exists area_comercial text
  check (area_comercial in ('Litografía','Servicio','Digital','Gran formato','Tercero'));
alter table remision_items add column if not exists area_comercial text
  check (area_comercial in ('Litografía','Servicio','Digital','Gran formato','Tercero'));

-- Área por defecto de las órdenes existentes según su tipo de trabajo. "Servicio de Impresión
-- Externo" y "Trabajo Externo" son trabajos que el cliente encarga y se mandan a hacer por
-- fuera: Tercero. Las órdenes de servicio (S-0001, numeradas desde 1.000.000): Servicio.
update opp_ordenes set area_comercial = case
    when orden >= 1000000 then 'Servicio'
    when tipo_trabajo = 'Impresión Digital' then 'Digital'
    when tipo_trabajo = 'Gran Formato' then 'Gran formato'
    when tipo_trabajo in ('Servicio de Impresión Externo','Trabajo Externo') then 'Tercero'
    else 'Litografía' end
where area_comercial is null;
update facturas_venta_items i set area_comercial = o.area_comercial from opp_ordenes o where o.orden = i.orden and i.area_comercial is null;
update remision_items i set area_comercial = o.area_comercial from opp_ordenes o where o.orden = i.orden and i.area_comercial is null;

create table if not exists costos_fijos_plan (
  id bigserial primary key,
  anio int not null,
  grupo text not null,
  concepto text not null,
  valor_mensual numeric not null default 0,
  cuenta_empresa boolean not null default true,                     -- ¿cuenta como costo de la empresa?
  pct_empresa numeric not null default 100 check (pct_empresa between 0 and 100),   -- % que le toca a la empresa
  area_comercial text check (area_comercial in ('Litografía','Servicio','Digital','Gran formato','Tercero')),
  nota text,
  orden int not null default 0,
  actualizado_por text,
  actualizado_en timestamptz default now()
);
create index if not exists costos_fijos_plan_anio_ix on costos_fijos_plan (anio);

create table if not exists margen_area_param (
  anio int not null,
  area text not null check (area in ('Litografía','Servicio','Digital','Gran formato','Tercero')),
  margen_pct numeric not null check (margen_pct between 0 and 100),
  primary key (anio, area)
);

create table if not exists config_resultado (
  clave text primary key,
  valor numeric not null,
  descripcion text
);

do $$
declare t text;
begin
  foreach t in array array['costos_fijos_plan','margen_area_param','config_resultado'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "solo gerente %1$s" on %1$I', t);
    execute format('create policy "solo gerente %1$s" on %1$I for all using (public.rol_actual() = ''gerente'') with check (public.rol_actual() = ''gerente'')', t);
  end loop;
end $$;
