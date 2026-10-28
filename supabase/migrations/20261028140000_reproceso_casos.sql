-- Seguimiento y cierre del caso de un reproceso (procedimiento PR-PROD-DAÑ-01,
-- pasos 8.5, 8.6 y 8.13): estado, severidad, clasificación del daño, causa
-- raíz, acción correctiva y cierre. Un caso = un reproceso por OP, igual que
-- en js/reproceso-costos.js: `clave` es 'o' + N° de orden, o 'r' + id del
-- registro cuando el reproceso no tiene OP.
create table if not exists reproceso_casos (
  clave text primary key,
  estado text not null default 'Abierto' check (estado in ('Abierto','En análisis','Cerrado')),
  severidad text check (severidad in ('Menor','Mayor','Crítico')),
  clasificacion text,
  causa_raiz text,
  accion_correctiva text,
  responsable_accion text,
  fecha_compromiso date,
  lecciones text,
  fecha_cierre date,
  actualizado_por text,
  actualizado_en timestamptz default now()
);
alter table reproceso_casos enable row level security;
drop policy if exists "lectura publica reproceso_casos" on reproceso_casos;
create policy "lectura publica reproceso_casos" on reproceso_casos for select using (true);
drop policy if exists "insertar reproceso_casos" on reproceso_casos;
create policy "insertar reproceso_casos" on reproceso_casos for insert with check (auth.uid() is not null);
drop policy if exists "actualizar reproceso_casos" on reproceso_casos;
create policy "actualizar reproceso_casos" on reproceso_casos for update using (auth.uid() is not null) with check (auth.uid() is not null);
