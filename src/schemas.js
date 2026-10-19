const { z } = require('zod');

// Todos los esquemas son estrictos: cualquier propiedad no declarada (p. ej. "rol",
// "organizador_id", "disponibles") provoca 400 en lugar de guardarse (mass assignment).

const MAX_POR_USUARIO = 4;

const registroUsuario = z.strictObject({
  nombre: z.string().trim().min(2).max(80),
  correo: z.email().max(120).transform((c) => c.toLowerCase()),
  password: z.string().min(8).max(72),
  telefono: z.string().regex(/^[0-9]{8}$/, 'Debe tener 8 dígitos').optional(),
});

const login = z.strictObject({
  correo: z.email().max(120).transform((c) => c.toLowerCase()),
  password: z.string().min(1).max(72),
});

const fechaFutura = z.iso
  .datetime()
  .refine((f) => new Date(f) > new Date(), 'La fecha debe ser futura');

const crearEvento = z.strictObject({
  titulo: z.string().trim().min(3).max(120),
  descripcion: z.string().trim().max(1000).optional(),
  fecha: fechaFutura,
  cupo: z.number().int().positive().max(10000),
  precio: z.number().nonnegative().max(100000),
});

const modificarEvento = crearEvento
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Debe enviar al menos un campo');

const inscripcion = z.strictObject({
  cantidad: z.number().int().positive().max(MAX_POR_USUARIO, `Máximo ${MAX_POR_USUARIO} por usuario`),
});

const cambiarRol = z.strictObject({
  rol: z.enum(['usuario', 'organizador', 'administrador']),
});

module.exports = {
  MAX_POR_USUARIO,
  registroUsuario,
  login,
  crearEvento,
  modificarEvento,
  inscripcion,
  cambiarRol,
};
