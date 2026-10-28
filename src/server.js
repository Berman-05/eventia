const { crearApp } = require('./app');

// Configuración por variables de entorno (ver .env.example).
const PORT = Number(process.env.PORT) || 3005;
const DATABASE_URL = process.env.DATABASE_URL;
const enProduccion = process.env.NODE_ENV === 'production';

if (enProduccion && !process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET: no se puede iniciar en producción con el secreto de desarrollo.');
  process.exit(1);
}

async function iniciar() {
  const { app, db } = await crearApp({
    databaseUrl: DATABASE_URL,
    dbPath: process.env.DB_PATH || 'eventia.db',
    trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : undefined,
  });

  const servidor = app.listen(PORT, () => {
    console.log(`Eventia escuchando en el puerto ${PORT} (base de datos: ${db.dialecto})`);
  });

  // Cierre ordenado: Docker y las plataformas envían SIGTERM al detener el servicio.
  const apagar = () => {
    servidor.close(async () => {
      await db.cerrar();
      process.exit(0);
    });
  };
  process.on('SIGTERM', apagar);
  process.on('SIGINT', apagar);
}

iniciar().catch((err) => {
  console.error('No se pudo iniciar Eventia:', err.message);
  process.exit(1);
});
