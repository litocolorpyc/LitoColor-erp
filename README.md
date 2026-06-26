# LitoColor ERP

Aplicativo web para LitoColor: dashboard gerencial, de producción y por operario,
más un formulario para capturar la producción diaria — conectado a una base de
datos real (Supabase) y publicado en internet (Vercel), con el código guardado
en GitHub.

Esta guía asume que **nunca has hecho esto antes**. Sigue los pasos en orden,
de arriba a abajo. No te saltes ninguno.

---

## 0. Qué vas a tener al final

```
Tu computador / GitHub  →  código del aplicativo
Supabase                →  la base de datos (las tablas con tus datos reales)
Vercel                  →  el sitio web público, ej. https://litocolor.vercel.app
```

Los tres son gratuitos en el plan que vas a usar.

---

## 1. Crear la base de datos en Supabase

1. Entra a **https://supabase.com** y crea una cuenta (puedes usar tu cuenta de GitHub para registrarte, así quedan conectadas desde el inicio).
2. Click en **"New project"**.
   - **Name**: `litocolor-erp`
   - **Database password**: genera una y **guárdala en un lugar seguro** (un gestor de contraseñas o una nota). La vas a necesitar muy pocas veces, pero si la pierdes es difícil recuperarla.
   - **Region**: elige la más cercana (por ejemplo, alguna en South America si está disponible, o la que tenga menor latencia).
3. Espera 1-2 minutos mientras Supabase crea el proyecto.
4. En el menú izquierdo, click en **SQL Editor**.
5. Click en **"New query"**.
6. Abre el archivo `supabase/schema.sql` de esta carpeta, copia **todo** su contenido, pégalo en el editor de Supabase y click en **Run** (o Ctrl+Enter).
   - Deberías ver "Success. No rows returned". Esto crea las 5 tablas (personal, máquinas, actividades, pedidos, producción) y la seguridad básica.
7. Click otra vez en **"New query"**.
8. Abre el archivo `supabase/seed.sql`, copia **todo** su contenido, pégalo, y click en **Run**.
   - Este archivo es grande porque tiene tus 1.200 registros históricos de producción y tus 458 pedidos reales. Puede tardar unos segundos.
   - Si Supabase se queja de que el query es muy largo para pegar de una vez, divide el archivo en 2 o 3 partes (corta entre los bloques `insert into ... values` que ya están separados) y corre cada parte por separado.
9. Para confirmar que quedó bien: en el menú izquierdo click en **Table Editor**. Deberías ver las tablas `personal`, `maquinas`, `actividades`, `pedidos`, `produccion`, cada una con datos dentro.

### 1.1 Obtener tus credenciales

1. Click en el ícono de engranaje (**Project Settings**) en el menú izquierdo.
2. Click en **API**.
3. Vas a ver dos valores que necesitas:
   - **Project URL** → algo como `https://abcdefgh.supabase.co`
   - **anon public** key → una cadena larga de letras y números
4. Déjalos a la mano, los vas a pegar en el paso 3.

---

## 2. Subir el código a GitHub

1. Entra a **https://github.com** y crea una cuenta si no tienes.
2. Click en el botón **"+"** arriba a la derecha → **"New repository"**.
   - **Repository name**: `litocolor-erp`
   - Déjalo en **Public** (no hay datos sensibles de clientes expuestos en el código; los datos reales están en Supabase, no en GitHub).
   - No marques "Add a README" (ya tenemos uno).
   - Click **Create repository**.
3. Ahora sube los archivos. Tienes dos caminos — elige el que te resulte más fácil:

### Opción A — Sin usar la terminal (más fácil para empezar)
1. En la página de tu repositorio nuevo, click en **"uploading an existing file"**.
2. Arrastra **todos** los archivos y carpetas de este proyecto (`index.html`, `styles.css`, `app.js`, `config.js`, la carpeta `supabase/`, este `README.md`).
3. Abajo, escribe un mensaje como "Primera versión" y click en **"Commit changes"**.

### Opción B — Con Git instalado en tu computador
```bash
cd litocolor-erp
git init
git add .
git commit -m "Primera versión"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/litocolor-erp.git
git push -u origin main
```

---

## 3. Pegar tus credenciales de Supabase en el código

1. Abre el archivo `config.js` (en GitHub puedes hacerlo directo en el navegador: ábrelo y click en el ícono de lápiz para editar).
2. Reemplaza:
   ```js
   const SUPABASE_URL = "PEGA_AQUI_TU_PROJECT_URL";
   const SUPABASE_ANON_KEY = "PEGA_AQUI_TU_ANON_KEY";
   ```
   con tus valores reales del paso 1.1.
3. Guarda los cambios (en GitHub: "Commit changes").

> Nota de seguridad: esta llave "anon" está diseñada para ser pública — vive en
> el navegador de cualquiera que abra la página. Lo que realmente protege tus
> datos es la configuración de seguridad (RLS) que ya quedó en `schema.sql`:
> solo permite leer datos y guardar nuevos registros de producción, nunca
> editar ni borrar nada.

---

## 4. Publicar el sitio en Vercel

1. Entra a **https://vercel.com** y crea una cuenta usando **"Continue with GitHub"** (así Vercel puede ver tus repositorios).
2. Click en **"Add New..."** → **"Project"**.
3. Busca y selecciona el repositorio `litocolor-erp` → click **"Import"**.
4. Vercel va a detectar que es un sitio estático (HTML simple). No necesitas cambiar ninguna configuración — déjalo todo por defecto.
5. Click en **"Deploy"**.
6. Espera 30-60 segundos. Cuando termine, Vercel te da una URL como `https://litocolor-erp.vercel.app`.
7. Abre esa URL. Deberías ver el dashboard cargando tus datos reales.

**A partir de ahora**: cada vez que subas un cambio a GitHub (a la rama `main`), Vercel va a publicar la nueva versión automáticamente. No tienes que repetir estos pasos.

---

## 5. Probar que todo funciona

- Abre la URL de Vercel en tu celular y en tu computador — ambos deben ver los mismos datos.
- Ve a la pestaña **Registrar**, llena el formulario con un registro de prueba y guarda.
- Refresca la página: el nuevo registro debe aparecer en la tabla "Últimos registros guardados" y los números de las otras pestañas deben actualizarse.
- Comparte la URL con tu equipo — cualquiera que la abra puede ver los dashboards y capturar producción.

---

## 6. Próximos pasos sugeridos (cuando quieras avanzar más)

Estos no son urgentes, pero son el camino natural a futuro:

1. **Restringir quién puede entrar**: hoy cualquiera con el link puede usar el aplicativo. Cuando quieras limitarlo a tu equipo, Supabase tiene un sistema de autenticación (Auth) por correo que se puede activar sin reescribir el aplicativo desde cero.
2. **Editar y borrar registros**: hoy el formulario solo permite crear registros nuevos (igual que el Google Form que usaban antes). Agregar edición es un paso natural una vez el equipo esté cómodo con lo básico.
3. **Catálogo de órdenes desde la app**: hoy las órdenes/pedidos se gestionan por SQL; se puede agregar una pantalla para crear órdenes nuevas directamente.
4. **Dominio propio**: en Vercel puedes conectar un dominio como `panel.litocolor.com` en vez de la URL `.vercel.app`.

Cuando quieras avanzar en cualquiera de estos, retoma esta conversación — la base ya está construida para crecer sobre ella.

---

## Estructura del proyecto

```
litocolor-erp/
├── index.html          → estructura de las 4 pestañas
├── styles.css           → diseño visual
├── app.js                → lógica: conecta a Supabase, calcula KPIs, dibuja gráficas
├── config.js             → tus credenciales de Supabase (edítalo en el paso 3)
├── supabase/
│   ├── schema.sql        → crea las tablas y la seguridad
│   └── seed.sql          → tus 1.200 registros de producción y 458 pedidos reales
└── README.md             → esta guía
```
