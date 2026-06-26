-- ============================================================
-- LitoColor ERP — esquema de base de datos
-- Pégalo en Supabase > SQL Editor > New query > Run
-- ============================================================

create table if not exists personal (
  id serial primary key,
  codigo int,
  nombre text not null,
  cargo text,
  valor_hora numeric,
  activo boolean default true
);

create table if not exists maquinas (
  id serial primary key,
  codigo text,
  nombre text not null,
  area text
);

create table if not exists actividades (
  id serial primary key,
  codigo int,
  categoria text,        -- Directa / Indirecta / Paro / Legales
  area text,
  actividad text,
  etiqueta text           -- "1503 - Plastificar"
);

create table if not exists pedidos (
  id serial primary key,
  opp text,
  fecha date,
  orden int,
  suborden int,
  cliente text,
  producto text,
  trabajo text,
  pedido numeric,          -- cantidad pedida
  valor numeric,           -- valor unitario
  total numeric            -- ingreso total de esa línea
);

create table if not exists produccion (
  id bigserial primary key,
  fecha date,
  operario text,
  hora_ini text,
  hora_fin text,
  actividad text,          -- "1503 - Plastificar"
  area text,
  cantidad numeric,
  orden int,
  cliente text,
  trabajo text,
  materia_prima text,
  consumo_mp text,
  comentario text,
  tiempo_hr numeric,
  valor_actividad numeric, -- costo de mano de obra de ese registro
  despachado numeric,
  inventario numeric,
  reproceso text,
  opp text,
  created_at timestamptz default now()
);

create index if not exists idx_produccion_fecha on produccion (fecha);
create index if not exists idx_produccion_orden on produccion (orden);
create index if not exists idx_pedidos_orden on pedidos (orden);

-- ------------------------------------------------------------
-- Seguridad: Row Level Security (RLS)
-- El "anon key" del frontend solo podrá:
--   - LEER las 5 tablas
--   - INSERTAR nuevos registros en "produccion" (el formulario de captura)
-- No podrá editar ni borrar nada, ni tocar personal/maquinas/actividades/pedidos.
-- ------------------------------------------------------------
alter table personal enable row level security;
alter table maquinas enable row level security;
alter table actividades enable row level security;
alter table pedidos enable row level security;
alter table produccion enable row level security;

create policy "lectura publica personal" on personal for select using (true);
create policy "lectura publica maquinas" on maquinas for select using (true);
create policy "lectura publica actividades" on actividades for select using (true);
create policy "lectura publica pedidos" on pedidos for select using (true);
create policy "lectura publica produccion" on produccion for select using (true);
create policy "insertar produccion" on produccion for insert with check (true);
