const path = require('node:path');
const express = require('express');
const { abrirDb } = require('./db');
const { manejadorErrores, HttpError } = require('./errors');

/**
 * Crea la aplicación Express conectada a la base de datos.
 * @param {object} opciones databaseUrl / dbPath / reiniciar (ver abrirDb), trustProxy y
 *   los parámetros del limitador de login.
 */
async function crearApp({ databaseUrl, dbPath, reiniciar, trustProxy, ...opciones } = {}) {
  const db = await abrirDb({ databaseUrl, dbPath, reiniciar });
  const app = express();

  app.disable('x-powered-by');
  // Detrás del proxy de la plataforma (Render) la IP real llega en X-Forwarded-For;
  // sin esto el límite de intentos de login trataría a todos los clientes como uno solo.
  if (trustProxy) app.set('trust proxy', trustProxy);
  app.use(express.json({ limit: '10kb' }));

  // Frontend (HTML/CSS/JS estático). Toda la seguridad sigue estando en la API.
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Índice de la API: informa qué rutas existen.
  const indice = (_req, res) =>
    res.json({
      nombre: 'Eventia API',
      estado: 'en línea',
      documentacion: 'docs/openapi.yaml',
      endpoints: {
        publicos: ['GET /api/eventos', 'GET /api/eventos/:id', 'POST /api/usuarios', 'POST /api/auth/login'],
        autenticados: [
          'GET /api/auth/me',
          'POST /api/auth/logout',
          'POST /api/auth/logout-todas',
          'GET /api/usuarios/:id',
          'GET /api/usuarios/:id/inscripciones',
          'GET /api/inscripciones/mias',
          'GET /api/inscripciones/:id',
          'POST /api/eventos/:id/inscripciones',
        ],
        organizador: [
          'GET /api/eventos/mios',
          'POST /api/eventos',
          'PUT /api/eventos/:id',
          'POST /api/eventos/:id/cerrar',
          'GET /api/eventos/:id/inscripciones',
        ],
        administrador: ['GET /api/usuarios', 'PATCH /api/usuarios/:id/rol'],
      },
    });
  app.get('/api', indice);

  // Estado del servicio: lo usan la plataforma de despliegue y el HEALTHCHECK de Docker.
  app.get('/api/salud', async (_req, res) => {
    try {
      await db.get('SELECT 1 AS ok');
      res.json({ estado: 'ok', baseDeDatos: db.dialecto });
    } catch {
      res.status(503).json({ estado: 'sin conexión a la base de datos' });
    }
  });

  app.use('/api/auth', require('./routes/auth')(db, opciones));
  app.use('/api/usuarios', require('./routes/usuarios')(db));
  app.use('/api/eventos', require('./routes/eventos')(db));
  app.use('/api/inscripciones', require('./routes/inscripciones')(db));

  app.use((_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));
  app.use(manejadorErrores);

  return { app, db };
}

module.exports = { crearApp };
