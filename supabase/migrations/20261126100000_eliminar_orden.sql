-- Eliminar una orden montada por error (por ejemplo, repetida), para liberar su
-- número. Solo Gerente y Jefe de Producción, y solo si la orden no tiene nada
-- registrado: con tiempos, costos, remisiones, etc. se cancela o se renumera.
-- Antes de borrar se guarda una copia completa en ordenes_eliminadas.

create table if not exists ordenes_eliminadas (
  id bigserial primary key,
  orden int not null,
  datos jsonb not null,
  usuario text,
  eliminado_en timestamptz not null default now()
);
alter table ordenes_eliminadas enable row level security;
drop policy if exists "ordenes_eliminadas lectura" on ordenes_eliminadas;
create policy "ordenes_eliminadas lectura" on ordenes_eliminadas for select
  using (rol_actual() in ('admin', 'gerente', 'jefe_produccion'));

create or replace function eliminar_orden(p_orden int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lbl text := etiqueta_orden(p_orden);
  v_datos jsonb;
  v_con text;
  v_n int;
  r record;
begin
  if coalesce(rol_actual(), '') not in ('gerente', 'jefe_produccion') then
    raise exception 'Solo el Gerente y el Jefe de Producción pueden eliminar una orden';
  end if;

  lock table opp_ordenes in share row exclusive mode;
  perform 1 from opp_ordenes where orden = p_orden for update;
  if not found then
    raise exception 'No existe la orden %', v_lbl;
  end if;

  for r in select * from (values
      ('produccion', 'registros de producción'), ('costos_movimientos', 'costos'),
      ('recibos_caja_items', 'compras'), ('remision_ordenes', 'remisiones'),
      ('remision_items', 'ítems de remisión'), ('facturas_venta_items', 'facturas de venta'),
      ('inventario_producto', 'inventario de producto'), ('danos_equipos', 'daños de equipos'),
      ('pedidos', 'pedidos')) as x(tabla, nombre)
  loop
    execute format('select count(*) from %I where orden = $1', r.tabla) into v_n using p_orden;
    if v_n > 0 then v_con := concat_ws(', ', v_con, r.nombre || ' (' || v_n || ')'); end if;
  end loop;
  if exists (select 1 from reproceso_casos where clave = 'o' || p_orden)
     or exists (select 1 from reproceso_evidencias where clave = 'o' || p_orden) then
    v_con := concat_ws(', ', v_con, 'reprocesos');
  end if;
  if v_con is not null then
    raise exception 'La orden % no se puede eliminar porque ya tiene: %. Puedes cancelarla o cambiarle el número.', v_lbl, v_con;
  end if;

  select jsonb_build_object(
    'orden', (select to_jsonb(o) from opp_ordenes o where orden = p_orden),
    'piezas', (select jsonb_agg(to_jsonb(p)) from opp_piezas p where orden = p_orden),
    'presupuesto', (select to_jsonb(p) from presupuesto_orden p where orden = p_orden),
    'presupuesto_pieza', (select jsonb_agg(to_jsonb(p)) from presupuesto_pieza p where orden = p_orden),
    'prioridad_area', (select jsonb_agg(to_jsonb(p)) from prioridad_area p where orden_prod = p_orden),
    'alertas', (select jsonb_agg(to_jsonb(a)) from alertas_faltante_material a where orden = p_orden)
  ) into v_datos;
  insert into ordenes_eliminadas (orden, datos, usuario)
  values (p_orden, v_datos, auth.jwt() ->> 'email');

  delete from alertas_faltante_material where orden = p_orden;
  delete from prioridad_area where orden_prod = p_orden;
  delete from presupuesto_pieza where orden = p_orden;
  delete from presupuesto_orden where orden = p_orden;
  delete from opp_piezas where orden = p_orden;
  delete from opp_ordenes where orden = p_orden;
end $$;

revoke all on function eliminar_orden(int) from public, anon;
grant execute on function eliminar_orden(int) to authenticated;
