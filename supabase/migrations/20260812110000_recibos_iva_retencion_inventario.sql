-- LitoColor ERP — IVA%/Retención% al importar una compra, y que quede
-- reflejado en el inventario como valor neto (pedido del 12ago26).
--
-- iva_pct_aplicado / retencion_pct_aplicado: los porcentajes que se
-- cargan UNA VEZ por documento (modal al abrir el PDF/imagen), aplicados
-- a todas sus líneas — distintos de recibos_caja.iva/retefuente, que son
-- los VALORES en pesos que trae el encabezado del PDF de Siigo (cuando se
-- puede leer), no porcentajes.
alter table recibos_caja
  add column if not exists iva_pct_aplicado numeric,
  add column if not exists retencion_pct_aplicado numeric;

-- Por línea: el costo neto ya calculado (valor_unitario − IVA% + Retención%)
-- y a qué material del inventario quedó ligada esa línea — para poder
-- auditar qué actualizó el stock/costo_unitario de cada material, y para
-- que "Ajustar" (si hiciera falta más adelante) sepa qué se tocó.
alter table recibos_caja_items
  add column if not exists valor_neto_unitario numeric,
  add column if not exists material_tabla text,  -- 'materias_primas' | 'insumos_area'
  add column if not exists material_key text;     -- codigo (materias_primas) o id (insumos_area), como texto
