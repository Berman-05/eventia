// DTOs de salida: lista blanca de campos que se devuelven al cliente.
// Nunca se serializa directamente la fila de la base de datos (evita exponer password_hash, etc.).

const usuarioPublico = (u) => ({ id: u.id, nombre: u.nombre, correo: u.correo });

const usuarioAdmin = (u) => ({ ...usuarioPublico(u), rol: u.rol });

const evento = (e) => ({
  id: e.id,
  titulo: e.titulo,
  descripcion: e.descripcion,
  fecha: e.fecha,
  cupo: e.cupo,
  disponibles: e.disponibles,
  precio: e.precio,
  organizadorId: e.organizador_id,
});

const inscripcion = (i) => ({
  id: i.id,
  eventoId: i.evento_id,
  cantidad: i.cantidad,
  creadaEn: i.creada_en,
});

// Vista para el organizador del evento: incluye a quién pertenece la inscripción.
const inscripcionOrganizador = (i) => ({
  ...inscripcion(i),
  participante: { id: i.usuario_id, nombre: i.nombre, correo: i.correo },
});

module.exports = { usuarioPublico, usuarioAdmin, evento, inscripcion, inscripcionOrganizador };
