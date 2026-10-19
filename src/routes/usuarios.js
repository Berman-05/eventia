const express = require('express');
const bcrypt = require('bcryptjs');
const { validar, idParam, HttpError } = require('../errors');
const schemas = require('../schemas');
const dto = require('../dto');
const { autenticar, requiereRol } = require('../middleware/auth');

module.exports = function rutasUsuarios(db) {
  const router = express.Router();
  const auth = autenticar(db);

  const porCorreo = db.prepare('SELECT id FROM usuarios WHERE correo = ?');
  const insertar = db.prepare(
    `INSERT INTO usuarios (nombre, correo, telefono, password_hash, rol)
     VALUES (?, ?, ?, ?, 'usuario')`
  );
  const porId = db.prepare('SELECT * FROM usuarios WHERE id = ?');
  const actualizarRol = db.prepare('UPDATE usuarios SET rol = ? WHERE id = ?');
  const listar = db.prepare('SELECT * FROM usuarios ORDER BY id');

  // API 2: registro público. El rol NO se acepta del cliente: siempre es "usuario".
  router.post('/', validar(schemas.registroUsuario), async (req, res) => {
    const { nombre, correo, password, telefono } = req.datos;
    if (porCorreo.get(correo)) throw new HttpError(409, 'El correo ya está registrado');
    const hash = await bcrypt.hash(password, 10);
    const { lastInsertRowid } = insertar.run(nombre, correo, telefono ?? null, hash);
    res.status(201).json(dto.usuarioPublico(porId.get(Number(lastInsertRowid))));
  });

  // API 6: solo el propio usuario o un administrador. Respuesta filtrada por DTO.
  router.get('/:id', auth, (req, res) => {
    const id = idParam(req.params.id);
    const esAdmin = req.usuario.rol === 'administrador';
    if (!esAdmin && req.usuario.id !== id) {
      throw new HttpError(403, 'No tiene permiso para consultar este usuario');
    }
    const usuario = porId.get(id);
    if (!usuario) throw new HttpError(404, 'Usuario no encontrado');
    res.json(esAdmin ? dto.usuarioAdmin(usuario) : dto.usuarioPublico(usuario));
  });

  // Administración de usuarios: exclusiva del administrador.
  router.get('/', auth, requiereRol('administrador'), (_req, res) => {
    res.json(listar.all().map(dto.usuarioAdmin));
  });

  router.patch('/:id/rol', auth, requiereRol('administrador'), validar(schemas.cambiarRol), (req, res) => {
    const id = idParam(req.params.id);
    if (!porId.get(id)) throw new HttpError(404, 'Usuario no encontrado');
    actualizarRol.run(req.datos.rol, id);
    res.json(dto.usuarioAdmin(porId.get(id)));
  });

  return router;
};
