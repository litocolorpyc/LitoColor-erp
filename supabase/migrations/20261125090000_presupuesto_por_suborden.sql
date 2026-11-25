-- Presupuesto de cada suborden, tal como viene en el Excel de la orden
-- (CTP, papel, impresión, laminado, acabados, imprevistos, venta). Antes la
-- importación solo guardaba la suma de toda la orden (presupuesto_orden).
-- Tabla aparte (no columnas en opp_piezas) para que: 1) no se pierda al
-- editar la orden (las piezas se borran y se vuelven a insertar) y 2) no
-- quede legible sin iniciar sesión, como sí lo está opp_piezas.
create table if not exists presupuesto_pieza (
  orden bigint not null,
  suborden int not null,
  pieza text,
  items jsonb not null default '[]'::jsonb,
  costo numeric,
  imprevistos numeric,
  total_costo numeric,
  precio_venta_antes_iva numeric,
  precio_con_iva numeric,
  actualizado_en timestamptz not null default now(),
  primary key (orden, suborden)
);

alter table presupuesto_pieza enable row level security;

drop policy if exists "con sesion presupuesto_pieza" on presupuesto_pieza;
create policy "con sesion presupuesto_pieza" on presupuesto_pieza
  for all to authenticated using (true) with check (true);
