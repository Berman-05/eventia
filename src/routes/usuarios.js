const express = require('express');
const bcrypt = require('bcryptjs');
const { validar, idParam, HttpError } = require('../errors');
const schemas = require('../schemas');
const dto = require('../dto');
const { autenticar, requiereRol } = require('../middleware/auth');

module.exports = function rutasUsuarios(db) {
  const router = express.Router();
  const auth = autenticar(db);

  const porId = (id) => db.get('SELECT * FROM usuarios WHERE id = ?', [id]);

  // API 2: registro público. El rol NO se acepta del cliente: siempre es "usuario".
  router.post('/', validar(schemas.registroUsuario), async (req, res) => {
    const { nombre, correo, password, telefono } = req.datos;
    if (await db.get('SELECT id FROM usuarios WHERE correo = ?', [correo])) {
      throw new HttpError(409, 'El correo ya está registrado');
    }
    const hash = await bcrypt.hash(password, 10);
    const usuario = await db.get(
      `INSERT INTO usuarios (nombre, correo, telefono, password_hash, rol)
       VALUES (?, ?, ?, ?, 'usuario') RETURNING *`,
      [nombre, correo, telefono ?? null, hash]
    );
    res.status(201).json(dto.usuarioPublico(usuario));
  });

  // API 6: solo el propio usuario o un administrador. Respuesta filtrada por DTO.
  router.get('/:id', auth, async (req, res) => {
    const id = idParam(req.params.id);
    const esAdmin = req.usuario.rol === 'administrador';
    if (!esAdmin && req.usuario.id !== id) {
      throw new HttpError(403, 'No tiene permiso para consultar este usuario');
    }
    const usuario = await porId(id);
    if (!usuario) throw new HttpError(404, 'Usuario no encontrado');
    res.json(esAdmin ? dto.usuarioAdmin(usuario) : dto.usuarioPublico(usuario));
  });

  // Control 2 (Act. 24): inscripciones privadas de un usuario. Solo él mismo o un administrador.
  router.get('/:id/inscripciones', auth, async (req, res) => {
    const id = idParam(req.params.id);
    if (req.usuario.rol !== 'administrador' && req.usuario.id !== id) {
      throw new HttpError(403, 'Solo puede consultar sus propias inscripciones');
    }
    if (!(await porId(id))) throw new HttpError(404, 'Usuario no encontrado');
    const filas = await db.all('SELECT * FROM inscripciones WHERE usuario_id = ? ORDER BY id', [id]);
    res.json(filas.map(dto.inscripcion));
  });

  // Administración de usuarios: exclusiva del administrador.
  router.get('/', auth, requiereRol('administrador'), async (_req, res) => {
    res.json((await db.all('SELECT * FROM usuarios ORDER BY id')).map(dto.usuarioAdmin));
  });

  router.patch('/:id/rol', auth, requiereRol('administrador'), validar(schemas.cambiarRol), async (req, res) => {
    const id = idParam(req.params.id);
    // Al cambiar el rol se invalidan las sesiones abiertas del usuario.
    const usuario = await db.get(
      'UPDATE usuarios SET rol = ?, token_version = token_version + 1 WHERE id = ? RETURNING *',
      [req.datos.rol, id]
    );
    if (!usuario) throw new HttpError(404, 'Usuario no encontrado');
    res.json(dto.usuarioAdmin(usuario));
  });

  return router;
};
