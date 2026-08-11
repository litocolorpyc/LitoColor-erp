-- LitoColor ERP — subprocesos dentro de un proceso (área)
--
-- Contexto (pedido del 11ago26): un proceso (área, ej. "Terminado") puede
-- tener varios pasos internos que se hacen en orden y cada uno se toma su
-- tiempo (ej. Terminado de un sobre = doblar pestañas, luego engomado,
-- luego cerrar). Hasta ahora el sistema daba por completada TODA el área
-- con que UN SOLO registro de esa área quedara "terminado" — así un sobre
-- podía marcarse "Terminado" con solo doblar las pestañas, sin engomar.
--
-- "subprocesos" es el catálogo (Maestros) que define, por área, cuáles son
-- esos pasos — es OPCIONAL por área: un área sin subprocesos definidos acá
-- se sigue comportando exactamente igual que antes (con que un registro
-- quede terminado, el área cuenta como completa). Recién cuando un área
-- tiene subprocesos cargados, una pieza no cuenta esa área como terminada
-- hasta que CADA UNO de sus subprocesos tenga al menos un registro
-- terminado — ver areasCompletadasPorPieza() en js/ordenes.js.
create table if not exists subprocesos (
  id serial primary key,
  proceso text not null,   -- nombre del área/proceso, ej. "Terminado" (mismo texto que procesos_requeridos de opp_piezas)
  nombre text not null,    -- ej. "Doblar pestañas", "Engomado"
  orden int,                -- para mostrarlos en la secuencia en que se hacen
  activo boolean default true
);

alter table subprocesos enable row level security;

drop policy if exists "lectura publica subprocesos" on subprocesos;
create policy "lectura publica subprocesos" on subprocesos for select using (true);
drop policy if exists "insertar subprocesos" on subprocesos;
create policy "insertar subprocesos" on subprocesos for insert with check (auth.uid() is not null);
drop policy if exists "actualizar subprocesos" on subprocesos;
create policy "actualizar subprocesos" on subprocesos for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- Qué subproceso puntual corresponde a este registro de tiempo — solo
-- aplica cuando el área tiene subprocesos definidos (ver arriba).
alter table produccion add column if not exists subproceso text;
