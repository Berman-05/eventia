const jwt = require('jsonwebtoken');
const { HttpError } = require('../errors');

const JWT_SECRET = process.env.JWT_SECRET || 'solo-para-desarrollo-cambiar-en-produccion';
const JWT_EXPIRES_IN = '1h';

function firmarToken(usuario) {
  return jwt.sign({ sub: String(usuario.id) }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
  });
}

// Valida el JWT y carga el usuario desde la base de datos. El rol se toma de la BD,
// no del token, para que un cambio de rol o una cuenta eliminada surtan efecto de inmediato.
function autenticar(db) {
  const buscar = db.prepare('SELECT id, nombre, correo, rol FROM usuarios WHERE id = ?');
  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const [tipo, token] = header.split(' ');
    if (tipo !== 'Bearer' || !token) {
      return next(new HttpError(401, 'Autenticación requerida'));
    }
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return next(new HttpError(401, 'Token inválido o expirado'));
    }
    const usuario = buscar.get(Number(payload.sub));
    if (!usuario) return next(new HttpError(401, 'Token inválido o expirado'));
    req.usuario = usuario;
    next();
  };
}

// Autorización por función: el usuario debe tener alguno de los roles indicados.
// La autorización por objeto (¿el recurso le pertenece?) se hace en cada ruta.
function requiereRol(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.usuario.rol)) {
      return next(new HttpError(403, 'No tiene permiso para realizar esta operación'));
    }
    next();
  };
}

module.exports = { autenticar, requiereRol, firmarToken };
