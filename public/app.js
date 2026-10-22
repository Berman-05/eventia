'use strict';

/* ==========================================================================
   Eventia — frontend
   La interfaz oculta acciones según el rol, pero NO es un control de seguridad:
   todas las reglas las aplica la API. El "modo laboratorio" muestra los botones
   no permitidos para comprobar que el backend los rechaza.
   ========================================================================== */

const API = '/api';
const DEMO_PASSWORD = 'Eventia2026!';
const DEMO_USERS = [
  { correo: 'carlos@eventia.test', nombre: 'Carlos', rol: 'usuario' },
  { correo: 'ana@eventia.test', nombre: 'Ana', rol: 'usuario' },
  { correo: 'olga@eventia.test', nombre: 'Olga Organiza', rol: 'organizador' },
  { correo: 'oscar@eventia.test', nombre: 'Oscar Organiza', rol: 'organizador' },
  { correo: 'admin@eventia.test', nombre: 'Admin', rol: 'administrador' },
];

const PALETAS = [
  ['#0ea5e9', '#6366f1'],
  ['#14b8a6', '#0e7490'],
  ['#f43f5e', '#f59e0b'],
  ['#8b5cf6', '#ec4899'],
  ['#22c55e', '#0d9488'],
  ['#f97316', '#db2777'],
];

// El token se guarda solo en memoria (no en localStorage) para reducir el impacto de un XSS.
const estado = {
  token: null,
  usuario: null,
  iat: 0,
  exp: 0,
  eventos: [],
  mias: [],
  filtro: 'todos',
  busqueda: '',
  modoLab: false,
  cantidades: {},
};

/* ---------- Utilidades DOM ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// Crea elementos de forma segura (textContent, nunca innerHTML con datos de la API).
function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // solo para íconos SVG estáticos
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const hijo of hijos.flat()) {
    if (hijo == null || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return el;
}

const ICONOS = {
  fecha: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  hora: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  personas: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></svg>',
  id: '<svg viewBox="0 0 24 24"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg>',
};
const icono = (n) => h('span', { html: ICONOS[n] });

const iniciales = (nombre = '') =>
  nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';

const fmtFecha = (iso, opts) => new Intl.DateTimeFormat('es-GT', opts).format(new Date(iso));
const fmtPrecio = (p) => (p === 0 ? 'Gratis' : `Q${Number(p).toLocaleString('es-GT', { minimumFractionDigits: 0 })}`);
const paleta = (id) => PALETAS[(id - 1) % PALETAS.length];
const rolLegible = { usuario: 'Usuario registrado', organizador: 'Organizador', administrador: 'Administrador' };

function toast(msg, tipo = 'info') {
  const t = h('div', { class: `toast toast--${tipo}` }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}

function decodificarJwt(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(p))));
  } catch {
    return {};
  }
}

/* ---------- Cliente API + consola ---------- */
const TEXTO_ESTADO = {
  200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized',
  403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 429: 'Too Many Requests', 500: 'Error',
};

function registrar(metodo, ruta, status, data, etiqueta) {
  let msg;
  if (status === 204) msg = 'Sin contenido (operación correcta)';
  else if (data && data.error) msg = data.error + (data.codigo ? ` · ${data.codigo}` : '');
  else if (Array.isArray(data)) msg = `${data.length} registro(s)`;
  else if (data && data.titulo) msg = `Evento “${data.titulo}”`;
  else if (data && data.token) msg = 'Token emitido';
  else if (data && data.eventoId) msg = `Inscripción #${data.id} · ${data.cantidad} lugar(es)`;
  else if (data && data.nombre) msg = `${data.nombre} (${data.correo})`;
  else msg = 'Respuesta recibida';
  if (data && data.detalles) msg += ' — ' + data.detalles.map((d) => `${d.campo}: ${d.mensaje}`).join('; ');

  const li = h('li', { class: 'log' },
    h('div', { class: 'log__top' },
      h('span', { class: `status status--${String(status)[0]}` }, `HTTP ${status}`),
      h('span', { class: 'method' }, metodo),
      h('span', { class: 'log__path', title: ruta }, ruta)),
    h('div', { class: 'log__msg' }, etiqueta ? `${etiqueta} → ${msg}` : msg));
  const consola = $('#consola');
  consola.prepend(li);
  while (consola.children.length > 30) consola.lastChild.remove();
}

/**
 * Llama a la API. Por defecto usa el token de la sesión; `token: null` fuerza una
 * petición sin autenticación y `token: '...'` usa uno concreto (laboratorio).
 */
async function api(metodo, ruta, { body, token, etiqueta } = {}) {
  const usado = token === undefined ? estado.token : token;
  const headers = { 'Content-Type': 'application/json' };
  if (usado) headers.Authorization = `Bearer ${usado}`;
  let status = 0;
  let data = null;
  try {
    const res = await fetch(API + ruta, { method: metodo, headers, body: body ? JSON.stringify(body) : undefined });
    status = res.status;
    const texto = await res.text();
    data = texto ? JSON.parse(texto) : null;
  } catch {
    status = 0;
    data = { error: 'No se pudo conectar con el servidor' };
  }
  registrar(metodo, API + ruta, status || 'ERR', data, etiqueta);

  // Si la credencial de la sesión dejó de ser válida, se cierra la sesión local.
  if (status === 401 && token === undefined && estado.token && data && data.codigo) {
    finSesion(data.codigo === 'token_expirado' ? 'Tu sesión expiró. Inicia sesión de nuevo.' : 'Tu sesión ya no es válida. Inicia sesión de nuevo.');
  }
  return { status, data, ok: status >= 200 && status < 300 };
}

/* ---------- Sesión ---------- */
async function iniciarSesion(correo, password) {
  const r = await api('POST', '/auth/login', { body: { correo, password }, token: null });
  if (!r.ok) {
    toast(r.data?.error || 'No se pudo iniciar sesión', 'error');
    return false;
  }
  const payload = decodificarJwt(r.data.token);
  Object.assign(estado, { token: r.data.token, usuario: r.data.usuario, iat: payload.iat, exp: payload.exp });
  toast(`Hola, ${r.data.usuario.nombre}`, 'ok');
  await refrescarTodo();
  return true;
}

function finSesion(mensaje) {
  Object.assign(estado, { token: null, usuario: null, iat: 0, exp: 0, mias: [] });
  if (mensaje) toast(mensaje, 'info');
  pintarSesion();
  pintarEventos();
  pintarLab();
  activarTab('eventos');
}

async function cerrarSesion(todas = false) {
  await api('POST', todas ? '/auth/logout-todas' : '/auth/logout');
  finSesion(todas ? 'Se cerraron todas tus sesiones.' : 'Sesión cerrada.');
}

let reloj = null;
function pintarSesion() {
  const u = estado.usuario;
  $('#panel-login').hidden = !!u;
  $('#panel-perfil').hidden = !u;
  $('#chip-sesion').hidden = !u;

  $$('.tab[data-requiere]').forEach((t) => {
    const req = t.dataset.requiere;
    t.hidden = !u || (req === 'organizador' && !['organizador', 'administrador'].includes(u.rol))
      || (req === 'administrador' && u.rol !== 'administrador');
  });

  clearInterval(reloj);
  if (!u) return;
  $('#perfil-avatar').textContent = iniciales(u.nombre);
  $('#chip-avatar').textContent = iniciales(u.nombre);
  $('#perfil-nombre').textContent = u.nombre;
  $('#chip-nombre').textContent = u.nombre;
  $('#perfil-correo').textContent = u.correo;
  $('#chip-rol').textContent = rolLegible[u.rol];
  const badge = $('#perfil-rol');
  badge.textContent = rolLegible[u.rol];
  badge.className = `role-badge rol-${u.rol}`;
  $('#token-expira').textContent = fmtFecha(estado.exp * 1000, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const tick = () => {
    const total = estado.exp - estado.iat;
    const restante = Math.max(0, estado.exp - Math.floor(Date.now() / 1000));
    const mm = String(Math.floor(restante / 60)).padStart(2, '0');
    const ss = String(restante % 60).padStart(2, '0');
    $('#token-restante').textContent = restante ? `${mm}:${ss}` : 'Expirado';
    $('#token-barra').style.width = `${(restante / total) * 100}%`;
    $('.token-box').classList.toggle('is-warn', restante < 120);
  };
  tick();
  reloj = setInterval(tick, 1000);
}

/* ---------- Datos ---------- */
async function cargarEventos() {
  const r = await api('GET', '/eventos', { token: null });
  if (r.ok) estado.eventos = r.data;
}

async function cargarMias() {
  if (!estado.usuario) return (estado.mias = []);
  const r = await api('GET', `/usuarios/${estado.usuario.id}/inscripciones`);
  estado.mias = r.ok ? r.data : [];
}

async function refrescarTodo() {
  await cargarEventos();
  await cargarMias();
  pintarSesion();
  pintarStats();
  pintarEventos();
  pintarInscripciones();
  pintarLab();
}

function pintarStats() {
  const abiertos = estado.eventos.filter((e) => e.estado === 'abierto');
  $('#stat-abiertos').textContent = abiertos.length;
  $('#stat-cupos').textContent = abiertos.reduce((s, e) => s + e.disponibles, 0).toLocaleString('es-GT');
  $('#stat-mias').textContent = estado.usuario ? estado.mias.length : '–';
}

/* ---------- Tarjetas de evento ---------- */
function permisos(e) {
  const u = estado.usuario;
  const esAdmin = u?.rol === 'administrador';
  const esDueno = !!u && e.organizadorId === u.id;
  const abierto = e.estado === 'abierto';
  const inscrito = estado.mias.some((i) => i.eventoId === e.id);
  return {
    esDueno,
    inscrito,
    inscribirse: !!u && ['usuario', 'organizador'].includes(u.rol) && !esDueno && abierto && !inscrito,
    gestionar: esDueno || esAdmin,
    editar: (esDueno || esAdmin) && abierto,
  };
}

function tarjetaEvento(e) {
  const p = permisos(e);
  const [c1, c2] = paleta(e.id);
  const fecha = new Date(e.fecha);
  const ocupados = e.cupo - e.disponibles;
  const porcentaje = Math.round((ocupados / e.cupo) * 100);
  const lab = estado.modoLab;

  const cover = h('div', {
    class: `event__cover${e.estado === 'cerrado' ? ' is-closed' : ''}`,
    style: `background: linear-gradient(135deg, ${c1}, ${c2});`,
  },
    h('span', { class: 'event__glyph' }, e.titulo.trim()[0] || 'E'),
    h('div', { class: 'cover-top' },
      h('div', { class: 'date-badge' },
        h('strong', {}, fmtFecha(fecha, { day: '2-digit' })),
        h('span', {}, fmtFecha(fecha, { month: 'short' }).replace('.', ''))),
      h('div', { class: 'badges' },
        h('span', { class: `badge ${e.estado === 'abierto' ? 'badge--open' : 'badge--closed'}` }, e.estado === 'abierto' ? '● Abierto' : 'Cerrado'),
        p.esDueno && h('span', { class: 'badge badge--mine' }, 'Tu evento'),
        p.inscrito && h('span', { class: 'badge badge--inscrito' }, '✓ Inscrito'))),
    h('span', { class: 'event__price' }, fmtPrecio(e.precio)));

  const acciones = h('div', { class: 'event__actions' });

  // Inscripción
  if (p.inscribirse || lab) {
    const cant = estado.cantidades[e.id] || 1;
    const valor = h('span', {}, cant);
    const cambiar = (d) => {
      const n = Math.min(4, Math.max(1, (estado.cantidades[e.id] || 1) + d));
      estado.cantidades[e.id] = n;
      valor.textContent = n;
    };
    acciones.append(
      h('div', { class: 'qty' },
        h('button', { type: 'button', onclick: () => cambiar(-1), 'aria-label': 'Menos' }, '−'),
        valor,
        h('button', { type: 'button', onclick: () => cambiar(1), 'aria-label': 'Más' }, '+')),
      h('button', {
        class: `btn ${p.inscribirse ? 'btn--primary' : 'btn--warn'}`,
        onclick: () => inscribirse(e),
        title: p.inscribirse ? '' : 'No te corresponde: el backend debe rechazarlo',
      }, p.inscribirse ? 'Inscribirme' : 'Inscribirme (prueba)'));
  }

  // Gestión del organizador
  if (p.editar || lab) {
    acciones.append(h('button', { class: `btn btn--sm ${p.editar ? 'btn--soft' : 'btn--warn'}`, onclick: () => abrirFormEvento(e) }, p.editar ? 'Editar' : 'Editar (prueba)'));
  }
  if (p.gestionar || lab) {
    acciones.append(h('button', { class: `btn btn--sm ${p.gestionar ? 'btn--ghost' : 'btn--warn'}`, onclick: () => verParticipantes(e) }, 'Participantes'));
  }
  if ((p.gestionar && e.estado === 'abierto') || lab) {
    acciones.append(h('button', { class: `btn btn--sm ${p.editar ? 'btn--ghost btn--danger' : 'btn--warn'}`, onclick: () => cerrarEvento(e) }, 'Cerrar'));
  }

  if (!acciones.children.length) {
    let pista = 'Inicia sesión para inscribirte.';
    if (estado.usuario) {
      if (p.inscrito) pista = 'Ya tienes lugar en este evento. Míralo en “Mis inscripciones”.';
      else if (e.estado === 'cerrado') pista = 'Este evento ya no admite inscripciones.';
      else if (estado.usuario.rol === 'administrador') pista = 'Los administradores no se inscriben en eventos.';
    }
    acciones.append(h('span', { class: 'hint' }, pista));
  }

  return h('article', { class: 'event' },
    cover,
    h('div', { class: 'event__body' },
      h('h3', { class: 'event__title' }, e.titulo),
      e.descripcion && h('p', { class: 'event__desc' }, e.descripcion),
      h('div', { class: 'event__meta' },
        h('span', {}, icono('fecha'), fmtFecha(fecha, { weekday: 'long', day: 'numeric', month: 'long' })),
        h('span', {}, icono('hora'), fmtFecha(fecha, { hour: '2-digit', minute: '2-digit' })),
        h('span', {}, icono('id'), `ID ${e.id}`)),
      h('div', { class: 'capacity' },
        h('div', { class: 'capacity__row' },
          h('span', {}, `${e.disponibles} de ${e.cupo} cupos libres`),
          h('span', {}, `${porcentaje}% ocupado`)),
        h('div', { class: `capacity__bar${e.disponibles / e.cupo < 0.2 ? ' is-low' : ''}` },
          h('span', { style: `width:${Math.max(porcentaje, 2)}%` }))),
      acciones));
}

function pintarEventos() {
  const q = estado.busqueda.toLowerCase();
  const lista = estado.eventos.filter((e) =>
    (estado.filtro === 'todos' || e.estado === estado.filtro) &&
    (!q || e.titulo.toLowerCase().includes(q) || (e.descripcion || '').toLowerCase().includes(q)));
  const grid = $('#grid-eventos');
  grid.replaceChildren(...(lista.length
    ? lista.map(tarjetaEvento)
    : [h('div', { class: 'empty' }, h('strong', {}, 'No hay eventos que coincidan'), 'Prueba con otra búsqueda o filtro.')]));
  pintarMisEventos();
}

async function pintarMisEventos() {
  const u = estado.usuario;
  if (!u || !['organizador', 'administrador'].includes(u.rol)) return;
  const grid = $('#grid-mis-eventos');
  if (!$('#view-mis-eventos').classList.contains('is-active')) return;
  const r = await api('GET', '/eventos/mios');
  const lista = r.ok ? r.data : [];
  grid.replaceChildren(...(lista.length
    ? lista.map(tarjetaEvento)
    : [h('div', { class: 'empty' }, h('strong', {}, 'Todavía no has creado eventos'), 'Usa “Crear evento” para publicar el primero.')]));
}

/* ---------- Acciones de evento ---------- */
async function inscribirse(e) {
  const cantidad = estado.cantidades[e.id] || 1;
  const r = await api('POST', `/eventos/${e.id}/inscripciones`, { body: { cantidad } });
  if (r.ok) {
    toast(`¡Listo! Reservaste ${cantidad} lugar(es) en “${e.titulo}”.`, 'ok');
    await refrescarTodo();
  } else {
    toast(`${r.status} · ${r.data?.error}`, 'error');
  }
}

async function cerrarEvento(e) {
  if (!confirm(`¿Cerrar “${e.titulo}”? Ya no admitirá cambios ni inscripciones.`)) return;
  const r = await api('POST', `/eventos/${e.id}/cerrar`);
  toast(r.ok ? 'Evento cerrado.' : `${r.status} · ${r.data?.error}`, r.ok ? 'ok' : 'error');
  if (r.ok) await refrescarTodo();
}

async function verParticipantes(e) {
  const r = await api('GET', `/eventos/${e.id}/inscripciones`);
  if (!r.ok) return toast(`${r.status} · ${r.data?.error}`, 'error');
  const total = r.data.reduce((s, i) => s + i.cantidad, 0);
  abrirModal(
    h('h2', {}, 'Participantes'),
    h('p', { class: 'muted' }, `${e.titulo} · ${r.data.length} inscripción(es), ${total} lugar(es)`),
    r.data.length
      ? h('ul', { class: 'people' }, r.data.map((i) =>
          h('li', {},
            h('span', { class: 'avatar avatar--xs' }, iniciales(i.participante.nombre)),
            h('div', {}, h('strong', {}, i.participante.nombre), h('small', {}, i.participante.correo)),
            h('span', { class: 'qty-pill' }, `${i.cantidad} lugar(es)`))))
      : h('div', { class: 'empty', style: 'margin-top:16px' }, 'Aún no hay inscritos.'));
}

function aLocal(iso) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 16);
}

function abrirFormEvento(e) {
  const editando = !!e;
  const base = e || { titulo: '', descripcion: '', fecha: new Date(Date.now() + 14 * 864e5).toISOString(), cupo: 50, precio: 0 };
  const error = h('p', { class: 'form-error' });
  const form = h('form', { class: 'form' },
    h('label', { class: 'field' }, h('span', {}, 'Título'), h('input', { name: 'titulo', required: true, maxlength: 120, value: base.titulo })),
    h('label', { class: 'field' }, h('span', {}, 'Descripción'), h('textarea', { name: 'descripcion', maxlength: 1000 }, base.descripcion || '')),
    h('label', { class: 'field' }, h('span', {}, 'Fecha y hora'), h('input', { name: 'fecha', type: 'datetime-local', required: true, value: aLocal(base.fecha) })),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Cupo'), h('input', { name: 'cupo', type: 'number', step: 1, value: base.cupo })),
      h('label', { class: 'field' }, h('span', {}, 'Precio (Q)'), h('input', { name: 'precio', type: 'number', step: '0.01', value: base.precio }))),
    h('p', { class: 'muted' }, 'Las validaciones (cupo positivo, precio no negativo, fecha futura) las hace el servidor. Prueba con valores negativos.'),
    error,
    h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, editando ? 'Guardar cambios' : 'Publicar evento'));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const datos = {
      titulo: f.get('titulo'),
      fecha: new Date(f.get('fecha')).toISOString(),
      cupo: Number(f.get('cupo')),
      precio: Number(f.get('precio')),
    };
    if (f.get('descripcion')) datos.descripcion = f.get('descripcion');
    const r = editando
      ? await api('PUT', `/eventos/${e.id}`, { body: datos })
      : await api('POST', '/eventos', { body: datos });
    if (r.ok) {
      cerrarModal();
      toast(editando ? 'Cambios guardados.' : 'Evento publicado.', 'ok');
      await refrescarTodo();
    } else {
      error.textContent = `${r.status} · ${r.data?.error}` +
        (r.data?.detalles ? ': ' + r.data.detalles.map((d) => d.campo).join(', ') : '');
    }
  });

  abrirModal(h('h2', {}, editando ? `Editar evento #${e.id}` : 'Nuevo evento'), form);
}

/* ---------- Mis inscripciones ---------- */
function pintarInscripciones() {
  const cont = $('#lista-inscripciones');
  if (!estado.usuario) return cont.replaceChildren();
  if (!estado.mias.length) {
    return cont.replaceChildren(h('div', { class: 'empty' },
      h('strong', {}, 'Aún no tienes inscripciones'), 'Explora la pestaña Eventos y reserva tu lugar.'));
  }
  cont.replaceChildren(...estado.mias.map((i) => {
    const e = estado.eventos.find((x) => x.id === i.eventoId);
    const [c1, c2] = paleta(i.eventoId);
    const fecha = e ? new Date(e.fecha) : null;
    return h('article', { class: 'ticket' },
      h('div', { class: 'ticket__stub', style: `background: linear-gradient(160deg, ${c1}, ${c2});` },
        h('strong', {}, i.cantidad), h('span', {}, i.cantidad === 1 ? 'lugar' : 'lugares')),
      h('div', { class: 'ticket__body' },
        h('h3', {}, e ? e.titulo : `Evento #${i.eventoId}`),
        h('div', { class: 'ticket__meta' },
          fecha && h('span', {}, fmtFecha(fecha, { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })),
          e && h('span', {}, fmtPrecio(e.precio * i.cantidad))),
        h('span', { class: 'ticket__code' }, `Inscripción #${i.id} · ${i.creadaEn}`)));
  }));
}

/* ---------- Administración ---------- */
async function pintarAdmin() {
  const r = await api('GET', '/usuarios');
  const tbody = $('#tabla-usuarios');
  if (!r.ok) return tbody.replaceChildren();
  tbody.replaceChildren(...r.data.map((u) => {
    const select = h('select', {}, ['usuario', 'organizador', 'administrador'].map((rol) =>
      h('option', { value: rol, selected: rol === u.rol }, rolLegible[rol])));
    const yo = u.id === estado.usuario.id;
    return h('tr', {},
      h('td', {}, h('div', { class: 'user-cell' }, h('span', { class: 'avatar avatar--xs' }, iniciales(u.nombre)), u.nombre, yo && h('small', { class: 'muted' }, ' (tú)'))),
      h('td', {}, u.correo),
      h('td', {}, select),
      h('td', {}, h('button', {
        class: 'btn btn--sm btn--soft',
        onclick: async () => {
          const res = await api('PATCH', `/usuarios/${u.id}/rol`, { body: { rol: select.value } });
          toast(res.ok ? `Rol de ${u.nombre} actualizado. Sus sesiones abiertas se cerraron.` : `${res.status} · ${res.data?.error}`, res.ok ? 'ok' : 'error');
          if (res.ok && yo) finSesion('Cambiaste tu propio rol: inicia sesión de nuevo.');
        },
      }, 'Guardar')));
  }));
}

/* ---------- Laboratorio ---------- */
function pruebasLab() {
  const u = estado.usuario;
  const esOrg = u && ['organizador', 'administrador'].includes(u.rol);
  const propio = u && estado.eventos.find((e) => e.organizadorId === u.id && e.estado === 'abierto');
  const ajeno = u && estado.eventos.find((e) => e.organizadorId !== u.id);
  const cerradoPropio = u && estado.eventos.find((e) => e.organizadorId === u.id && e.estado === 'cerrado');
  const otroId = u ? (u.id === 4 ? 5 : 4) : 4;

  return [
    {
      n: 1, titulo: 'Ruta privada sin autenticación', esperado: 401,
      texto: 'GET /api/auth/me sin header Authorization.',
      run: () => api('GET', '/auth/me', { token: null, etiqueta: 'Prueba 1' }),
    },
    {
      n: 2, titulo: 'Ruta privada con token válido', esperado: 200, requiere: u ? null : 'Inicia sesión primero.',
      texto: 'GET /api/auth/me con el token de tu sesión.',
      run: () => api('GET', '/auth/me', { etiqueta: 'Prueba 2' }),
    },
    {
      n: 3, titulo: 'Modificar un evento propio', esperado: 200,
      requiere: !esOrg ? 'Inicia sesión como organizador (Olga u Oscar).' : !propio ? 'No tienes eventos abiertos propios.' : null,
      texto: propio ? `PUT /api/eventos/${propio.id} (“${propio.titulo}”) sin cambiar sus datos.` : 'PUT /api/eventos/{id propio}.',
      run: () => api('PUT', `/eventos/${propio.id}`, { body: { titulo: propio.titulo }, etiqueta: 'Prueba 3' }),
    },
    {
      n: 4, titulo: 'Modificar un evento de otro organizador', esperado: u?.rol === 'administrador' ? 200 : 403,
      requiere: !u ? 'Inicia sesión (idealmente como organizador).' : !ajeno ? 'No hay eventos ajenos.' : null,
      texto: ajeno ? `PUT /api/eventos/${ajeno.id} (“${ajeno.titulo}”), que pertenece al organizador #${ajeno.organizadorId}.` : 'PUT /api/eventos/{id ajeno}.',
      nota: u?.rol === 'administrador' ? 'Como administrador sí está permitido (moderación).' : null,
      run: () => api('PUT', `/eventos/${ajeno.id}`, { body: { precio: 999 }, etiqueta: 'Prueba 4' }),
    },
    {
      n: 5, titulo: 'Consultar inscripciones de otra persona', esperado: u?.rol === 'administrador' ? 200 : 403,
      requiere: u ? null : 'Inicia sesión (por ejemplo como Ana).',
      texto: `GET /api/usuarios/${otroId}/inscripciones con tu token (tu id es ${u ? u.id : '—'}).`,
      run: () => api('GET', `/usuarios/${otroId}/inscripciones`, { etiqueta: 'Prueba 5' }),
    },
    {
      n: '6a', titulo: 'Token alterado', esperado: 401, requiere: u ? null : 'Inicia sesión primero.',
      texto: 'Se cambia el “sub” del JWT por 1 (administrador) sin volver a firmarlo.',
      run: () => {
        const [hd, pl, fi] = estado.token.split('.');
        const datos = decodificarJwt(estado.token);
        datos.sub = '1';
        const nuevo = btoa(JSON.stringify(datos)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
        return api('GET', '/auth/me', { token: `${hd}.${nuevo}.${fi}`, etiqueta: 'Prueba 6a' });
      },
    },
    {
      n: '6b', titulo: 'Token vencido', esperado: 401, campo: true,
      texto: 'Genera un token firmado pero vencido con “npm run token:vencido” y pégalo aquí.',
      run: (valor) => api('GET', '/auth/me', { token: valor.trim() || 'sin-token', etiqueta: 'Prueba 6b' }),
    },
    {
      n: '6c', titulo: 'Reusar un token después del logout', esperado: 401, requiere: u ? null : 'Inicia sesión primero.',
      texto: 'Cierra tu sesión en el servidor y vuelve a usar el mismo token. Al terminar tendrás que iniciar sesión otra vez.',
      run: async () => {
        const viejo = estado.token;
        await api('POST', '/auth/logout', { token: viejo, etiqueta: 'Prueba 6c · logout' });
        const r = await api('GET', '/auth/me', { token: viejo, etiqueta: 'Prueba 6c · reintento' });
        setTimeout(() => finSesion('El token quedó revocado: inicia sesión de nuevo.'), 600);
        return r;
      },
    },
    {
      n: 'D', titulo: 'Modificar un evento propio cerrado', esperado: 409,
      requiere: !esOrg ? 'Inicia sesión como Olga (dueña del evento 4, cerrado).' : !cerradoPropio ? 'No tienes eventos cerrados.' : null,
      texto: cerradoPropio ? `PUT /api/eventos/${cerradoPropio.id} (“${cerradoPropio.titulo}”), que está cerrado.` : 'PUT /api/eventos/{id cerrado}.',
      run: () => api('PUT', `/eventos/${cerradoPropio.id}`, { body: { precio: 10 }, etiqueta: 'Situación D' }),
    },
  ];
}

function pintarLab() {
  const grid = $('#lab-grid');
  const u = estado.usuario;
  const nota = h('div', { class: 'lab-note' },
    u ? `Probando como ${u.nombre} (${rolLegible[u.rol]}, id ${u.id}). Cambia de cuenta para ver cómo varían los resultados.`
      : 'Sin sesión. Algunas pruebas necesitan que inicies sesión; prueba con Olga (organizadora) o Ana (usuaria).');

  grid.replaceChildren(nota, ...pruebasLab().map((p) => {
    const resultado = h('div', { class: 'lab__result' }, 'Sin ejecutar');
    const campo = p.campo ? h('textarea', { placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…' }) : null;
    const boton = h('button', {
      class: 'btn btn--dark btn--sm',
      disabled: !!p.requiere,
      onclick: async () => {
        boton.disabled = true;
        const r = await p.run(campo ? campo.value : undefined);
        const paso = r.status === p.esperado;
        resultado.className = `lab__result ${paso ? 'is-pass' : 'is-fail'}`;
        resultado.replaceChildren(
          h('span', { class: `status status--${String(r.status)[0]}` }, `HTTP ${r.status}`),
          h('span', {},
            h('strong', {}, paso ? '✓ Correcto. ' : '✗ Inesperado. '),
            `${r.data?.error || TEXTO_ESTADO[r.status] || ''}${r.data?.codigo ? ` (${r.data.codigo})` : ''}`));
        boton.disabled = false;
        // Actualiza las tarjetas sin volver a dibujar el laboratorio (se perderían los resultados).
        if (p.n === 3 || p.n === 4) cargarEventos().then(() => { pintarStats(); pintarEventos(); });
      },
    }, 'Ejecutar');
    return h('article', { class: 'lab' },
      h('div', { class: 'lab__head' }, h('span', { class: 'lab__num' }, p.n), h('h3', {}, p.titulo)),
      h('p', {}, p.texto),
      p.nota && h('p', { class: 'lab__expect' }, p.nota),
      h('p', { class: 'lab__expect' }, 'Esperado: ', h('b', {}, `${p.esperado} ${TEXTO_ESTADO[p.esperado]}`)),
      campo,
      p.requiere && h('p', { class: 'lab__expect' }, '⚠ ', p.requiere),
      boton,
      resultado);
  }));
}

/* ---------- Modal ---------- */
function abrirModal(...contenido) {
  $('#modal-body').replaceChildren(...contenido);
  $('#modal').showModal();
}
function cerrarModal() {
  $('#modal').close();
}

function abrirRegistro() {
  const error = h('p', { class: 'form-error' });
  const form = h('form', { class: 'form' },
    h('label', { class: 'field' }, h('span', {}, 'Nombre'), h('input', { name: 'nombre', required: true })),
    h('label', { class: 'field' }, h('span', {}, 'Correo'), h('input', { name: 'correo', type: 'email', required: true })),
    h('label', { class: 'field' }, h('span', {}, 'Contraseña (mínimo 8 caracteres)'), h('input', { name: 'password', type: 'password', required: true })),
    h('label', { class: 'field' }, h('span', {}, 'Teléfono (opcional, 8 dígitos)'), h('input', { name: 'telefono', inputmode: 'numeric' })),
    h('p', { class: 'muted' }, 'Toda cuenta nueva se crea con rol “usuario”: el servidor ignora cualquier rol que se intente enviar.'),
    error,
    h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Crear cuenta'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    if (!f.telefono) delete f.telefono;
    const r = await api('POST', '/usuarios', { body: f, token: null });
    if (!r.ok) {
      error.textContent = `${r.status} · ${r.data?.error}` + (r.data?.detalles ? ': ' + r.data.detalles.map((d) => d.campo).join(', ') : '');
      return;
    }
    cerrarModal();
    await iniciarSesion(f.correo, f.password);
  });
  abrirModal(h('h2', {}, 'Crear cuenta'), h('p', { class: 'muted' }, 'POST /api/usuarios'), form);
}

/* ---------- Navegación ---------- */
function activarTab(nombre) {
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === nombre));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${nombre}`));
  if (nombre === 'mis-eventos') pintarMisEventos();
  if (nombre === 'admin') pintarAdmin();
  if (nombre === 'inscripciones') cargarMias().then(pintarInscripciones);
  if (nombre === 'laboratorio') pintarLab();
}

/* ---------- Inicio ---------- */
function init() {
  $('#demo-users').replaceChildren(...DEMO_USERS.map((d) =>
    h('button', { class: 'demo-user', type: 'button', onclick: () => iniciarSesion(d.correo, DEMO_PASSWORD) },
      h('span', { class: 'avatar avatar--xs' }, iniciales(d.nombre)),
      h('span', {}, h('strong', {}, d.nombre), h('small', {}, `${rolLegible[d.rol]} · ${d.correo}`)))));

  $('#form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    if (await iniciarSesion(f.get('correo'), f.get('password'))) ev.target.reset();
  });
  $('#link-registro').addEventListener('click', (ev) => { ev.preventDefault(); abrirRegistro(); });
  $('#btn-logout').addEventListener('click', () => cerrarSesion(false));
  $('#btn-logout-todas').addEventListener('click', () => cerrarSesion(true));
  $('#btn-limpiar-consola').addEventListener('click', () => $('#consola').replaceChildren());
  $('#btn-nuevo-evento').addEventListener('click', () => abrirFormEvento(null));
  $$('[data-tab]').forEach((t) => t.addEventListener('click', (ev) => { ev.preventDefault(); activarTab(t.dataset.tab); }));
  $('#buscar').addEventListener('input', (ev) => { estado.busqueda = ev.target.value; pintarEventos(); });
  $('#filtro-estado').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    estado.filtro = b.dataset.estado;
    $$('#filtro-estado button').forEach((x) => x.classList.toggle('is-active', x === b));
    pintarEventos();
  });
  $('#modo-lab').addEventListener('change', (ev) => { estado.modoLab = ev.target.checked; pintarEventos(); });

  refrescarTodo();
}

init();
