-- LitoColor ERP — categorías de materia prima como maestro + qué áreas
-- consumen cada materia prima (pedido del 11ago26).
--
-- Regla de negocio: una materia prima pertenece a UNA sola categoría
-- (por eso sigue siendo la columna de texto materias_primas.categoria,
-- ahora alimentada desde este catálogo en vez de una lista fija en el
-- HTML), pero puede ser consumida por VARIAS áreas (por eso es una tabla
-- de relación N:M aparte, no una columna).

-- 1) Categorías de materia prima — antes era una lista fija (Papel,
--    Carton/Cartulina, Laminado, Argolla, Pegante, Papel quimico (NCR),
--    Otro) escrita directo en el <select> del formulario; ahora es un
--    maestro editable, precargado con esas mismas 7 para no romper lo
--    que ya hay cargado en los 226 papeles existentes.
create table if not exists categorias_materia_prima (
  id serial primary key,
  nombre text not null unique,
  activo boolean default true
);

alter table categorias_materia_prima enable row level security;
drop policy if exists "lectura publica categorias_materia_prima" on categorias_materia_prima;
create policy "lectura publica categorias_materia_prima" on categorias_materia_prima for select using (true);
drop policy if exists "insertar categorias_materia_prima" on categorias_materia_prima;
create policy "insertar categorias_materia_prima" on categorias_materia_prima for insert with check (auth.uid() is not null);
drop policy if exists "actualizar categorias_materia_prima" on categorias_materia_prima;
create policy "actualizar categorias_materia_prima" on categorias_materia_prima for update using (auth.uid() is not null) with check (auth.uid() is not null);

insert into categorias_materia_prima (nombre) values
  ('Papel'), ('Carton/Cartulina'), ('Laminado'), ('Argolla'), ('Pegante'), ('Papel quimico (NCR)'), ('Otro')
on conflict (nombre) do nothing;

-- 2) Qué áreas consumen cada materia prima — relación N:M. Antes solo
--    Guillotina y Corte inicial "veían" el papel de la orden (hardcodeado
--    en js/registrar.js); con esta tabla cualquier materia prima puede
--    quedar disponible como insumo en cualquier área desde Maestros, y
--    Registrar la ofrece como opción de "Insumo consumido" en esa área
--    (igual que ya pasa con insumos_area).
create table if not exists materias_primas_areas (
  id serial primary key,
  materia_prima_codigo text not null references materias_primas(codigo) on delete cascade,
  area text not null,
  unique (materia_prima_codigo, area)
);

alter table materias_primas_areas enable row level security;
drop policy if exists "lectura publica materias_primas_areas" on materias_primas_areas;
create policy "lectura publica materias_primas_areas" on materias_primas_areas for select using (true);
drop policy if exists "insertar materias_primas_areas" on materias_primas_areas;
create policy "insertar materias_primas_areas" on materias_primas_areas for insert with check (auth.uid() is not null);
drop policy if exists "borrar materias_primas_areas" on materias_primas_areas;
create policy "borrar materias_primas_areas" on materias_primas_areas for delete using (auth.uid() is not null);
