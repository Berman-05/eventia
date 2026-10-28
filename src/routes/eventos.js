const express = require('express');
const { validar, idParam, HttpError } = require('../errors');
const schemas = require('../schemas');
const dto = require('../dto');
const { autenticar, requiereRol } = require('../middleware/auth');

module.exports = function rutasEventos(db) {
  const router = express.Router();
  const auth = autenticar(db);

  async function obtenerEvento(id, conexion = db) {
    const evento = await conexion.get('SELECT * FROM eventos WHERE id = ?', [id]);
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
  router.get('/', async (_req, res) => {
    res.json((await db.all('SELECT * FROM eventos ORDER BY fecha')).map(dto.evento));
  });

  // Eventos del organizador autenticado: la lista se filtra por el token, no por un parámetro.
  // Debe declararse antes de '/:id'.
  router.get('/mios', auth, requiereRol('organizador', 'administrador'), async (req, res) => {
    const filas = await db.all('SELECT * FROM eventos WHERE organizador_id = ? ORDER BY fecha', [req.usuario.id]);
    res.json(filas.map(dto.evento));
  });

  router.get('/:id', async (req, res) => {
    res.json(dto.evento(await obtenerEvento(idParam(req.params.id))));
  });

  // API 3: solo organizadores (o admin) y con datos validados.
  router.post('/', auth, requiereRol('organizador', 'administrador'), validar(schemas.crearEvento), async (req, res) => {
    const { titulo, descripcion, fecha, cupo, precio } = req.datos;
    // organizador_id se toma del token, nunca del cuerpo.
    const evento = await db.get(
      `INSERT INTO eventos (titulo, descripcion, fecha, cupo, disponibles, precio, organizador_id)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [titulo, descripcion ?? null, fecha, cupo, cupo, precio, req.usuario.id]
    );
    res.status(201).json(dto.evento(evento));
  });

  // API 4: además del rol, se comprueba que el evento le pertenezca.
  router.put('/:id', auth, requiereRol('organizador', 'administrador'), validar(schemas.modificarEvento), async (req, res) => {
    const evento = await obtenerEvento(idParam(req.params.id));
    verificarPropietario(evento, req.usuario);
    verificarAbierto(evento, 'El evento está cerrado y no admite cambios');

    const nuevo = { ...evento, ...req.datos };
    const ocupados = evento.cupo - evento.disponibles;
    if (nuevo.cupo < ocupados) {
      throw new HttpError(409, `El cupo no puede ser menor a los ${ocupados} lugares ya inscritos`);
    }
    // El cupo libre se recalcula en SQL con los valores actuales, por si hubo inscripciones entretanto.
    const actualizado = await db.get(
      `UPDATE eventos SET titulo = ?, descripcion = ?, fecha = ?, precio = ?,
         disponibles = ? - (cupo - disponibles), cupo = ?
       WHERE id = ? AND ? >= cupo - disponibles RETURNING *`,
      [nuevo.titulo, nuevo.descripcion, nuevo.fecha, nuevo.precio, nuevo.cupo, nuevo.cupo, evento.id, nuevo.cupo]
    );
    if (!actualizado) throw new HttpError(409, 'El cupo no puede ser menor a los lugares ya inscritos');
    res.json(dto.evento(actualizado));
  });

  // Cerrar un evento propio: a partir de ahí no admite cambios ni inscripciones.
  router.post('/:id/cerrar', auth, requiereRol('organizador', 'administrador'), async (req, res) => {
    const evento = await obtenerEvento(idParam(req.params.id));
    verificarPropietario(evento, req.usuario);
    verificarAbierto(evento, 'El evento ya está cerrado');
    const cerrado = await db.get("UPDATE eventos SET estado = 'cerrado' WHERE id = ? RETURNING *", [evento.id]);
    res.json(dto.evento(cerrado));
  });

  // API 5: máximo por usuario + descuento de cupos atómico dentro de una transacción.
  router.post('/:id/inscripciones', auth, requiereRol('usuario', 'organizador'), validar(schemas.inscripcion), async (req, res) => {
    const evento = await obtenerEvento(idParam(req.params.id));
    if (evento.organizador_id === req.usuario.id) {
      throw new HttpError(403, 'No puede inscribirse en su propio evento');
    }
    verificarAbierto(evento, 'El evento no admite inscripciones');
    const { cantidad } = req.datos;

    const inscripcion = await db.transaccion(async (tx) => {
      if (await tx.get('SELECT 1 AS si FROM inscripciones WHERE evento_id = ? AND usuario_id = ?', [evento.id, req.usuario.id])) {
        throw new HttpError(409, 'Ya tiene una inscripción en este evento');
      }
      // Descuento atómico: solo se aplica si todavía hay cupos suficientes y el evento sigue abierto.
      const { changes } = await tx.run(
        "UPDATE eventos SET disponibles = disponibles - ? WHERE id = ? AND disponibles >= ? AND estado = 'abierto'",
        [cantidad, evento.id, cantidad]
      );
      if (changes === 0) throw new HttpError(409, 'No hay cupos suficientes');
      return tx.get(
        'INSERT INTO inscripciones (evento_id, usuario_id, cantidad, creada_en) VALUES (?, ?, ?, ?) RETURNING *',
        [evento.id, req.usuario.id, cantidad, new Date().toISOString()]
      );
    });
    res.status(201).json(dto.inscripcion(inscripcion));
  });

  // Inscripciones de un evento: solo su organizador o un administrador.
  router.get('/:id/inscripciones', auth, requiereRol('organizador', 'administrador'), async (req, res) => {
    const evento = await obtenerEvento(idParam(req.params.id));
    verificarPropietario(evento, req.usuario);
    const filas = await db.all(
      `SELECT i.*, u.nombre, u.correo FROM inscripciones i
       JOIN usuarios u ON u.id = i.usuario_id WHERE i.evento_id = ? ORDER BY i.id`,
      [evento.id]
    );
    res.json(filas.map(dto.inscripcionOrganizador));
  });

  return router;
};
