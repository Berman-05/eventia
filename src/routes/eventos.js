const express = require('express');
const { validar, idParam, HttpError } = require('../errors');
const schemas = require('../schemas');
const dto = require('../dto');
const { autenticar, requiereRol } = require('../middleware/auth');

module.exports = function rutasEventos(db) {
  const router = express.Router();
  const auth = autenticar(db);

  const listar = db.prepare('SELECT * FROM eventos ORDER BY fecha');
  const listarDe = db.prepare('SELECT * FROM eventos WHERE organizador_id = ? ORDER BY fecha');
  const cerrar = db.prepare("UPDATE eventos SET estado = 'cerrado' WHERE id = ?");
  const porId = db.prepare('SELECT * FROM eventos WHERE id = ?');
  const insertar = db.prepare(
    `INSERT INTO eventos (titulo, descripcion, fecha, cupo, disponibles, precio, organizador_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const actualizar = db.prepare(
    `UPDATE eventos SET titulo = ?, descripcion = ?, fecha = ?, cupo = ?, disponibles = ?, precio = ?
     WHERE id = ?`
  );
  const yaInscrito = db.prepare('SELECT 1 FROM inscripciones WHERE evento_id = ? AND usuario_id = ?');
  // Descuento atómico: solo se aplica si todavía hay cupos suficientes.
  const descontarCupos = db.prepare(
    'UPDATE eventos SET disponibles = disponibles - ? WHERE id = ? AND disponibles >= ?'
  );
  const insertarInscripcion = db.prepare(
    'INSERT INTO inscripciones (evento_id, usuario_id, cantidad) VALUES (?, ?, ?)'
  );
  const inscripcionPorId = db.prepare('SELECT * FROM inscripciones WHERE id = ?');
  const inscripcionesDeEvento = db.prepare(
    `SELECT i.*, u.nombre, u.correo FROM inscripciones i
     JOIN usuarios u ON u.id = i.usuario_id WHERE i.evento_id = ? ORDER BY i.id`
  );

  function obtenerEvento(id) {
    const evento = porId.get(id);
    if (!evento) throw new HttpError(404, 'Evento no encontrado');
    return evento;
  }

  // Autorización a nivel de objeto: el evento debe pertenecer al organizador (o ser admin).
  function verificarPropietario(evento, usuario) {
    if (usuario.rol !== 'administrador' && evento.organizador_id !== usuario.id) {
      throw new HttpError(403, 'El evento no le pertenece');
    }
  }

  // Un evento cerrado ya no admite cambios ni inscripciones (control basado en atributos).
  function verificarAbierto(evento, mensaje) {
    if (evento.estado !== 'abierto') throw new HttpError(409, mensaje, undefined, 'evento_cerrado');
  }

  // Consulta pública.
  router.get('/', (_req, res) => res.json(listar.all().map(dto.evento)));

  // Eventos del organizador autenticado: la lista se filtra por el token, no por un parámetro.
  // Debe declararse antes de '/:id'.
  router.get('/mios', auth, requiereRol('organizador', 'administrador'), (req, res) => {
    res.json(listarDe.all(req.usuario.id).map(dto.evento));
  });

  router.get('/:id', (req, res) => res.json(dto.evento(obtenerEvento(idParam(req.params.id)))));

  // API 3: solo organizadores (o admin) y con datos validados.
  router.post('/', auth, requiereRol('organizador', 'administrador'), validar(schemas.crearEvento), (req, res) => {
    const { titulo, descripcion, fecha, cupo, precio } = req.datos;
    // organizador_id se toma del token, nunca del cuerpo.
    const { lastInsertRowid } = insertar.run(
      titulo, descripcion ?? null, fecha, cupo, cupo, precio, req.usuario.id
    );
    res.status(201).json(dto.evento(porId.get(Number(lastInsertRowid))));
  });

  // API 4: además del rol, se comprueba que el evento le pertenezca.
  router.put('/:id', auth, requiereRol('organizador', 'administrador'), validar(schemas.modificarEvento), (req, res) => {
    const evento = obtenerEvento(idParam(req.params.id));
    verificarPropietario(evento, req.usuario);
    verificarAbierto(evento, 'El evento está cerrado y no admite cambios');

    const nuevo = { ...evento, ...req.datos };
    const ocupados = evento.cupo - evento.disponibles;
    if (nuevo.cupo < ocupados) {
      throw new HttpError(409, `El cupo no puede ser menor a los ${ocupados} lugares ya inscritos`);
    }
    actualizar.run(
      nuevo.titulo, nuevo.descripcion, nuevo.fecha, nuevo.cupo, nuevo.cupo - ocupados, nuevo.precio, evento.id
    );
    res.json(dto.evento(porId.get(evento.id)));
  });

  // Cerrar un evento propio: a partir de ahí no admite cambios ni inscripciones.
  router.post('/:id/cerrar', auth, requiereRol('organizador', 'administrador'), (req, res) => {
    const evento = obtenerEvento(idParam(req.params.id));
    verificarPropietario(evento, req.usuario);
    verificarAbierto(evento, 'El evento ya está cerrado');
    cerrar.run(evento.id);
    res.json(dto.evento(porId.get(evento.id)));
  });

  // API 5: máximo por usuario + descuento de cupos atómico dentro de una transacción.
  router.post('/:id/inscripciones', auth, requiereRol('usuario', 'organizador'), validar(schemas.inscripcion), (req, res) => {
    const evento = obtenerEvento(idParam(req.params.id));
    if (evento.organizador_id === req.usuario.id) {
      throw new HttpError(403, 'No puede inscribirse en su propio evento');
    }
    verificarAbierto(evento, 'El evento no admite inscripciones');
    const { cantidad } = req.datos;

    db.exec('BEGIN IMMEDIATE');
    try {
      if (yaInscrito.get(evento.id, req.usuario.id)) {
        throw new HttpError(409, 'Ya tiene una inscripción en este evento');
      }
      const { changes } = descontarCupos.run(cantidad, evento.id, cantidad);
      if (changes === 0) throw new HttpError(409, 'No hay cupos suficientes');
      const { lastInsertRowid } = insertarInscripcion.run(evento.id, req.usuario.id, cantidad);
      db.exec('COMMIT');
      res.status(201).json(dto.inscripcion(inscripcionPorId.get(Number(lastInsertRowid))));
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  // Inscripciones de un evento: solo su organizador o un administrador.
  router.get('/:id/inscripciones', auth, requiereRol('organizador', 'administrador'), (req, res) => {
    const evento = obtenerEvento(idParam(req.params.id));
    verificarPropietario(evento, req.usuario);
    res.json(inscripcionesDeEvento.all(evento.id).map(dto.inscripcionOrganizador));
  });

  return router;
};
