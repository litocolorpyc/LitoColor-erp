-- Módulo de reprocesos y daños completo (procedimiento PR-PROD-DAÑ-01; análisis
-- "Reprocesos_Analisis_y_Complemento", propuestas C a F, 28oct26):
--  1) casos: consecutivo propio (DAN-0001), lista de chequeo del análisis
--     preliminar y tipo de causa (pasos 8.3 y 8.4);
--  2) evidencias (fotos y documentos) con almacenamiento privado (8.1, 8.14);
--  3) cantidad del pedido en la orden (para comparar lo solicitado con lo despachado);
--  4) inventario de producto en proceso / terminado / sobrante / cuarentena (8.2);
--  5) daños de maquinaria, herramientas e infraestructura, con su costo de mantenimiento.
-- Las tablas nuevas NO tienen lectura pública: solo usuarios con sesión.

-- 1) casos ---------------------------------------------------------------
create sequence if not exists reproceso_casos_numero_seq;
alter table reproceso_casos add column if not exists numero text;
alter table reproceso_casos add column if not exists checklist jsonb;
alter table reproceso_casos add column if not exists causa_tipo text
  check (causa_tipo in ('Proceso o falla técnica','Evento externo','Comportamiento humano'));
alter table reproceso_casos add column if not exists creado_en timestamptz default now();

-- crea el caso de cada reproceso que ya existía y los numera en orden cronológico
insert into reproceso_casos (clave)
select g.k from (
  select case when orden is null then 'r' || id else 'o' || orden end k, min(fecha) f
  from produccion where reproceso = 'Si' group by 1
) g order by g.f, g.k
on conflict (clave) do nothing;

with orden_cr as (
  select c.clave, row_number() over (order by coalesce(p.f, now()::date), c.clave) rn
  from reproceso_casos c
  left join (select case when orden is null then 'r' || id else 'o' || orden end k, min(fecha) f
             from produccion where reproceso = 'Si' group by 1) p on p.k = c.clave
  where c.numero is null
)
update reproceso_casos c set numero = 'DAN-' || lpad(o.rn::text, 4, '0') from orden_cr o where o.clave = c.clave;

select setval('reproceso_casos_numero_seq', greatest((select coalesce(max(substring(numero from 5)::int), 0) from reproceso_casos), 1),
              (select count(*) from reproceso_casos where numero is not null) > 0);
alter table reproceso_casos alter column numero set default ('DAN-' || lpad(nextval('reproceso_casos_numero_seq')::text, 4, '0'));
create unique index if not exists reproceso_casos_numero_uq on reproceso_casos (numero);

drop policy if exists "lectura publica reproceso_casos" on reproceso_casos;
drop policy if exists "lectura reproceso_casos" on reproceso_casos;
create policy "lectura reproceso_casos" on reproceso_casos for select using (auth.uid() is not null);

-- 2) evidencias ------------------------------------------------------------
-- `clave` es la del caso ('o5972' / 'r123') o la de un daño de equipo ('d7').
create table if not exists reproceso_evidencias (
  id bigserial primary key,
  clave text not null,
  ruta text not null unique,          -- ruta del archivo dentro del bucket
  nombre text not null,
  tipo text, tamano bigint,
  subido_por text, subido_en timestamptz default now()
);
create index if not exists reproceso_evidencias_clave_ix on reproceso_evidencias (clave);
alter table reproceso_evidencias enable row level security;
drop policy if exists "evidencias todo con sesion" on reproceso_evidencias;
create policy "evidencias todo con sesion" on reproceso_evidencias for all using (auth.uid() is not null) with check (auth.uid() is not null);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencias-danos', 'evidencias-danos', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;
drop policy if exists "evidencias-danos ver" on storage.objects;
create policy "evidencias-danos ver" on storage.objects for select to authenticated using (bucket_id = 'evidencias-danos');
drop policy if exists "evidencias-danos subir" on storage.objects;
create policy "evidencias-danos subir" on storage.objects for insert to authenticated with check (bucket_id = 'evidencias-danos');
drop policy if exists "evidencias-danos borrar" on storage.objects;
create policy "evidencias-danos borrar" on storage.objects for delete to authenticated using (bucket_id = 'evidencias-danos');

-- 3) cantidad del pedido ---------------------------------------------------
alter table opp_ordenes add column if not exists cantidad_pedido numeric;
alter table opp_ordenes add column if not exists unidad_pedido text;

-- 4) inventario de producto ---------------------------------------------------
create table if not exists inventario_producto (
  id bigserial primary key,
  orden int, suborden int,
  descripcion text not null,
  cliente text,
  cantidad numeric not null check (cantidad >= 0),
  unidad text default 'unid.',
  estado text not null default 'Terminado'
    check (estado in ('En proceso','Terminado','Sobrante','Cuarentena','Despachado','Chatarra')),
  disposicion text
    check (disposicion in ('Pendiente','Reproceso','Liberar bajo concesión','Chatarra','Devolver','Vender como segunda')),
  ubicacion text,
  caso_clave text,
  nota text,
  creado_por text, creado_en timestamptz default now(),
  actualizado_por text, actualizado_en timestamptz default now()
);
create index if not exists inventario_producto_orden_ix on inventario_producto (orden);
alter table inventario_producto enable row level security;
drop policy if exists "inventario_producto con sesion" on inventario_producto;
create policy "inventario_producto con sesion" on inventario_producto for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- 5) daños de equipos ------------------------------------------------------------
create sequence if not exists danos_equipos_numero_seq;
create table if not exists danos_equipos (
  id bigserial primary key,
  numero text unique default ('MAN-' || lpad(nextval('danos_equipos_numero_seq')::text, 4, '0')),
  fecha date not null default current_date,
  tipo text not null check (tipo in ('Maquinaria','Herramienta','Infraestructura')),
  maquina text, area text,
  descripcion text not null,
  horas_paro numeric default 0,
  costo numeric default 0,
  proveedor text,
  orden int,
  severidad text check (severidad in ('Menor','Mayor','Crítico')),
  causa_raiz text, accion_correctiva text,
  estado text not null default 'Abierto' check (estado in ('Abierto','En análisis','Cerrado')),
  fecha_cierre date,
  movimiento_id bigint,               -- costo en costos_movimientos (mantenimiento correctivo)
  creado_por text, creado_en timestamptz default now()
);
alter table danos_equipos enable row level security;
drop policy if exists "danos_equipos con sesion" on danos_equipos;
create policy "danos_equipos con sesion" on danos_equipos for all using (auth.uid() is not null) with check (auth.uid() is not null);

insert into costos_conceptos (nombre, tipo, categoria)
values ('Reparación de infraestructura', 'Variable', 'Mantenimiento')
on conflict (nombre) do nothing;
