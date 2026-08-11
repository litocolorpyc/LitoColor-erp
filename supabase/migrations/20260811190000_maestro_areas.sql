-- LitoColor ERP — maestro de Áreas (pedido del 11ago26)
--
-- Hasta ahora "área" no era un catálogo propio: era texto libre repetido
-- en maquinas.area, actividades.area, insumos_area.area, subprocesos.proceso,
-- materias_primas_areas.area y en los checkboxes de "Procesos que requiere
-- esta pieza" al crear una orden (js/registrar.js, listaAreasDisponibles,
-- armaba la lista de áreas juntando maquinas+actividades). Esto se presta a
-- errores de tipeo y no permite definir un orden de trabajo por defecto.
--
-- "areas" pasa a ser la fuente de verdad: nombre + un orden por defecto
-- (para armar procesos_requeridos en secuencia al crear una orden, y para
-- la cola de prioridad por área). Se precarga con las áreas que YA se
-- usan hoy en el checklist de creación de orden y en datos reales
-- (maquinas/actividades/insumos_area), para no perder nada existente —
-- ver js/ordenes.js y js/registrar.js para dónde se sigue usando.
create table if not exists areas (
  id serial primary key,
  nombre text not null unique,
  orden int,
  activo boolean default true
);

alter table areas enable row level security;
drop policy if exists "lectura publica areas" on areas;
create policy "lectura publica areas" on areas for select using (true);
drop policy if exists "insertar areas" on areas;
create policy "insertar areas" on areas for insert with check (auth.uid() is not null);
drop policy if exists "actualizar areas" on areas;
create policy "actualizar areas" on areas for update using (auth.uid() is not null) with check (auth.uid() is not null);

insert into areas (nombre, orden) values
  ('Diseño', 1),
  ('Corte inicial', 2),
  ('Litografia', 3),
  ('Impresión Digital', 4),
  ('Gran Formato', 5),
  ('Servicio de Impresión Externo', 6),
  ('Trabajo Externo', 7),
  ('Guillotina', 8),
  ('Troquelado', 9),
  ('Plastificado', 10),
  ('Engomadora', 11),
  ('Terminado', 12),
  ('General', 13)
on conflict (nombre) do nothing;
