-- ============================================================
-- LitoColor ERP — v4: Clientes, Proveedores, estado de órdenes,
-- y permisos de edición/retiro que faltaban.
-- Pégalo en Supabase > SQL Editor > New query > Run
-- ============================================================

-- 1) Maestro de Clientes
create table if not exists clientes (
  id serial primary key,
  nombre text not null,
  nit text,
  telefono text,
  email text,
  direccion text,
  ciudad text,
  activo boolean default true
);
alter table clientes enable row level security;
drop policy if exists "lectura publica clientes" on clientes;
create policy "lectura publica clientes" on clientes for select using (true);
drop policy if exists "insertar clientes" on clientes;
create policy "insertar clientes" on clientes for insert with check (true);
drop policy if exists "actualizar clientes" on clientes;
create policy "actualizar clientes" on clientes for update using (true) with check (true);

-- 2) Maestro de Proveedores
create table if not exists proveedores (
  id serial primary key,
  nombre text not null,
  nit text,
  telefono text,
  email text,
  direccion text,
  ciudad text,
  materiales text, -- qué le compran (ej. "Papel, tintas")
  activo boolean default true
);
alter table proveedores enable row level security;
drop policy if exists "lectura publica proveedores" on proveedores;
create policy "lectura publica proveedores" on proveedores for select using (true);
drop policy if exists "insertar proveedores" on proveedores;
create policy "insertar proveedores" on proveedores for insert with check (true);
drop policy if exists "actualizar proveedores" on proveedores;
create policy "actualizar proveedores" on proveedores for update using (true) with check (true);

-- 3) Estado explícito de cada orden (Activa / Cancelada — el avance
--    Pendiente/En proceso/Completada se calcula solo, no se guarda)
alter table opp_ordenes add column if not exists estado text default 'Activa';

-- 4) Permisos de edición que faltaban en los maestros existentes
drop policy if exists "actualizar personal" on personal;
create policy "actualizar personal" on personal for update using (true) with check (true);

alter table maquinas add column if not exists activo boolean default true;
drop policy if exists "actualizar maquinas" on maquinas;
create policy "actualizar maquinas" on maquinas for update using (true) with check (true);

drop policy if exists "actualizar materias_primas" on materias_primas;
create policy "actualizar materias_primas" on materias_primas for update using (true) with check (true);

-- 5) Permisos para poder editar/retirar/duplicar órdenes
drop policy if exists "actualizar opp_ordenes" on opp_ordenes;
create policy "actualizar opp_ordenes" on opp_ordenes for update using (true) with check (true);

drop policy if exists "actualizar opp_piezas" on opp_piezas;
create policy "actualizar opp_piezas" on opp_piezas for update using (true) with check (true);
drop policy if exists "borrar opp_piezas" on opp_piezas;
create policy "borrar opp_piezas" on opp_piezas for delete using (true);
