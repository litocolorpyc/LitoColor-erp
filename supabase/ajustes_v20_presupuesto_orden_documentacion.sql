-- ============================================================
-- LitoColor ERP — v20: documentación de la tabla `presupuesto_orden`
-- (módulo "Presupuesto vs. Real", por orden)
--
-- Esta tabla YA EXISTE y está en uso en producción — el código
-- (js/ordenes.js, js/dashboard.js, js/store.js) lleva tiempo leyendo y
-- escribiendo en ella, pero su creación nunca había quedado registrada
-- en un archivo de este repo. Este script solo deja esa estructura
-- documentada — usa `if not exists`, así que es seguro correrlo aunque
-- la tabla ya exista (no la reemplaza ni le borra datos).
--
-- Pégalo en Supabase > SQL Editor > New query > Run
-- ============================================================

create table if not exists presupuesto_orden (
  orden int primary key references opp_ordenes(orden) on delete cascade,
  costo numeric,                       -- costo cargado por el gerente/jefe de producción
  imprevistos numeric,
  total_costo numeric,                 -- = costo + imprevistos
  precio_venta_antes_iva numeric,      -- "ingreso presupuestado" de la orden
  precio_con_iva numeric,
  rentabilidad_esperada_pct numeric,   -- = (precio_venta_antes_iva - total_costo) / precio_venta_antes_iva * 100
  actualizado_en timestamptz default now()
);

alter table presupuesto_orden enable row level security;

drop policy if exists "lectura publica presupuesto_orden" on presupuesto_orden;
create policy "lectura publica presupuesto_orden" on presupuesto_orden for select using (true);

drop policy if exists "insertar presupuesto_orden" on presupuesto_orden;
create policy "insertar presupuesto_orden" on presupuesto_orden for insert with check (auth.uid() is not null);

drop policy if exists "actualizar presupuesto_orden" on presupuesto_orden;
create policy "actualizar presupuesto_orden" on presupuesto_orden for update using (auth.uid() is not null) with check (auth.uid() is not null);
