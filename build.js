// Este script lo corre Vercel automáticamente cada vez que despliega el sitio.
// Toma las variables de entorno configuradas en Vercel (Settings > Environment
// Variables) y genera config.js con esos valores — así config.js nunca tiene
// que llevar tus credenciales escritas a mano, ni quedar guardado en GitHub.

const fs = require('fs');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Faltan las variables de entorno SUPABASE_URL y/o SUPABASE_ANON_KEY.');
  console.error('Configúralas en Vercel: Settings > Environment Variables.');
  process.exit(1);
}

const content =
  '// Generado automáticamente durante el despliegue en Vercel. No editar a mano.\n' +
  'const SUPABASE_URL = ' + JSON.stringify(url) + ';\n' +
  'const SUPABASE_ANON_KEY = ' + JSON.stringify(key) + ';\n';

fs.writeFileSync('config.js', content);
console.log('config.js generado correctamente a partir de las variables de entorno.');
