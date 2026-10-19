const express = require('express');
const { openDb } = require('./db');
const { manejadorErrores, HttpError } = require('./errors');

function crearApp({ dbPath, ...opciones } = {}) {
  const db = openDb(dbPath);
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.use('/api/auth', require('./routes/auth')(db, opciones));
  app.use('/api/usuarios', require('./routes/usuarios')(db));
  app.use('/api/eventos', require('./routes/eventos')(db));
  app.use('/api/inscripciones', require('./routes/inscripciones')(db));

  app.use((_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));
  app.use(manejadorErrores);

  return { app, db };
}

module.exports = { crearApp };
