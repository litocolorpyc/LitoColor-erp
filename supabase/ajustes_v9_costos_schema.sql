-- ============================================================
-- LitoColor ERP — v9: Registro de Costos (temporal, mientras el
-- módulo de Cotización entra en operación)
-- Pégalo en Supabase > SQL Editor > New query > Run
-- ============================================================

create table if not exists costos_conceptos (
  id serial primary key,
  nombre text not null unique,
  tipo text not null,        -- 'Fijo' o 'Variable'
  categoria text,            -- Arrendamiento, Nómina, Servicios públicos, Materia prima, Impuestos, Financiero, Mantenimiento, Seguros, Depreciación, Logística, Comercial, Tecnología
  activo boolean default true
);
alter table costos_conceptos enable row level security;
drop policy if exists "lectura publica costos_conceptos" on costos_conceptos;
create policy "lectura publica costos_conceptos" on costos_conceptos for select using (true);
drop policy if exists "insertar costos_conceptos" on costos_conceptos;
create policy "insertar costos_conceptos" on costos_conceptos for insert with check (auth.uid() is not null);
drop policy if exists "actualizar costos_conceptos" on costos_conceptos;
create policy "actualizar costos_conceptos" on costos_conceptos for update using (auth.uid() is not null) with check (auth.uid() is not null);

create table if not exists costos_movimientos (
  id bigserial primary key,
  concepto_id int references costos_conceptos(id),
  tipo text not null,        -- copia de costos_conceptos.tipo, para filtrar rápido
  fecha date not null,
  valor numeric not null,
  proveedor text,
  comentario text,
  created_at timestamptz default now()
);
alter table costos_movimientos enable row level security;
drop policy if exists "lectura publica costos_movimientos" on costos_movimientos;
create policy "lectura publica costos_movimientos" on costos_movimientos for select using (true);
drop policy if exists "insertar costos_movimientos" on costos_movimientos;
create policy "insertar costos_movimientos" on costos_movimientos for insert with check (auth.uid() is not null);
drop policy if exists "actualizar costos_movimientos" on costos_movimientos;
create policy "actualizar costos_movimientos" on costos_movimientos for update using (auth.uid() is not null) with check (auth.uid() is not null);

create index if not exists idx_costos_mov_fecha on costos_movimientos (fecha);
create index if not exists idx_costos_mov_concepto on costos_movimientos (concepto_id);
