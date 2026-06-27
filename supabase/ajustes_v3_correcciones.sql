-- ============================================================
-- LitoColor ERP — correcciones críticas + catálogo de materias primas
-- Pégalo en Supabase > SQL Editor > New query > Run
-- ============================================================

-- CORRECCIÓN CRÍTICA: faltaba el permiso para ACTUALIZAR registros.
-- Por esto "Finalizar actividad" fallaba (solo se podía crear, no completar).
drop policy if exists "actualizar produccion" on produccion;
create policy "actualizar produccion" on produccion for update using (true) with check (true);

-- Catálogo de materias primas (papel, laminados, argollas, pegantes...)
create table if not exists materias_primas (
  codigo text primary key,
  nombre text not null,
  categoria text,
  pliego_ancho numeric,
  pliego_alto numeric,
  activo boolean default true
);
alter table materias_primas enable row level security;

drop policy if exists "lectura publica materias_primas" on materias_primas;
create policy "lectura publica materias_primas" on materias_primas for select using (true);

drop policy if exists "insertar materias_primas" on materias_primas;
create policy "insertar materias_primas" on materias_primas for insert with check (true);

-- Confirmar que personal y maquinas también admiten insert desde la app
drop policy if exists "insertar personal" on personal;
create policy "insertar personal" on personal for insert with check (true);

drop policy if exists "insertar maquinas" on maquinas;
create policy "insertar maquinas" on maquinas for insert with check (true);
