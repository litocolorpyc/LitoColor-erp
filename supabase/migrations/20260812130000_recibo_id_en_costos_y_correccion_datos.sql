-- LitoColor ERP — corrige el flujo de "Importar compra / costo" (pedido del
-- 12ago26: la usuaria cargó 3 facturas y el sistema no le pidió IVA/
-- Retención de verdad, no ligó un papel al inventario, y no tenía forma de
-- corregir un cero de más que se le coló en una línea).
--
-- Causa raíz encontrada:
-- 1) El modal de IVA%/Retención% del documento se puede "Aplicar" con 0%/0%
--    sin ningún aviso, aunque la factura ya traiga IVA%/Retención% por línea
--    (columnas que sí se leen bien del PDF) — quedó guardado en null y el
--    costo neto que baja al inventario salió igual al bruto.
-- 2) Cuando una línea no calza exacto con ningún material del inventario
--    (ej. "BOND BLANCO 75 60 X90" vs "Bond 75 gr 60x90"), la fila queda
--    resaltada para revisión pero nada impedía guardar el documento sin
--    revisarla — así el papel nunca llegó al inventario.
-- 3) No existía ninguna forma de corregir o borrar un documento ya
--    guardado (ni sus líneas, ni el stock que sumó, ni el costo que generó)
--    — un error de tecleo quedaba pegado para siempre.
--
-- Esta migración solo agrega la columna que hacía falta para el punto 3
-- (poder borrar en bloque los costos_movimientos que generó un recibo al
-- borrar el recibo). Los otros dos puntos son de js/recibos.js (modal con
-- aviso + confirmación antes de guardar si quedan líneas sin ligar).
alter table costos_movimientos
  add column if not exists recibo_id bigint references recibos_caja(id) on delete set null;

create index if not exists idx_costos_movimientos_recibo_id on costos_movimientos (recibo_id);

-- Corrección puntual de datos: 3 documentos cargados el 12ago26 quedaron
-- con iva_pct_aplicado/retencion_pct_aplicado en null (el modal se aplicó
-- sin escribir el %) y una línea ("CLISE DE ESTAMPACION", recibo #5) se
-- tecleó con un cero de más ($1.000.000 en vez de $100.000 — el Total
-- Bruto de esa factura era $300.000 para 3 unidades). Ya se corrigió a
-- mano contra la factura original vía la API de administración de
-- Supabase antes de esta migración; se deja esta nota para que quede en
-- el historial de cambios de la base de datos.
