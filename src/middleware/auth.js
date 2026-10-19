const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { HttpError } = require('../errors');

const JWT_SECRET = process.env.JWT_SECRET || 'solo-para-desarrollo-cambiar-en-produccion';
// Access token de vida corta: limita el daño si se filtra y obliga a volver a autenticarse.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';

// Cada token lleva:
//   sub -> id del usuario
//   jti -> id único del token, para poder revocarlo en el logout
//   ver -> token_version del usuario, para invalidar todas sus sesiones a la vez
function firmarToken(usuario, opciones = {}) {
  return jwt.sign({ sub: String(usuario.id), ver: usuario.token_version }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: opciones.expiresIn ?? JWT_EXPIRES_IN,
    jwtid: crypto.randomUUID(),
  });
}

// Guard de autenticación. Valida firma, algoritmo y expiración del JWT, que no haya sido
// revocado y que la versión coincida. El rol se toma de la BD, no del token, para que un
// cambio de rol o una cuenta eliminada surtan efecto de inmediato.
function autenticar(db) {
  const buscar = db.prepare('SELECT id, nombre, correo, rol, token_version FROM usuarios WHERE id = ?');
  const revocado = db.prepare('SELECT 1 FROM tokens_revocados WHERE jti = ?');

  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const [tipo, token] = header.split(' ');
    if (tipo !== 'Bearer' || !token) {
      return next(new HttpError(401, 'Autenticación requerida', undefined, 'token_ausente'));
    }
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(new HttpError(401, 'La sesión ha expirado. Inicie sesión nuevamente', undefined, 'token_expirado'));
      }
      return next(new HttpError(401, 'Token inválido', undefined, 'token_invalido'));
    }
    if (revocado.get(payload.jti)) {
      return next(new HttpError(401, 'La sesión fue cerrada. Inicie sesión nuevamente', undefined, 'token_revocado'));
    }
    const usuario = buscar.get(Number(payload.sub));
    if (!usuario || usuario.token_version !== payload.ver) {
      return next(new HttpError(401, 'Token inválido', undefined, 'token_invalido'));
    }
    req.usuario = usuario;
    req.token = { jti: payload.jti, exp: payload.exp };
    next();
  };
}

// Guard de roles (RBAC): el usuario debe tener alguno de los roles indicados.
// La autorización por recurso (¿le pertenece?, ¿está abierto?) se hace en cada ruta.
function requiereRol(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.usuario.rol)) {
      return next(new HttpError(403, 'No tiene permiso para realizar esta operación'));
    }
    next();
  };
}

module.exports = { autenticar, requiereRol, firmarToken };
