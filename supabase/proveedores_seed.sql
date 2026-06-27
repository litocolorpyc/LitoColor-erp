-- ============================================================
-- LitoColor ERP — 5 proveedores reales
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'proveedores_nombre_unique') then
    alter table proveedores add constraint proveedores_nombre_unique unique (nombre);
  end if;
end $$;

insert into proveedores (nombre, nit, telefono, email, materiales, ciudad) values
('Cartonpel (Cartonera del Pelícano S.A.S.)', '890.913.340-1', '604 444 8666', 'servicioalcliente@cartonpel.com.co', 'Cartón corrugado, láminas de cartón, cajas y empaques', 'Medellín / Itagüí'),
('ASHE S.A.S.', '890.301.127-1', '604 444 1946', 'contacto@ashe.com.co', 'Papel, cartón, insumos para artes gráficas, tintas, cameos', 'Medellín'),
('Suministros Gráficos de Colombia S.A.S.', '900.649.167-1', '604 448 3131', 'ventas@suministrosgraficos.com', 'Tintas, placas para troquel, insumos litográficos, planchas', 'Medellín'),
('Kartonar S.A.S.', '900.528.411-4', '604 444 7108', 'contacto@kartonar.com', 'Cartón corrugado, láminas de cartón, cajas troqueladas', 'Medellín'),
('Bolsas y Empaques Medellín', '901.442.158-2', '+57 302 293 8944', 'contacto@bolsasyempaquesmedellin.com', 'Papel Kraft, bolsas de papel, cartón plegadizo, empaques', 'Medellín')
on conflict (nombre) do update set
  nit = excluded.nit, telefono = excluded.telefono, email = excluded.email,
  materiales = excluded.materiales, ciudad = excluded.ciudad;