-- ============================================================
-- LitoColor ERP — v7: correos y roles reales de los 4 accesos
-- Pégalo en Supabase > SQL Editor > New query > Run
-- ============================================================

update personal set email = 'ventas@litocolor.com.co', rol = 'gerente'
  where nombre = 'Julian Quintero';

update personal set email = 'produccionlitocolor@outlook.com', rol = 'jefe_produccion'
  where nombre = 'Juan Carlos Quintero';

update personal set email = 'facturacionlitocolor@gmail.com', rol = 'administradora'
  where nombre = 'Liliana Giraldo';

-- Diana no es personal de planta — se agrega como un acceso administrativo aparte
insert into personal (nombre, cargo, email, rol, activo)
values ('Diana', 'Administradora de Innovación', 'innovacion@flowando.com', 'admin', true)
on conflict (email) do update set rol = excluded.rol, cargo = excluded.cargo;

-- Juan Manuel Quintero queda igual, sin correo ni rol — no tiene acceso por ahora.
