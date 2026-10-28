-- Ajustes al catálogo de motivos de reproceso (análisis del procedimiento
-- PR-PROD-DAÑ-01, 28oct26): corrige un error de escritura y agrega los dos
-- motivos que el procedimiento menciona y no existían.
update motivos_reproceso set nombre = 'Papel defectuoso' where nombre = 'Pepel defectuoso'
  and not exists (select 1 from motivos_reproceso where nombre = 'Papel defectuoso');
update produccion set motivo_reproceso = 'Papel defectuoso' where motivo_reproceso = 'Pepel defectuoso';

insert into motivos_reproceso (nombre) values
  ('Pedido incompleto / no salió'),
  ('Exceso de producción (sobrante)')
on conflict (nombre) do nothing;
