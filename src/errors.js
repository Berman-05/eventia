class HttpError extends Error {
  constructor(status, mensaje, detalles, codigo) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
    this.codigo = codigo;
  }
}

// Valida req.body (o la parte indicada) contra un esquema zod estricto.
function validar(esquema, origen = 'body') {
  return (req, _res, next) => {
    const r = esquema.safeParse(req[origen] ?? {});
    if (!r.success) {
      const detalles = r.error.issues.map((i) => ({
        campo: i.path.join('.') || (i.keys ? i.keys.join(', ') : ''),
        mensaje: i.message,
      }));
      return next(new HttpError(400, 'Datos inválidos', detalles));
    }
    req.datos = r.data;
    next();
  };
}

function idParam(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Identificador inválido');
  return id;
}

function manejadorErrores(err, _req, res, _next) {
  if (err instanceof HttpError) {
    const cuerpo = { error: err.message };
    if (err.codigo) cuerpo.codigo = err.codigo;
    if (err.detalles) cuerpo.detalles = err.detalles;
    if (err.status === 401) {
      // RFC 6750: indica al cliente el esquema esperado y el motivo del rechazo.
      const motivo = err.codigo === 'token_ausente' ? '' : `, error="invalid_token"`;
      res.set('WWW-Authenticate', `Bearer realm="eventia"${motivo}`);
    }
    return res.status(err.status).json(cuerpo);
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON mal formado' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Solicitud demasiado grande' });
  }
  console.error(err);
  // No se exponen trazas ni mensajes internos al cliente.
  res.status(500).json({ error: 'Error interno del servidor' });
}

module.exports = { HttpError, validar, idParam, manejadorErrores };
