-- ============================================================
-- LitoColor ERP — roles reales del personal + campo de máquina
-- Pégalo en Supabase > SQL Editor > New query > Run
-- ============================================================

update personal set cargo = 'Gerente' where nombre = 'Julian Quintero';
update personal set cargo = 'Jefe de Producción' where nombre = 'Juan Carlos Quintero';
update personal set cargo = 'Diseñador Gráfico' where nombre = 'Juan Manuel Quintero';
update personal set cargo = 'Administradora' where nombre = 'Liliana Giraldo';

alter table produccion add column if not exists maquina text;
