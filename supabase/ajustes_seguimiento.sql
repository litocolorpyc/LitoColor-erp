-- ============================================================
-- LitoColor ERP — ajustes: catálogo de papel, personal faltante,
-- y columnas para seguimiento de procesos por pieza.
-- Pégalo en Supabase > SQL Editor > New query > Run
-- ============================================================

-- 1) Personal que faltaba (del catálogo "Código de Seguridad")
insert into personal (codigo, nombre, cargo, valor_hora, activo) values
(9, 'Juan Carlos Quintero', 'Administración', null, true),
(10, 'Juan Manuel Quintero', 'Administración', null, true),
(11, 'Liliana Giraldo', 'Administración', null, true),
(12, 'Julian Quintero', 'Administración', null, true);

-- 2) Catálogo de papeles (para que "Papel" sea una lista, no texto libre)
create table if not exists papeles (
  codigo text primary key,
  nombre text not null,
  pliego_ancho numeric,
  pliego_alto numeric
);
alter table papeles enable row level security;
create policy "lectura publica papeles" on papeles for select using (true);

insert into papeles (codigo, nombre, pliego_ancho, pliego_alto) values
('Cote-150-C2-1','Propalcote 150 gr C2S 70x100',70,100),
('Cote-150-C2-2','Propalcote 150 gr C2S 60x90',60,90),
('Cote-240-C2-1','Propalcote 240 gr C2S 70x100',70,100),
('Mate-150-1','Propalmate 150 gr 70x100',70,100),
('Mate-150-2','Propalmate 150 gr 60x90',60,90),
('B-75-1','Bond 75 gr 70x100',70,100),
('B-75-2','Bond 75 gr 60x90',60,90),
('C-I-3','Carton Industrial 1,5 mm 70x100',70,100),
('R-295-1','Reciclado Earth Pact 295 gr 70x100',70,100),
('R-295-2','Reciclado Earth Pact 295 gr 60x90',60,90),
('Ca-Sp-3','Cartulina Spark 295 gr 70x100',70,100),
('Cote-300-C1-1','Propalcote 300 gr C1S 70x100',70,100),
('Cote-300-C1-2','Propalcote 300 gr C1S 60x90',60,90)
on conflict (codigo) do nothing;
-- Nota: este es un punto de partida con los papeles más usados. Se puede
-- ampliar después con el catálogo completo de 210 papeles que encontramos.

-- 3) Seguimiento: qué procesos requiere cada pieza, y a qué pieza
--    pertenece cada registro de producción capturado.
alter table opp_piezas add column if not exists procesos_requeridos jsonb default '[]'::jsonb;
alter table produccion add column if not exists suborden int;
alter table produccion add column if not exists op text;

create index if not exists idx_produccion_op on produccion (op);
