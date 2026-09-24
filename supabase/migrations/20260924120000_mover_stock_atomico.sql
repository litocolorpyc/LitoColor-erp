-- LitoColor ERP — el inventario no se movía con los consumos (reportado
-- 24sep26: "Cartulina Natural 0,50" con 800 pliegos en stock aunque se
-- consumieron 550 + 250; "Polipropileno Mate 22 mc 35 cm" en 0 aunque se
-- compraron 16 kg y no hubo salidas).
--
-- Causa raíz principal: registro.html (la pantalla de los operarios, la del
-- QR) funciona SIN iniciar sesión, y las políticas de materias_primas /
-- insumos_area solo dejan hacer UPDATE con sesión (auth.uid() is not null).
-- Un UPDATE bloqueado por RLS no da error: simplemente afecta 0 filas — así
-- que el consumo "se guardaba", el operario veía "Actividad finalizada",
-- pero el stock nunca bajaba (y el costo automático tampoco se creaba: ese
-- INSERT sí fallaba con error, y solo aparecía después por el re-costeo
-- automático, que por diseño NO toca stock). Revisado con los datos: de
-- ~100 consumos de septiembre, ninguno descontó stock en el momento.
--
-- Causa secundaria: todo cambio de stock se hacía como "leer stock en la
-- página → sumar/restar → escribir el número final". Si la copia en
-- memoria estaba vieja (pestaña abierta hace horas, Maestros > Editar),
-- se pisaban compras o consumos registrados en el medio.
--
-- Arreglo: esta función suma/resta la cantidad DIRECTO en la base
-- (stock_actual = stock_actual + delta), en una sola operación — nunca
-- depende de una copia vieja — y corre con permisos del dueño (security
-- definer), así el operario sin sesión también puede mover stock. Solo
-- toca la columna stock_actual de las dos tablas de materiales; no deja
-- leer ni cambiar nada más. Mismo nivel de acceso que ya tiene la tabla
-- produccion (insert/update/delete públicos), que es de donde sale el
-- consumo.

create or replace function public.mover_stock_material(p_tabla text, p_key text, p_delta numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resultado jsonb;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'La cantidad a mover no puede ser vacía ni cero';
  end if;
  if p_tabla = 'materias_primas' then
    update materias_primas set stock_actual = coalesce(stock_actual, 0) + p_delta
      where codigo = p_key
      returning to_jsonb(materias_primas.*) into resultado;
  elsif p_tabla = 'insumos_area' then
    update insumos_area set stock_actual = coalesce(stock_actual, 0) + p_delta
      where id = p_key::bigint
      returning to_jsonb(insumos_area.*) into resultado;
  else
    raise exception 'Tabla de material no válida: %', p_tabla;
  end if;
  if resultado is null then
    raise exception 'No se encontró el material % en %', p_key, p_tabla;
  end if;
  return resultado;
end;
$$;

revoke all on function public.mover_stock_material(text, text, numeric) from public;
grant execute on function public.mover_stock_material(text, text, numeric) to anon, authenticated;

-- El costo automático del consumo (descontarInventarioYCargarCosto en
-- js/registrar.js) también fallaba para el operario sin sesión. Se permite
-- SOLO ese tipo de fila (ligada a un registro de producción y con el
-- comentario "Consumo automático…"); cualquier otro costo sigue exigiendo
-- sesión, igual que antes. Borrar/editar costos sigue igual (solo con sesión).
drop policy if exists "insertar costo consumo automatico desde registro" on costos_movimientos;
create policy "insertar costo consumo automatico desde registro" on costos_movimientos
  for insert to anon
  with check (produccion_id is not null and recibo_id is null and comentario like 'Consumo automático%');
