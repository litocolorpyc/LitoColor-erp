-- LitoColor ERP — corrección de datos: stock real al 24sep26.
--
-- Por la falla corregida en 20260924120000_mover_stock_atomico.sql, casi
-- ningún consumo registrado por los operarios (registro.html) había
-- descontado stock, y varias compras/consumos se habían pisado al guardar
-- materiales en Maestros con datos viejos. El Kardex (Inventario >
-- Movimientos) sí tenía todos los movimientos bien — lo que estaba mal era
-- el número de "Stock actual".
--
-- Método: stock real = punto de partida confiable + compras − consumos −
-- consumos de reprocesos + ajustes, contando solo lo registrado DESPUÉS de
-- ese punto de partida:
--   - Inventario físico del 07sep26 (Julián Quintero) o ajuste posterior, si lo hay;
--   - si no, la carga inicial del 20ago26 (20260820160000_nuevo_inventario_materias_primas.sql);
--   - Polipropileno Mate 22 mc (creado a mano después del 20ago26): desde 0.
-- Los consumos se cuentan desde la hora en que se FINALIZÓ la actividad
-- (que es cuando la app descuenta), no desde que se creó el registro.
--
-- Se aplica como DIFERENCIA (stock_actual + delta), no como número fijo,
-- para no pisar cualquier movimiento que entre mientras se aplica.
--
-- NO se tocaron (quedan para conteo físico con Inventario > Ajustar):
--   - Cote 300 gr C1S 70x100 (140), Pegante Fuller (20) y Argolla Blanca
--     5/8 (198): alguien les escribió el stock a mano en Maestros, sin
--     rastro de cuándo — no se puede saber qué consumos ya estaban incluidos.
--   - Insumos por área sin conteo inicial (Plancha CTP, Grapas, Tinta,
--     Rollo de laminado brillante, Pegante Fuller [Engomadora]).
--   - Materiales retirados (activo = false).
--
-- Polipropileno Mate 20 mc 30 cm queda en negativo por el registro 964
-- (orden 6019), que dice "574 Kg" — error de digitación. Al corregirlo en
-- "Corregir registro", el stock se ajusta solo (devuelve 574 y descuenta
-- el valor correcto).

-- Polipropileno Mate 22 mc 30 cm: 13.7 → 11.837 (base: 0, material creado después; +13.7 compras, -1.863 consumos)
update materias_primas set stock_actual = stock_actual + (-1.863) where codigo = 'Poli-Mate-22-30';
-- Cartulina Zenith 0,40 70x100: 1018 → 553 (base: carga inicial 20ago26; +430 compras, -465 consumos)
update materias_primas set stock_actual = stock_actual + (-465) where codigo = 'Ca-Ze-40-1';
-- Cartulina Natural 0,50 (250 gr) 70x100: 800 → 0 (base: carga inicial 20ago26; +800 compras, -800 consumos)
update materias_primas set stock_actual = stock_actual + (-800) where codigo = 'Ca-Na-50-1';
-- Cote 200 gr C2S 60x90: 30 → 516 (base: inventario físico 07sep26; +750 compras, -264 consumos)
update materias_primas set stock_actual = stock_actual + (486) where codigo = 'Cote-200-C2-2';
-- Bond 90 gr 70x100: 738 → 450 (base: inventario físico 07sep26; +500 compras, -288 consumos)
update materias_primas set stock_actual = stock_actual + (-288) where codigo = 'B-90-1';
-- Bond 75 gr 60x90: 13960 → 13597 (base: inventario físico 07sep26; +13500 compras, -363 consumos)
update materias_primas set stock_actual = stock_actual + (-363) where codigo = 'B-75-2';
-- Cartulina Natural 0,45 (225 gr) 70x100: 1380 → 0 (base: inventario físico 07sep26; +730 compras, -1380 consumos)
update materias_primas set stock_actual = stock_actual + (-1380) where codigo = 'Ca-Na-45-1';
-- Cote 150 gr C2S 70x100: 1758 → 1022 (base: inventario físico 07sep26; +1500 compras, -928 consumos)
update materias_primas set stock_actual = stock_actual + (-736) where codigo = 'Cote-150-C2-1';
-- Bond 75 gr 70x100: 4240 → 1060 (base: inventario físico 07sep26; +3000 compras, -3180 consumos)
update materias_primas set stock_actual = stock_actual + (-3180) where codigo = 'B-75-1';
-- Cote 150 gr C2S 60x90: 1373 → 221 (base: inventario físico 07sep26; +1250 compras, -1152 consumos)
update materias_primas set stock_actual = stock_actual + (-1152) where codigo = 'Cote-150-C2-2';
-- Cote 200 gr C2S 70x100: 380 → 32 (base: inventario físico 07sep26; +415 compras, -413 consumos)
update materias_primas set stock_actual = stock_actual + (-348) where codigo = 'Cote-200-C2-1';
-- Cote 300 gr C2S 60x90: 575 → 350 (base: carga inicial 20ago26; +475 compras, -225 consumos)
update materias_primas set stock_actual = stock_actual + (-225) where codigo = 'Cote-300-C2-2';
-- Polipropileno Mate 22 mc 35 cm: 0 → 16 (base: 0, material creado después; +16 compras, 0 consumos)
update materias_primas set stock_actual = stock_actual + (16) where codigo = 'Poli-Mate-22-35';
-- Pegante Colbón: 9.835 → 9.685 (base: inventario físico 07sep26; +0 compras, -0.15 consumos)
update materias_primas set stock_actual = stock_actual + (-0.15) where codigo = 'Pe-Co';
-- Polipropileno Brillante 20 mc 35 cm: 17.063 → 9.244 (base: inventario físico 07sep26; +15.8 compras, -7.819 consumos)
update materias_primas set stock_actual = stock_actual + (-7.819) where codigo = 'Poli-Bte-20-35';
-- Polipropileno Mate 20 mc 35 cm: -0.384 → -9.117 (base: inventario físico 07sep26; +0 compras, -9.523 consumos)
update materias_primas set stock_actual = stock_actual + (-8.733) where codigo = 'Poli-Mate-20-35';
-- Polipropileno Brillante 20 mc 33 cm: 1261.737 → -1.263 (base: carga inicial 20ago26; +0 compras, -1.263 consumos)
update materias_primas set stock_actual = stock_actual + (-1263) where codigo = 'Poli-Bte-20-33';
-- Polipropileno Mate 20 mc 25 cm: 1.782 → 2.968 (base: inventario físico 07sep26; +0 compras, -0.031 consumos)
update materias_primas set stock_actual = stock_actual + (1.186) where codigo = 'Poli-Mate-20-25';
-- Polipropileno Mate 20 mc 30 cm: 6.693 → -565.301 (base: inventario físico 07sep26; +0 compras, -574 consumos)
update materias_primas set stock_actual = stock_actual + (-571.994) where codigo = 'Poli-Mate-20-30';
-- Pegante Colbón [Engomadora]: 9.637 → 5.815 (base: inventario físico 07sep26; +0 compras, -4.02 consumos)
update insumos_area set stock_actual = stock_actual + (-3.822) where id = 3;
