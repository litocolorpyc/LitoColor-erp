-- Matriz de permisos por rol: qué opciones del menú ve cada rol. La editan el Gerente y el Admin
-- desde Usuarios. Admin y Gerente siempre ven todo (no se guardan aquí). Si un rol no tiene filas,
-- el aplicativo usa los permisos por defecto del código.
create table if not exists public.permisos_rol (
  rol text not null,
  tab text not null,
  primary key (rol, tab)
);
alter table public.permisos_rol enable row level security;
drop policy if exists "permisos_rol lectura" on public.permisos_rol;
create policy "permisos_rol lectura" on public.permisos_rol for select using (auth.uid() is not null);
drop policy if exists "permisos_rol escritura" on public.permisos_rol;
create policy "permisos_rol escritura" on public.permisos_rol for all
  using (public.rol_actual() in ('admin','gerente')) with check (public.rol_actual() in ('admin','gerente'));
insert into public.permisos_rol (rol, tab) values
('jefe_produccion','produccion'),
('jefe_produccion','operario'),
('jefe_produccion','ordenes'),
('jefe_produccion','calendario'),
('jefe_produccion','alertas'),
('jefe_produccion','registrar'),
('jefe_produccion','reprocesos'),
('jefe_produccion','inventario'),
('jefe_produccion','producto-terminado'),
('jefe_produccion','danos-equipos'),
('jefe_produccion','informes-op'),
('jefe_produccion','pantalla-planta'),
('jefe_produccion','remisiones'),
('jefe_produccion','m-empleados'),
('jefe_produccion','m-areas'),
('jefe_produccion','m-maquinas'),
('jefe_produccion','m-actividades'),
('jefe_produccion','m-motivos-pausa'),
('jefe_produccion','m-motivos-reproceso'),
('jefe_produccion','m-subprocesos'),
('jefe_produccion','m-cat-materia'),
('jefe_produccion','m-materias'),
('jefe_produccion','m-insumos'),
('jefe_produccion','m-piezas-producto'),
('jefe_produccion','m-clientes'),
('jefe_produccion','m-proveedores'),
('jefe_produccion','m-productos'),
('jefe_produccion','m-documentos'),
('jefe_produccion','ayuda'),
('disenador','ordenes'),
('disenador','registrar'),
('disenador','m-productos'),
('disenador','m-cat-materia'),
('disenador','m-materias'),
('disenador','m-insumos'),
('disenador','m-piezas-producto'),
('disenador','ayuda'),
('administradora','administrativo'),
('administradora','gerencial'),
('administradora','ordenes'),
('administradora','alertas'),
('administradora','registrar'),
('administradora','reprocesos'),
('administradora','inventario'),
('administradora','producto-terminado'),
('administradora','danos-equipos'),
('administradora','remisiones'),
('administradora','m-empleados'),
('administradora','m-clientes'),
('administradora','m-proveedores'),
('administradora','m-materias'),
('administradora','m-costos'),
('administradora','registrar-costo'),
('administradora','registrar-venta'),
('administradora','m-documentos'),
('administradora','ayuda')
on conflict do nothing;
