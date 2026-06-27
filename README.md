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

## 3. Tus credenciales de Supabase — sin escribirlas en el código

A diferencia de lo que hicimos al principio, **ya no vas a pegar tus
credenciales dentro de ningún archivo que subas a GitHub**. En su lugar,
Vercel las va a guardar de forma privada y va a generar `config.js`
automáticamente cada vez que publique el sitio.

> Nota de seguridad: la llave "anon" de Supabase está diseñada para ser
> pública — vive en el navegador de cualquiera que abra la página, y lo que
> realmente protege tus datos es la configuración de seguridad (RLS) que ya
> quedó en `schema.sql`. Aun así, es buena práctica no dejarla escrita en
> texto plano dentro del repositorio, así que la guardamos en Vercel en vez
> de en GitHub.

No necesitas hacer nada en este paso todavía — vas a pegar tus credenciales
directamente en Vercel en el Paso 6. Solo ten a la mano el **Project URL**
y la llave **anon public** que copiaste en el paso 1.1.

---

## 4. Publicar el sitio en Vercel

1. Entra a **https://vercel.com** y crea una cuenta usando **"Continue with GitHub"**.
2. Click en **"Add New..."** → **"Project"**.
3. Busca y selecciona el repositorio `litocolor-erp` → click **"Import"**.
4. **Antes de darle Deploy**, despliega la sección **"Build and Output Settings"**:
   - **Framework Preset**: déjalo en "Other".
   - **Build Command**: activa el override (el switch) y escribe: `node build.js`
   - **Output Directory**: activa el override y escribe un solo punto: `.`
5. Despliega también la sección **"Environment Variables"** y agrega dos:
   - **Name**: `SUPABASE_URL` → **Value**: tu Project URL (ej. `https://nvczpuelhdgrnghxzked.supabase.co`)
   - **Name**: `SUPABASE_ANON_KEY` → **Value**: tu llave anon public
   - Click **"Add"** después de cada una.
6. Ahora sí, click en **"Deploy"**.
7. Espera 30-60 segundos. Vercel va a correr `build.js`, que genera `config.js` con tus credenciales por dentro — sin que jamás queden escritas en GitHub.
8. Cuando termine, te da una URL como `https://litocolor-erp.vercel.app`. Ábrela y confirma que el dashboard carga tus datos.

**A partir de ahora**: cada vez que subas un cambio a GitHub (rama `main`), Vercel repite este mismo proceso automáticamente — no tienes que volver a tocar el Build Command ni las variables de entorno, ya quedan guardadas en el proyecto.

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
├── index.html              → panel completo (Gerencial, Producción, Operario, Órdenes, Registrar, Maestros)
├── registro.html           → pantalla exclusiva para operarios (solo el reloj checador + órdenes vivas)
├── styles.css                → diseño visual, compartido por las dos páginas
├── js/                         → todo el código está dividido por responsabilidad:
│   ├── supabase-client.js        → conexión a Supabase (una sola vez)
│   ├── helpers.js                 → formato de números, mensajes, rangos de fecha
│   ├── store.js                    → carga de datos y el objeto DB compartido
│   ├── registrar.js                → el reloj checador (usado por index.html Y registro.html)
│   ├── ordenes.js                  → crear/buscar/editar/duplicar/cancelar órdenes + seguimiento
│   ├── maestros.js                 → alta/edición/retiro de empleados, máquinas, materias, clientes, proveedores
│   ├── dashboard.js                → Gerencial, Producción, Operario (con filtro de fechas)
│   ├── app.js                       → conecta todo lo anterior para index.html
│   └── registro-main.js             → conecta lo necesario para registro.html
├── build.js                  → genera config.js en cada despliegue de Vercel
├── config.example.js          → plantilla de referencia (sí se sube a GitHub)
├── config.js                    → credenciales reales — lo genera Vercel, NUNCA se sube
├── .gitignore                     → evita que config.js real se suba por accidente
├── assets/logo.png                 → logo de LitoColor
├── supabase/
│   ├── schema.sql                → tablas base y seguridad
│   ├── seed.sql                    → tu histórico real migrado
│   ├── opp_schema.sql               → tablas de Órdenes (OPP)
│   ├── ajustes_seguimiento.sql        → seguimiento por pieza
│   ├── ajustes_roles_maquina.sql        → roles reales + campo de máquina
│   ├── ajustes_v3_correcciones.sql        → corrección crítica de permisos + materias primas
│   ├── materias_primas_seed.sql             → catálogo de 226 materias primas
│   └── ajustes_v4_clientes_proveedores.sql    → Clientes, Proveedores, estado de órdenes, permisos de edición
└── README.md                  → esta guía
```
