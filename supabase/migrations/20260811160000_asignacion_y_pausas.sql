-- LitoColor ERP — asignación de actividades + pausas con motivo
--
-- Contexto (pedido del 11ago26):
-- 1) El operario debe ver que tiene una actividad asignada desde el
--    instante en que un Jefe/Gerente se la asigna (desde "Prioridad de
--    producción"), aunque todavía no haya registrado tiempos — el reloj
--    arranca solo cuando el operario la confirma/empieza.
-- 2) Un operario no puede tener dos actividades corriendo tiempo al mismo
--    tiempo. Puede "pausar" la que tiene para ir a hacer otra.
-- 3) Las pausas deben quedar identificadas con un motivo (desayuno,
--    almuerzo, cambio de actividad, daño de máquina, …) y reflejarse en
--    el historial de tiempos de la orden.
--
-- Un registro de "produccion" sigue siendo un segmento de tiempo de una
-- actividad, pero ahora puede nacer SIN hora_ini (asignado, pendiente de
-- que el operario lo empiece) y puede cerrarse como pausa en vez de como
-- terminado (proceso_completo ya existía para esto — se le suma el motivo).

alter table produccion
  add column if not exists asignado_por text,
  add column if not exists motivo_pausa text;

-- Catálogo "Motivos de pausa" — se administra desde Maestros igual que
-- Actividades (agregar/editar/retirar con "activo").
create table if not exists motivos_pausa (
  id serial primary key,
  nombre text not null unique,
  activo boolean default true
);

alter table motivos_pausa enable row level security;

drop policy if exists "lectura publica motivos_pausa" on motivos_pausa;
create policy "lectura publica motivos_pausa" on motivos_pausa for select using (true);
drop policy if exists "insertar motivos_pausa" on motivos_pausa;
create policy "insertar motivos_pausa" on motivos_pausa for insert with check (auth.uid() is not null);
drop policy if exists "actualizar motivos_pausa" on motivos_pausa;
create policy "actualizar motivos_pausa" on motivos_pausa for update using (auth.uid() is not null) with check (auth.uid() is not null);

insert into motivos_pausa (nombre) values
  ('Desayuno'), ('Almuerzo'), ('Cambio de actividad'), ('Daño de máquina')
on conflict (nombre) do nothing;
