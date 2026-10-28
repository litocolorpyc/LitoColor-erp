-- Roles nuevos creados por el Gerente/Admin desde Usuarios. Solo guardan el nombre; las opciones del
-- menú de cada rol viven en permisos_rol. Un rol nuevo no da acceso a datos financieros (la base solo
-- lo permite a admin, gerente y administradora).
create table if not exists public.roles_personalizados (
  clave text primary key,
  nombre text not null
);
alter table public.roles_personalizados enable row level security;
drop policy if exists "roles_personalizados lectura" on public.roles_personalizados;
create policy "roles_personalizados lectura" on public.roles_personalizados for select using (auth.uid() is not null);
drop policy if exists "roles_personalizados escritura" on public.roles_personalizados;
create policy "roles_personalizados escritura" on public.roles_personalizados for all
  using (public.rol_actual() in ('admin','gerente')) with check (public.rol_actual() in ('admin','gerente'));
