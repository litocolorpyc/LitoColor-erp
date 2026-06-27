-- ============================================================
-- LitoColor ERP — 16 clientes reales
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clientes_nombre_unique') then
    alter table clientes add constraint clientes_nombre_unique unique (nombre);
  end if;
end $$;

insert into clientes (nombre, nit, telefono, email, direccion, ciudad) values
('Litocolor S.A.S.', '890.925.864-1', '(604) 444 0282', 'ventas@litocolor.com.co', 'Calle 24 # 60-45', 'Medellín'),
('Autolarte S.A.S.', '890.900.081-8', '(604) 444 9545', 'notificaciones@autolarte.com.co', 'Carrera 50 # 32-16', 'Medellín'),
('Supermercados Euro (Euro Supermercados S.A.)', '811.045.607-6', '(604) 444 0366', 'atencionalcliente@eurosupermercados.com', 'Carrera 47 # 83A-40', 'Medellín'),
('Santa Leña (Censuma S.A.S.)', '901.061.589-5', '301 715 5558', 'ddigital@santalena.com.co', 'Cra 43A # 3 Sur-81 (Milla de Oro)', 'Medellín'),
('Camacol Antioquia', '890.905.176-1', '(604) 448 8030', 'camacol@camacolantioquia.in', 'Cra 43A # 1-50 San Fernando Plaza', 'Medellín'),
('Interactuar (Corporación Interactuar)', '890.984.347-1', '(604) 450 8888', 'interactuar@interactuar.org.co', 'Calle 49 # 53-22', 'Medellín'),
('Restaurante Milagros (Inversiones Milagros S.A.S.)', '900.395.732-2', '(604) 448 4402', 'admonmilagros@gmail.com', 'Carrera 35 # 7-65', 'Medellín'),
('Inventto Group S.A.S.', '900.528.271-9', '304 461 6723', 'info@inventtogroup.com', 'Calle 29D # 55-73', 'Medellín'),
('Cardiomed S.A.S.', '811.018.326-8', '(604) 444 3662', 'info@cardiomed.com.co', 'Carrera 48 # 19A-50 Int. 114', 'Medellín'),
('Dar Ayuda Temporal S.A.', '800.125.132-7', '(604) 448 4060', 'servicioalcliente@darayuda.com', 'Calle 8B # 43C-23', 'Medellín'),
('Magic Medios S.A.S.', '900.370.219-5', '(604) 322 2840', 'info@magicmedios.com', 'Circular 4 # 73-41', 'Medellín'),
('Doricolor S.A.S. (Indulit S.A.S.)', '800.012.778-5', NULL, 'datospersonales@doricolor.com.co', NULL, 'Sabaneta'),
('Pimienta Catering Y Eventos S.A.S.', '901.014.800-5', '317 591 0046', NULL, 'Calle 49A # 36-82', 'Medellín / Envigado'),
('Arte Zoom', NULL, '(604) 408 9754 / 320 721 4248', 'medellin@artezoom.com', 'Calle 7 Sur # 50B-24', 'Medellín'),
('Diagnóstico Digital (Lausof Carsan S.A.S.)', '900.438.962-6', '(604) 322 0117 / 300 131 5684', 'andre_cielo@diagnosticodigital.co', 'Calle 68 Sur # 45-36 (Sabaneta)', 'Sabaneta / Itagüí'),
('Ikarus Publicidad S.A.S.', '901.156.138', NULL, NULL, 'Calle 29 # 41-105 Of. 501', 'Medellín')
on conflict (nombre) do update set
  nit = excluded.nit, telefono = excluded.telefono, email = excluded.email,
  direccion = excluded.direccion, ciudad = excluded.ciudad;