-- La información del Excel de Julián (histórico de ventas y compras) la ve
-- SOLO el Gerente (pedido 28oct26: "solamente él podrá verla"). Dos partes:
-- 1) las tablas financieras se leen únicamente con rol 'gerente';
-- 2) como `personal` permitía a cualquier usuario con sesión editar su propio
--    rol, se protege: solo admin/gerente pueden cambiar roles o correos, y solo
--    un gerente puede asignar, quitar o tocar el rol 'gerente'.
do $$
declare t text;
begin
  foreach t in array array['ventas_mensual','ventas_area_mensual','ventas_cliente_anual','compras_mensual'] loop
    execute format('drop policy if exists "lectura financiera %1$s" on %1$I', t);
    execute format('create policy "lectura financiera %1$s" on %1$I for select using (public.rol_actual() = ''gerente'')', t);
  end loop;
end $$;

create or replace function public.proteger_rol_personal() returns trigger
language plpgsql security definer set search_path = public as $$
declare actual text := public.rol_actual();
begin
  if auth.uid() is null then return new; end if;   -- cargas internas (migraciones, administración de la base)
  if tg_op = 'INSERT' then
    if coalesce(new.rol, 'operario') <> 'operario' then
      if actual is null or actual not in ('admin','gerente') then
        raise exception 'Solo el administrador o el gerente pueden asignar roles';
      end if;
      if new.rol = 'gerente' and actual <> 'gerente' then
        raise exception 'Solo el gerente puede asignar el rol de gerente';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.rol is distinct from old.rol or lower(coalesce(new.email,'')) is distinct from lower(coalesce(old.email,'')) then
      if actual is null or actual not in ('admin','gerente') then
        raise exception 'Solo el administrador o el gerente pueden cambiar roles o correos';
      end if;
      if (new.rol = 'gerente' or old.rol = 'gerente') and actual <> 'gerente' then
        raise exception 'Solo el gerente puede cambiar el rol o el correo del gerente';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_proteger_rol_personal on personal;
create trigger trg_proteger_rol_personal before insert or update on personal
  for each row execute function public.proteger_rol_personal();
