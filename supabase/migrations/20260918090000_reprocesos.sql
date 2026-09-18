-- Módulo "Reprocesos" (pedido 17-18sep26): reabrir un proceso ya
-- completado de una suborden, con motivo, responsable y costo adicional
-- — convierte el campo suelto "reproceso" Si/No que ya existía en
-- produccion (sin contexto) en algo trazable. El reproceso se registra
-- como una actividad de producción real (misma tabla produccion), así que
-- genera tiempo y costo de mano de obra solo, igual que cualquier otra
-- actividad — no hace falta ninguna tabla ni cálculo nuevo para eso.

create table if not exists motivos_reproceso (
  id serial primary key,
  nombre text not null unique,
  activo boolean default true
);
alter table motivos_reproceso enable row level security;
drop policy if exists "lectura publica motivos_reproceso" on motivos_reproceso;
create policy "lectura publica motivos_reproceso" on motivos_reproceso for select using (true);
drop policy if exists "insertar motivos_reproceso" on motivos_reproceso;
create policy "insertar motivos_reproceso" on motivos_reproceso for insert with check (auth.uid() is not null);
drop policy if exists "actualizar motivos_reproceso" on motivos_reproceso;
create policy "actualizar motivos_reproceso" on motivos_reproceso for update using (auth.uid() is not null) with check (auth.uid() is not null);

insert into motivos_reproceso (nombre) values
  ('Error de impresión'), ('Daño de máquina'), ('Material defectuoso'),
  ('Cambio pedido por el cliente'), ('Error de diseño/montaje'), ('Otro')
on conflict (nombre) do nothing;

alter table produccion add column if not exists motivo_reproceso text;
alter table produccion add column if not exists responsable_reproceso text;
alter table produccion add column if not exists costo_adicional_reproceso numeric;

-- Concepto para que, si el reproceso tiene un costo adicional (desperdicio,
-- cargo extra), se refleje como cualquier otro costo real de la orden —
-- mismo mecanismo que "Consumo de materia prima (automático)".
insert into costos_conceptos (nombre, tipo, categoria) values
  ('Reproceso (costo adicional)', 'Variable', 'Reproceso')
on conflict (nombre) do nothing;
