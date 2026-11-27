-- Cambiar el número de una orden ya montada (pedido del cliente, 26nov26: se
-- digitaron 6990-6992 en vez de 6090-6092). El número es la llave que usan
-- varias tablas, así que se cambia en todas dentro de una sola transacción:
-- o queda todo cambiado o no se cambia nada. Solo Gerente y Jefe de Producción.

-- Número como se muestra en pantalla (igual que etiquetaOrden en js/helpers.js).
create or replace function etiqueta_orden(n int) returns text
language sql immutable as $$
  select case when n >= 1000000 then 'S-' || lpad((n - 1000000)::text, 4, '0') else n::text end
$$;

create or replace function cambiar_numero_orden(p_actual int, p_nuevo int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ant text; v_new text;
  v_orden opp_ordenes%rowtype;
  v_ocupado text;
  v_resumen jsonb := '{}'::jsonb;
  v_n int;
  t text;
  -- tablas cuya columna "orden" es el N° de la orden
  v_tablas text[] := array['opp_piezas','produccion','costos_movimientos','pedidos','presupuesto_orden',
    'presupuesto_pieza','alertas_faltante_material','recibos_caja_items','remision_ordenes','remision_items',
    'facturas_venta_items','inventario_producto','danos_equipos'];
begin
  if coalesce(rol_actual(), '') not in ('gerente', 'jefe_produccion') then
    raise exception 'Solo el Gerente y el Jefe de Producción pueden cambiar el número de una orden';
  end if;
  if p_actual is null or p_nuevo is null or p_nuevo <= 0 then
    raise exception 'Número de orden no válido';
  end if;
  if p_actual = p_nuevo then
    raise exception 'El número nuevo es igual al actual';
  end if;
  v_ant := etiqueta_orden(p_actual);
  v_new := etiqueta_orden(p_nuevo);

  -- evita que alguien guarde algo con el número viejo o nuevo a mitad del cambio
  lock table opp_ordenes in share row exclusive mode;

  select * into v_orden from opp_ordenes where orden = p_actual for update;
  if not found then
    raise exception 'No existe la orden %', v_ant;
  end if;

  -- el número nuevo debe estar totalmente libre: si no, se mezclarían dos trabajos
  if exists (select 1 from opp_ordenes where orden = p_nuevo) then
    raise exception 'Ya existe una orden con el número %. No se cambió nada.', v_new;
  end if;
  foreach t in array v_tablas loop
    execute format('select count(*) from %I where orden = $1', t) into v_n using p_nuevo;
    if v_n > 0 then v_ocupado := concat_ws(', ', v_ocupado, t); end if;
  end loop;
  if exists (select 1 from prioridad_area where orden_prod = p_nuevo) then v_ocupado := concat_ws(', ', v_ocupado, 'prioridad_area'); end if;
  if exists (select 1 from reproceso_casos where clave = 'o' || p_nuevo) then v_ocupado := concat_ws(', ', v_ocupado, 'reproceso_casos'); end if;
  if exists (select 1 from reproceso_evidencias where clave = 'o' || p_nuevo) then v_ocupado := concat_ws(', ', v_ocupado, 'reproceso_evidencias'); end if;
  if v_ocupado is not null then
    raise exception 'El número % ya tiene información guardada (%). No se cambió nada.', v_new, v_ocupado;
  end if;

  -- 1) la orden con el número nuevo (copia de todos sus datos)
  insert into opp_ordenes
  select (jsonb_populate_record(v_orden, jsonb_build_object('orden', p_nuevo))).*;

  -- 2) los textos que llevan el número ("6990-2" -> "6090-2")
  update opp_piezas set op = v_new || '-' || suborden where orden = p_actual;
  update produccion set
    op  = regexp_replace(op,  '^\s*(' || v_ant || '|' || p_actual || ')(?=$|-)', v_new),
    opp = regexp_replace(opp, '^\s*(' || v_ant || '|' || p_actual || ')(?=$|-)', v_new)
    where orden = p_actual;
  update costos_movimientos set
    opp = regexp_replace(opp, '^\s*(' || v_ant || '|' || p_actual || ')(?=$|-)', v_new)
    where orden = p_actual;
  update pedidos set
    opp = regexp_replace(opp, '^\s*(' || v_ant || '|' || p_actual || ')(?=$|-)', v_new)
    where orden = p_actual;

  -- 3) el número en todas las tablas
  foreach t in array v_tablas loop
    execute format('update %I set orden = $1 where orden = $2', t) using p_nuevo, p_actual;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_resumen := v_resumen || jsonb_build_object(t, v_n); end if;
  end loop;
  update prioridad_area set orden_prod = p_nuevo where orden_prod = p_actual;
  update reproceso_casos set clave = 'o' || p_nuevo where clave = 'o' || p_actual;
  update reproceso_evidencias set clave = 'o' || p_nuevo where clave = 'o' || p_actual;
  update inventario_producto set caso_clave = 'o' || p_nuevo where caso_clave = 'o' || p_actual;

  -- 4) ya nada apunta al número viejo
  delete from opp_ordenes where orden = p_actual;

  insert into cambios_numero_orden (orden_anterior, orden_nueva, usuario, filas)
  values (p_actual, p_nuevo, auth.jwt() ->> 'email', v_resumen);

  return v_resumen;
end $$;

-- Rastro de quién cambió qué número y cuándo.
create table if not exists cambios_numero_orden (
  id bigserial primary key,
  orden_anterior int not null,
  orden_nueva int not null,
  usuario text,
  filas jsonb,
  cambiado_en timestamptz not null default now()
);
alter table cambios_numero_orden enable row level security;
drop policy if exists "cambios_numero_orden lectura" on cambios_numero_orden;
create policy "cambios_numero_orden lectura" on cambios_numero_orden for select using (auth.uid() is not null);

revoke all on function cambiar_numero_orden(int, int) from public, anon;
grant execute on function cambiar_numero_orden(int, int) to authenticated;
