-- Dos clientes por orden (reunión 27oct26): `cliente` pasa a ser "a quién se
-- factura" (como siempre) y `cliente_produccion` es "para quién se produce"
-- (ej. se factura a Magic Medios, se produce para Santa Leña). Opcional:
-- si está vacío se entiende que es el mismo cliente que se factura.
alter table opp_ordenes
  add column if not exists cliente_produccion text;
