const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { validar, HttpError } = require('../errors');
const schemas = require('../schemas');
const dto = require('../dto');
const { firmarToken } = require('../middleware/auth');

// Hash ficticio: si el correo no existe se compara igualmente, para que el tiempo de
// respuesta no revele si la cuenta existe.
const HASH_FICTICIO = bcrypt.hashSync('contraseña-que-nunca-coincide', 10);

module.exports = function rutasAuth(db, opciones = {}) {
  const router = express.Router();
  const buscar = db.prepare('SELECT * FROM usuarios WHERE correo = ?');

  // API 7: máximo N intentos fallidos por IP + correo en la ventana de tiempo.
  const limitarLogin = rateLimit({
    windowMs: opciones.loginVentanaMs ?? 15 * 60 * 1000,
    limit: opciones.loginMaxIntentos ?? 5,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) =>
      `${ipKeyGenerator(req.ip)}|${String(req.body?.correo ?? '').toLowerCase()}`,
    handler: (_req, res) =>
      res.status(429).json({ error: 'Demasiados intentos. Intente de nuevo más tarde.' }),
  });

  router.post('/login', limitarLogin, validar(schemas.login), async (req, res) => {
    const { correo, password } = req.datos;
    const usuario = buscar.get(correo);
    const ok = await bcrypt.compare(password, usuario ? usuario.password_hash : HASH_FICTICIO);
    if (!usuario || !ok) {
      // Mismo mensaje y mismo código para correo inexistente y contraseña incorrecta.
      throw new HttpError(401, 'Credenciales inválidas');
    }
    res.json({ token: firmarToken(usuario), usuario: dto.usuarioPublico(usuario) });
  });

  return router;
};
