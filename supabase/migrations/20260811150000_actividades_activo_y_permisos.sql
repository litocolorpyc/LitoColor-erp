-- LitoColor ERP — permite administrar el catálogo "Actividades" desde
-- Maestros (agregar, modificar y retirar), igual que ya se puede con
-- Empleados, Máquinas, Materias primas, etc.
--
-- "actividades" es el catálogo que llena el desplegable de "Actividad" en
-- Registrar (pantalla de operario) para cada área — hasta ahora solo se
-- podía cargar directo en Supabase, sin pantalla propia.
--
-- 1) Le agrega la columna "activo" (igual que personal/opp_ordenes) para
--    poder "retirar" una actividad sin borrar su historial: el consumo ya
--    registrado en produccion.actividad queda intacto, solo deja de
--    ofrecerse como opción nueva.
alter table actividades
  add column if not exists activo boolean default true;

update actividades set activo = true where activo is null;

-- 2) Falta la política de escritura: "actividades" solo tenía permiso de
--    lectura (ver supabase/schema.sql). Se agrega insertar/actualizar con
--    el mismo criterio que el resto de los maestros: cualquier usuario
--    logueado (auth.uid() is not null), el control fino de qué rol ve la
--    pestaña en el menú ya lo hace el frontend (js/auth.js).
drop policy if exists "insertar actividades" on actividades;
create policy "insertar actividades" on actividades for insert with check (auth.uid() is not null);
drop policy if exists "actualizar actividades" on actividades;
create policy "actualizar actividades" on actividades for update using (auth.uid() is not null) with check (auth.uid() is not null);
