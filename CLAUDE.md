# LitoColor-erp

## Qué es

Sistema completo de gestión empresarial (ERP) para LitoColor. Cubre:

- Producción
- Manejo de egresos
- Costos

Usado por varios usuarios con distintos roles.

## Tecnologías

- Frontend: HTML / CSS / JS puro (sin framework)
- Base de datos: SQL, manejada en Supabase

## Cuentas de este proyecto

- Carpeta local: `C:\Mis_Apps\LitoColor-erp`
- GitHub: usar la cuenta **litocolorpyc@gmail.com** (ya configurada como `git config user.email` en esta carpeta — no hace falta cambiarla, pero si Claude ve otra cuenta activa debe avisar antes de hacer push)
- Supabase: proyecto ya vinculado con `supabase link`, Reference ID **nvczpuelhdgrnghxzked**
- Vercel: todavía no configurado en este proyecto (pendiente `vercel link`)

## Modo de trabajo: autónomo, sin pausas de aprobación

La usuaria pidió explícitamente (2026-07-26) que Claude deje de pedir aprobación antes de actuar y avance de punta a punta como si la respuesta fuera siempre "sí" — **incluyendo cambios a la base de datos de Supabase (`supabase db push`) y `git push` a `main`**, que antes requerían confirmación explícita por ser producción real sin ambiente de pruebas.

- No pausar a pedir permiso antes de programar un cambio, hacer commit, hacer push, ni antes de aplicar una migración de Supabase — ejecutar directo.
- Sí seguir explicando en español simple qué se hizo y por qué (rutina de abajo), pero como informe posterior, no como pregunta que bloquea el avance.
- Esta autorización no cubre acciones fuera del proyecto (por ejemplo, tocar otros repos o cuentas) ni acciones evidentemente destructivas sin relación con la tarea pedida (`git reset --hard`, borrar ramas, etc.) — ahí Claude debe seguir avisando antes de actuar.

## Rutina de trabajo esperada

1. El usuario abre PowerShell y se mueve a esta carpeta.
2. Si la tarea toca la base de datos, el usuario activa el token de Supabase de este proyecto en la sesión (`$env:SUPABASE_ACCESS_TOKEN`) antes de abrir Claude Code.
3. Claude programa el cambio directamente y explica qué hizo y por qué, en español simple.
4. Después de hacer el cambio, indicar cómo probarlo.
5. Antes o después de `git commit` / `git push`, mostrar qué archivos cambiaron y por qué (como información, no como pregunta).
6. Si el cambio toca la base de datos en Supabase, avisar qué se hizo (`supabase db push` u otro comando) y aplicarlo directamente — sin esperar confirmación.
7. El usuario es nueva usando terminal y Claude Code: explicar cada paso y cada comando en español simple, sin dar por hecho que conoce la terminal.

## Reglas para trabajar en este proyecto

- Explicar siempre los cambios en español, en lenguaje simple y sin tecnicismos innecesarios
- Antes de borrar o modificar código, explicar qué se va a cambiar y por qué (como aviso, no como pregunta que espera respuesta)
- Mostrar qué archivos cambiaron en cada commit/push
- Los datos de costos y egresos son información financiera sensible — tener cuidado especial al tocar su lógica, pero no es necesario detenerse a confirmar antes de hacerlo
- Tener en cuenta que hay distintos niveles de acceso por rol — no romper esos permisos al hacer cambios
- Si algo toca la base de datos en Supabase, avisar qué se hizo (no hace falta esperar confirmación antes de ejecutar)
- Si un cambio rompe algo, revertir con git y avisar al usuario — no intentar arreglarlo sobre la marcha sin decirle primero

## Estructura del proyecto

- [Pendiente: completar con las carpetas/archivos principales — ej. dónde está el módulo de producción, dónde el de egresos, dónde el de costos, dónde están las consultas a Supabase]

## Entorno de pruebas vs. producción

- No hay proyecto de Supabase de pruebas/staging separado — todo cambio de base de datos se hace directo sobre el proyecto real (Reference ID `nvczpuelhdgrnghxzked`). Ver también la sección "Modo de trabajo" arriba.

## Roles de usuario

- [Pendiente: listar brevemente los roles que existen (ej. admin, producción, contabilidad) y qué puede ver/hacer cada uno]
