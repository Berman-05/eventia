const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { validar, HttpError } = require('../errors');
const schemas = require('../schemas');
const dto = require('../dto');
const { firmarToken, autenticar } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

// Hash ficticio: si el correo no existe se compara igualmente, para que el tiempo de
// respuesta no revele si la cuenta existe.
const HASH_FICTICIO = bcrypt.hashSync('contraseña-que-nunca-coincide', 10);

module.exports = function rutasAuth(db, opciones = {}) {
  const router = express.Router();
  const buscar = db.prepare('SELECT * FROM usuarios WHERE correo = ?');
  const revocar = db.prepare('INSERT OR IGNORE INTO tokens_revocados (jti, expira_en) VALUES (?, ?)');
  const subirVersion = db.prepare('UPDATE usuarios SET token_version = token_version + 1 WHERE id = ?');
  const auth = autenticar(db);

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
    const token = firmarToken(usuario);
    const { exp } = jwt.decode(token);
    res.json({
      token,
      tipo: 'Bearer',
      expiraEn: new Date(exp * 1000).toISOString(),
      usuario: dto.usuarioAdmin(usuario),
    });
  });

  // Ruta protegida mínima: devuelve el usuario dueño del token.
  router.get('/me', auth, (req, res) => res.json(dto.usuarioAdmin(req.usuario)));

  // Cierre de sesión: revoca este token (por su jti) hasta que habría expirado.
  router.post('/logout', auth, (req, res) => {
    revocar.run(req.token.jti, req.token.exp);
    res.status(204).end();
  });

  // Cierra todas las sesiones del usuario (p. ej. tras cambiar contraseña o robo de dispositivo).
  router.post('/logout-todas', auth, (req, res) => {
    subirVersion.run(req.usuario.id);
    res.status(204).end();
  });

  return router;
};
