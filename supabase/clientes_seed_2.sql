-- ============================================================
-- LitoColor ERP — 13 clientes adicionales (datos completados con
-- búsqueda pública donde fue posible; el resto solo con ciudad)
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clientes_nombre_unique') then
    alter table clientes add constraint clientes_nombre_unique unique (nombre);
  end if;
end $$;

insert into clientes (nombre, nit, telefono, email, direccion, ciudad) values
('Cecilia Ruiz', NULL, NULL, NULL, NULL, 'Medellín'),
('Jaime Montoya', NULL, NULL, NULL, NULL, 'Medellín'),
('Susana Arenas', NULL, NULL, NULL, NULL, 'Medellín'),
('Eco Masilla', NULL, NULL, NULL, NULL, 'Medellín'),
('La Fraga', NULL, NULL, NULL, NULL, 'Medellín'),
('Cacao Guille', NULL, '316 869 4041', NULL, NULL, 'Santa Bárbara, Antioquia'),
('Instinto Creativo', NULL, NULL, NULL, NULL, 'Medellín'),
('Somos Impresión Digital', NULL, '301 769 7175', NULL, 'Calle 51 # 44-59', 'Bello'),
('Omika Detalles', NULL, NULL, NULL, NULL, 'Medellín'),
('Grupo Azulado', NULL, '311 624 4284', NULL, 'Calle 34 # 44A-73', 'Medellín'),
('Ovha', NULL, NULL, NULL, NULL, 'Medellín'),
('Intercolor', NULL, NULL, NULL, 'Cra. 55 # 83B Sur-114', 'La Estrella'),
('Effusion', NULL, NULL, NULL, NULL, 'Medellín')
on conflict (nombre) do update set
  nit = excluded.nit, telefono = excluded.telefono, email = excluded.email,
  direccion = excluded.direccion, ciudad = excluded.ciudad;