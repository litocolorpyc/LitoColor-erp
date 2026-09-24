-- LitoColor ERP — complemento de 20260924130000_correccion_stock_real.sql.
-- Un consumo registrado como "Polipropileno Mate 20 mc 33cm" (sin espacio
-- antes de "cm") no coincidía con el maestro ("… 33 cm") y nunca descontó.
-- Desde 24sep26 normNombreMaterial (js/helpers.js) ignora los espacios, así
-- que la app ya lo reconoce como este material (Kardex y "Corregir
-- registro") — el stock tiene que reflejarlo igual.
-- Polipropileno Mate 20 mc 33 cm: 0 → -0.8 (base: carga inicial 20ago26; 0 compras, -0.8 consumos)
update materias_primas set stock_actual = stock_actual + (-0.8) where codigo = 'Poli-Mate-20-33';
