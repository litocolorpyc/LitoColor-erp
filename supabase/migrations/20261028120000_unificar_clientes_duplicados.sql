-- Unifica nombres de cliente duplicados (reunión 27oct26): variantes por
-- mayúsculas, espacios dobles, "S.A.S." y nombre comercial vs. razón social.
-- El nombre final es el comercial corto (el más usado en órdenes); al maestro
-- `clientes` se le pasan NIT/teléfono/correo/dirección/ciudad del registro
-- largo antes de eliminarlo. Copia previa: backups_litocolor/*_antes_unificar_clientes.
do $$
declare
  m record;
  t text;
begin
  create temp table _mapa_clientes(variante text primary key, final text not null) on commit drop;
  insert into _mapa_clientes values
    ('arte impresores','Arte Impresores'), ('ARTE  IMPRESORES','Arte Impresores'), ('ARTE IMPRESORES','Arte Impresores'),
    ('Autolarte S.A.S.','Autolarte'), ('AUTOLARTE SAS','Autolarte'),
    ('Camacol Antioquia','Camacol'),
    ('Cardiomed S.A.S.','Cardiomed'),
    ('consumibles','Consumibles'), ('CONSUMIBLES','Consumibles'),
    ('DIAGNOSTICO DIGITAL','Diagnostico Digital'), ('Diagnóstico Digital (Lausof Carsan S.A.S.)','Diagnostico Digital'),
    ('doricolor','Doricolor S.A.S. (Indulit S.A.S.)'), ('DORICOLOR','Doricolor S.A.S. (Indulit S.A.S.)'),
    ('EcoMasilla','Eco Masilla'),
    ('Instinto Creativo Group S.A.S.','Instinto Creativo'), ('INSTINTO CREATIVO','Instinto Creativo'), ('INSTINTO CREATIVO GROUP S.A.S.','Instinto Creativo'),
    ('JIPER SAS','Jiper SAS'),
    ('LA  FRAGA','La Fraga'),
    ('LITOCOLOR','Litocolor S.A.S.'),
    ('Magic Medios S.A.S.','Magic Medios'), ('MAGIC  MEDIOS','Magic Medios'), ('MAGIC MEDIOS','Magic Medios'), ('MAGIC MEDIOS SAS','Magic Medios'),
    ('NUEZ DECO SAS','Nuez Deco'),
    ('OMIKA DETALLES','Omika Detalles'),
    ('Pimienta Cathering','Pimienta Catering'), ('Pimienta Catering Y Eventos S.A.S.','Pimienta Catering'), ('PIMIENTA CATERING Y EVENTOS S.A.S','Pimienta Catering'),
    ('Restaurante Milagros (Inversiones Milagros S.A.S.)','Restaurante Milagros'),
    ('Santa Leña (Censuma S.A.S.)','Santa Leña'),
    ('UNMERCO SAS','Unmerco');

  -- 1) Maestro: pasar datos del registro largo al corto (solo donde el corto está vacío) y eliminar el duplicado.
  --    "Pimienta Cathering" (con error) se renombra a "Pimienta Catering".
  update clientes set nombre = 'Pimienta Catering' where nombre = 'Pimienta Cathering';
  for m in
    select v.variante, v.final from _mapa_clientes v
    where exists (select 1 from clientes where nombre = v.variante) and v.variante <> v.final
  loop
    update clientes f set
      nit       = coalesce(nullif(f.nit,''), d.nit),
      telefono  = coalesce(nullif(f.telefono,''), d.telefono),
      email     = coalesce(nullif(f.email,''), d.email),
      direccion = coalesce(nullif(f.direccion,''), d.direccion),
      ciudad    = coalesce(nullif(f.ciudad,''), d.ciudad)
    from clientes d
    where f.nombre = m.final and d.nombre = m.variante;
    delete from clientes where nombre = m.variante;
  end loop;

  -- 2) Textos de cliente en las tablas que lo guardan como texto.
  update facturas_venta  x set cliente = v.final from _mapa_clientes v where x.cliente = v.variante;
  update opp_ordenes     x set cliente = v.final from _mapa_clientes v where x.cliente = v.variante;
  update opp_ordenes     x set cliente_produccion = v.final from _mapa_clientes v where x.cliente_produccion = v.variante;
  update pedidos         x set cliente = v.final from _mapa_clientes v where x.cliente = v.variante;
  update produccion      x set cliente = v.final from _mapa_clientes v where x.cliente = v.variante;
  update remisiones      x set cliente = v.final from _mapa_clientes v where x.cliente = v.variante;
end $$;
