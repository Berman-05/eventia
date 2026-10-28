const express = require('express');
const { idParam, HttpError } = require('../errors');
const dto = require('../dto');
const { autenticar } = require('../middleware/auth');

module.exports = function rutasInscripciones(db) {
  const router = express.Router();
  const auth = autenticar(db);

  router.get('/mias', auth, async (req, res) => {
    const filas = await db.all('SELECT * FROM inscripciones WHERE usuario_id = ? ORDER BY id', [req.usuario.id]);
    res.json(filas.map(dto.inscripcion));
  });

  // API 1: se verifica que la inscripción pertenezca al solicitante (BOLA).
  router.get('/:id', auth, async (req, res) => {
    const insc = await db.get(
      `SELECT i.*, u.nombre, u.correo, e.organizador_id FROM inscripciones i
       JOIN usuarios u ON u.id = i.usuario_id
       JOIN eventos e ON e.id = i.evento_id
       WHERE i.id = ?`,
      [idParam(req.params.id)]
    );
    const u = req.usuario;
    const esDueno = insc && insc.usuario_id === u.id;
    const esOrganizadorDelEvento = insc && insc.organizador_id === u.id;
    const esAdmin = u.rol === 'administrador';

    // Para quien no tiene acceso se responde 404 igual que si no existiera,
    // así no se puede enumerar qué IDs de inscripción son válidos.
    if (!insc || !(esDueno || esOrganizadorDelEvento || esAdmin)) {
      throw new HttpError(404, 'Inscripción no encontrada');
    }
    res.json(esDueno ? dto.inscripcion(insc) : dto.inscripcionOrganizador(insc));
  });

  return router;
};
