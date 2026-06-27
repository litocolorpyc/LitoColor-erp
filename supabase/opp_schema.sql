-- ============================================================
-- LitoColor ERP — módulo de Órdenes de Producción (OPP)
-- Pégalo en Supabase > SQL Editor > New query > Run
-- (Esto se agrega a las tablas que ya existen, no las reemplaza)
-- ============================================================

create table if not exists opp_ordenes (
  orden int primary key,
  cliente text not null,
  producto text,
  fecha date,
  observaciones text,
  created_at timestamptz default now()
);

create table if not exists opp_piezas (
  id bigserial primary key,
  orden int references opp_ordenes(orden) on delete cascade,
  suborden int,
  op text,                          -- "5944-1"
  pieza text,                       -- "Caratula"
  cantidad numeric,                 -- cantidad final solicitada
  tamano_ancho numeric,             -- tamaño plano/terminado (cm)
  tamano_alto numeric,
  papel text,                       -- descripción del papel
  pliego_ancho numeric,             -- 70 o 60
  pliego_alto numeric,              -- 100 o 90
  tintas_frente int,
  tintas_atras int,
  ctp text,                         -- Convencional / Digital
  tira_retira text,                 -- Tira y retira / Solo tiro
  laminado text,                    -- Ninguno / Mate / Brillante
  laminado_lados int,
  barniz_uv boolean default false,
  troquelado boolean default false,
  troquel_detalle text,
  talonarios boolean default false,
  otros_acabados text,
  unidades_por_montaje numeric default 1,
  tamanos_solicitados numeric,      -- = ceil(cantidad / unidades_por_montaje)
  tamanos_programados numeric,      -- sugerido, editable
  medida_tamano_ancho numeric,      -- tamaño con margen para imposición (cm)
  medida_tamano_alto numeric,
  tamanos_por_pliego numeric,       -- sugerido, editable
  pliegos numeric,                  -- = ceil(tamanos_programados / tamanos_por_pliego)
  diagrama_corte text default 'Offset',
  notas text,
  created_at timestamptz default now()
);

create index if not exists idx_opp_piezas_orden on opp_piezas (orden);

alter table opp_ordenes enable row level security;
alter table opp_piezas enable row level security;

create policy "lectura publica opp_ordenes" on opp_ordenes for select using (true);
create policy "insertar opp_ordenes" on opp_ordenes for insert with check (true);
create policy "lectura publica opp_piezas" on opp_piezas for select using (true);
create policy "insertar opp_piezas" on opp_piezas for insert with check (true);
