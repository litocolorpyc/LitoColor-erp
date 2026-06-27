-- ============================================================
-- LitoColor ERP — v8: crear los 4 usuarios de inicio de sesión
-- directamente por SQL (sin usar Authentication > Add user)
-- ============================================================
-- ADVERTENCIA HONESTA: esto escribe directamente en el esquema interno
-- de autenticación de Supabase (auth.users / auth.identities). Es una
-- técnica ampliamente usada por la comunidad de Supabase, pero NO es un
-- método oficialmente soportado por ellos (la forma "oficial" es crear
-- cada usuario desde Authentication > Add user, o desde un backend con
-- la llave service_role). Funciona hoy con la versión actual de
-- Supabase. Si en el futuro Supabase cambia esa estructura interna y
-- este script da error, ese día sí tocaría volver al método manual del
-- dashboard para los usuarios nuevos que falten — los que ya queden
-- creados con este script no se ven afectados.
-- ============================================================

create extension if not exists pgcrypto;

-- -------- función auxiliar: crea 1 usuario si no existe --------
do $$
declare
  v_email text;
  v_password text := 'LitoColor2026*';
  v_user_id uuid;
  correos text[] := array[
    'innovacion@flowando.com',
    'ventas@litocolor.com.co',
    'produccionlitocolor@outlook.com',
    'facturacionlitocolor@gmail.com'
  ];
begin
  foreach v_email in array correos loop

    -- si ya existe ese correo, no lo vuelve a crear
    if not exists (select 1 from auth.users where email = v_email) then

      v_user_id := gen_random_uuid();

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, is_super_admin,
        confirmation_token, recovery_token,
        email_change_token_new, email_change, email_change_token_current,
        email_change_confirm_status
      ) values (
        '00000000-0000-0000-0000-000000000000',
        v_user_id, 'authenticated', 'authenticated', v_email,
        crypt(v_password, gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}', '{}', false,
        '', '', '', '', '', 0
      );

      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), v_user_id, v_user_id::text,
        jsonb_build_object('sub', v_user_id::text, 'email', v_email),
        'email', now(), now(), now()
      );

    end if;

  end loop;
end $$;

-- Verifica que quedaron creados:
select email, created_at from auth.users
where email in (
  'innovacion@flowando.com', 'ventas@litocolor.com.co',
  'produccionlitocolor@outlook.com', 'facturacionlitocolor@gmail.com'
);
