-- Estándar de rendimiento por área (unidades por hora) para comparar contra
-- lo real en el informe "Parámetros de piso" (pedido 21oct26). Ej.: Litografía
-- 2.500 pliegos/hora. Sin este estándar el informe igual muestra lo real.
create table if not exists parametros_piso (
  area text primary key,
  unidades_por_hora numeric not null check (unidades_por_hora > 0),
  actualizado_en timestamptz default now()
);
alter table parametros_piso enable row level security;
drop policy if exists "lectura publica parametros_piso" on parametros_piso;
create policy "lectura publica parametros_piso" on parametros_piso for select using (true);
drop policy if exists "insertar parametros_piso" on parametros_piso;
create policy "insertar parametros_piso" on parametros_piso for insert with check (auth.uid() is not null);
drop policy if exists "actualizar parametros_piso" on parametros_piso;
create policy "actualizar parametros_piso" on parametros_piso for update using (auth.uid() is not null) with check (auth.uid() is not null);
