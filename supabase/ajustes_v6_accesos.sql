-- ============================================================
-- LitoColor ERP — v6: Accesos y roles
-- Pégalo en Supabase > SQL Editor > New query > Run
-- ============================================================

-- 1) Email y rol en el personal (para poder iniciar sesión y mostrar
--    el menú correcto según quién entra)
alter table personal add column if not exists email text unique;
alter table personal add column if not exists rol text default 'operario';
-- Roles válidos: 'gerente', 'jefe_produccion', 'disenador', 'administradora', 'admin', 'operario'

-- 2) Endurecer permisos: las tablas que se editan SOLO desde el panel
--    completo (que ahora exige iniciar sesión) requieren sesión real
--    para insertar/actualizar/borrar. La LECTURA queda abierta para
--    todos (la necesita también la pantalla de operario, que no pide
--    contraseña a propósito). La tabla "produccion" se deja igual de
--    abierta para insertar/actualizar, porque el reloj checador de los
--    operarios NUNCA pide inicio de sesión.

-- personal
drop policy if exists "insertar personal" on personal;
create policy "insertar personal" on personal for insert with check (auth.uid() is not null);
drop policy if exists "actualizar personal" on personal;
create policy "actualizar personal" on personal for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- maquinas
drop policy if exists "insertar maquinas" on maquinas;
create policy "insertar maquinas" on maquinas for insert with check (auth.uid() is not null);
drop policy if exists "actualizar maquinas" on maquinas;
create policy "actualizar maquinas" on maquinas for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- materias_primas
drop policy if exists "insertar materias_primas" on materias_primas;
create policy "insertar materias_primas" on materias_primas for insert with check (auth.uid() is not null);
drop policy if exists "actualizar materias_primas" on materias_primas;
create policy "actualizar materias_primas" on materias_primas for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- clientes
drop policy if exists "insertar clientes" on clientes;
create policy "insertar clientes" on clientes for insert with check (auth.uid() is not null);
drop policy if exists "actualizar clientes" on clientes;
create policy "actualizar clientes" on clientes for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- proveedores
drop policy if exists "insertar proveedores" on proveedores;
create policy "insertar proveedores" on proveedores for insert with check (auth.uid() is not null);
drop policy if exists "actualizar proveedores" on proveedores;
create policy "actualizar proveedores" on proveedores for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- productos
drop policy if exists "insertar productos" on productos;
create policy "insertar productos" on productos for insert with check (auth.uid() is not null);
drop policy if exists "actualizar productos" on productos;
create policy "actualizar productos" on productos for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- opp_ordenes / opp_piezas (la creación/edición de órdenes es desde el
-- panel con sesión; la pantalla de operario solo LEE estas tablas)
drop policy if exists "insertar opp_ordenes" on opp_ordenes;
create policy "insertar opp_ordenes" on opp_ordenes for insert with check (auth.uid() is not null);
drop policy if exists "actualizar opp_ordenes" on opp_ordenes;
create policy "actualizar opp_ordenes" on opp_ordenes for update using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "insertar opp_piezas" on opp_piezas;
create policy "insertar opp_piezas" on opp_piezas for insert with check (auth.uid() is not null);
drop policy if exists "actualizar opp_piezas" on opp_piezas;
create policy "actualizar opp_piezas" on opp_piezas for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "borrar opp_piezas" on opp_piezas;
create policy "borrar opp_piezas" on opp_piezas for delete using (auth.uid() is not null);

-- NOTA importante: la tabla "produccion" NO se toca aquí — sigue abierta
-- para insertar/actualizar sin sesión, porque así lo pediste para los
-- operarios (entran sin contraseña al reloj checador).
