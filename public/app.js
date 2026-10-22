'use strict';

/* ==========================================================================
   Eventia — frontend
   La interfaz muestra a cada persona solo las acciones de su rol, pero eso es
   comodidad: todas las reglas de acceso las aplica la API en el servidor.
   ========================================================================== */

const API = '/api';

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
  eventos: [],
  mias: [],
  filtro: 'todos',
  busqueda: '',
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
};
const icono = (n) => h('span', { html: ICONOS[n] });

const iniciales = (nombre = '') =>
  nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';

const fmtFecha = (iso, opts) => new Intl.DateTimeFormat('es-GT', opts).format(new Date(iso));
const fmtPrecio = (p) => (p === 0 ? 'Gratis' : `Q${Number(p).toLocaleString('es-GT')}`);
const paleta = (id) => PALETAS[(id - 1) % PALETAS.length];
const rolLegible = { usuario: 'Usuario registrado', organizador: 'Organizador', administrador: 'Administrador' };

function toast(msg, tipo = 'info') {
  const t = h('div', { class: `toast toast--${tipo}` }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}

// Mensaje legible a partir de la respuesta de error de la API.
function mensajeError(r) {
  if (!r.data) return 'Ocurrió un error inesperado.';
  const campos = { titulo: 'título', cupo: 'cupo', precio: 'precio', fecha: 'fecha', correo: 'correo', password: 'contraseña', nombre: 'nombre', telefono: 'teléfono', descripcion: 'descripción' };
  if (r.data.detalles) {
    return `Revisa estos campos: ${r.data.detalles.map((d) => campos[d.campo] || d.campo).join(', ')}.`;
  }
  return r.data.error;
}

/* ---------- Cliente API ---------- */
async function api(metodo, ruta, { body, sinToken } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (estado.token && !sinToken) headers.Authorization = `Bearer ${estado.token}`;
  let status = 0;
  let data = null;
  try {
    const res = await fetch(API + ruta, { method: metodo, headers, body: body ? JSON.stringify(body) : undefined });
    status = res.status;
    const texto = await res.text();
    data = texto ? JSON.parse(texto) : null;
  } catch {
    data = { error: 'No se pudo conectar con el servidor. Intenta de nuevo.' };
  }

  // Si la sesión dejó de ser válida (expiró, se cerró en otro dispositivo…), se cierra aquí también.
  if (status === 401 && estado.token && !sinToken) {
    finSesion(data?.codigo === 'token_expirado'
      ? 'Tu sesión expiró. Inicia sesión de nuevo.'
      : 'Tu sesión ya no es válida. Inicia sesión de nuevo.');
  }
  return { status, data, ok: status >= 200 && status < 300 };
}

/* ---------- Sesión ---------- */
async function iniciarSesion(correo, password) {
  const r = await api('POST', '/auth/login', { body: { correo, password }, sinToken: true });
  if (!r.ok) return mensajeError(r);
  estado.token = r.data.token;
  estado.usuario = r.data.usuario;
  toast(`¡Hola, ${r.data.usuario.nombre}!`, 'ok');
  await refrescarTodo();
  return null;
}

function finSesion(mensaje) {
  Object.assign(estado, { token: null, usuario: null, mias: [] });
  if (mensaje) toast(mensaje, 'info');
  pintarSesion();
  pintarStats();
  pintarEventos();
  activarTab('eventos');
}

async function cerrarSesion(todas = false) {
  cerrarMenu();
  await api('POST', todas ? '/auth/logout-todas' : '/auth/logout');
  finSesion(todas ? 'Cerraste sesión en todos tus dispositivos.' : 'Sesión cerrada. ¡Vuelve pronto!');
}

function pintarSesion() {
  const u = estado.usuario;
  $('#acciones-visitante').hidden = !!u;
  $('#menu-usuario').hidden = !u;
  $('#stat-mias-box').hidden = !u;

  const visible = (req) => !!u && (req === 'sesion'
    || (req === 'organizador' && ['organizador', 'administrador'].includes(u.rol))
    || (req === 'administrador' && u.rol === 'administrador'));
  $$('[data-requiere]').forEach((el) => { el.hidden = !visible(el.dataset.requiere); });

  if (!u) return;
  $('#chip-avatar').textContent = iniciales(u.nombre);
  $('#chip-nombre').textContent = u.nombre;
  $('#chip-rol').textContent = rolLegible[u.rol];
  $('#menu-nombre').textContent = u.nombre;
  $('#menu-correo').textContent = u.correo;
}

/* ---------- Menú de usuario ---------- */
function cerrarMenu() {
  $('#dropdown').hidden = true;
  $('#btn-menu').setAttribute('aria-expanded', 'false');
}

/* ---------- Datos ---------- */
async function cargarEventos() {
  const r = await api('GET', '/eventos', { sinToken: true });
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
}

function pintarStats() {
  const abiertos = estado.eventos.filter((e) => e.estado === 'abierto');
  $('#stat-abiertos').textContent = abiertos.length;
  $('#stat-cupos').textContent = abiertos.reduce((s, e) => s + e.disponibles, 0).toLocaleString('es-GT');
  $('#stat-mias').textContent = estado.mias.length;
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
    inscribirse: (!u || ['usuario', 'organizador'].includes(u.rol)) && !esDueno && abierto && !inscrito && e.disponibles > 0,
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

  if (p.inscribirse) {
    const max = Math.min(4, e.disponibles);
    const valor = h('span', {}, Math.min(estado.cantidades[e.id] || 1, max));
    const cambiar = (d) => {
      const n = Math.min(max, Math.max(1, (estado.cantidades[e.id] || 1) + d));
      estado.cantidades[e.id] = n;
      valor.textContent = n;
    };
    acciones.append(
      h('div', { class: 'qty' },
        h('button', { type: 'button', onclick: () => cambiar(-1), 'aria-label': 'Menos' }, '−'),
        valor,
        h('button', { type: 'button', onclick: () => cambiar(1), 'aria-label': 'Más' }, '+')),
      h('button', { class: 'btn btn--primary', onclick: () => inscribirse(e) }, 'Reservar lugar'));
  }
  if (p.editar) acciones.append(h('button', { class: 'btn btn--sm btn--soft', onclick: () => abrirFormEvento(e) }, 'Editar'));
  if (p.gestionar) acciones.append(h('button', { class: 'btn btn--sm btn--ghost', onclick: () => verParticipantes(e) }, 'Participantes'));
  if (p.editar) acciones.append(h('button', { class: 'btn btn--sm btn--ghost btn--danger', onclick: () => cerrarEvento(e) }, 'Cerrar evento'));

  if (!acciones.children.length) {
    let pista = 'Inscripciones no disponibles.';
    if (p.inscrito) pista = 'Ya tienes lugar en este evento. Lo encuentras en “Mis inscripciones”.';
    else if (e.estado === 'cerrado') pista = 'Este evento ya no admite inscripciones.';
    else if (e.disponibles === 0) pista = 'Cupo agotado.';
    else if (estado.usuario?.rol === 'administrador') pista = 'Las cuentas de administración no reservan lugares.';
    acciones.append(h('span', { class: 'hint' }, pista));
  }

  return h('article', { class: 'event' },
    cover,
    h('div', { class: 'event__body' },
      h('h3', { class: 'event__title' }, e.titulo),
      e.descripcion && h('p', { class: 'event__desc' }, e.descripcion),
      h('div', { class: 'event__meta' },
        h('span', {}, icono('fecha'), fmtFecha(fecha, { weekday: 'long', day: 'numeric', month: 'long' })),
        h('span', {}, icono('hora'), fmtFecha(fecha, { hour: '2-digit', minute: '2-digit' }))),
      h('div', { class: 'capacity' },
        h('div', { class: 'capacity__row' },
          h('span', {}, e.disponibles ? `${e.disponibles} de ${e.cupo} lugares libres` : 'Agotado'),
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
  $('#grid-eventos').replaceChildren(...(lista.length
    ? lista.map(tarjetaEvento)
    : [h('div', { class: 'empty' }, h('strong', {}, 'No hay eventos que coincidan'), 'Prueba con otra búsqueda o filtro.')]));
  if ($('#view-mis-eventos').classList.contains('is-active')) pintarMisEventos();
}

async function pintarMisEventos() {
  const u = estado.usuario;
  if (!u || !['organizador', 'administrador'].includes(u.rol)) return;
  const r = await api('GET', '/eventos/mios');
  const lista = r.ok ? r.data : [];
  $('#grid-mis-eventos').replaceChildren(...(lista.length
    ? lista.map(tarjetaEvento)
    : [h('div', { class: 'empty' }, h('strong', {}, 'Todavía no has creado eventos'), 'Usa “Crear evento” para publicar el primero.')]));
}

/* ---------- Acciones de evento ---------- */
async function inscribirse(e) {
  if (!estado.usuario) {
    toast('Inicia sesión para reservar tu lugar.', 'info');
    return abrirLogin();
  }
  const cantidad = Math.min(estado.cantidades[e.id] || 1, e.disponibles);
  const r = await api('POST', `/eventos/${e.id}/inscripciones`, { body: { cantidad } });
  if (r.ok) {
    toast(`¡Listo! Reservaste ${cantidad} ${cantidad === 1 ? 'lugar' : 'lugares'} en “${e.titulo}”.`, 'ok');
    await refrescarTodo();
  } else if (r.status !== 401) {
    toast(mensajeError(r), 'error');
  }
}

async function cerrarEvento(e) {
  if (!confirm(`¿Cerrar “${e.titulo}”? Ya no admitirá cambios ni inscripciones.`)) return;
  const r = await api('POST', `/eventos/${e.id}/cerrar`);
  if (r.ok) {
    toast('Evento cerrado.', 'ok');
    await refrescarTodo();
  } else if (r.status !== 401) {
    toast(mensajeError(r), 'error');
  }
}

async function verParticipantes(e) {
  const r = await api('GET', `/eventos/${e.id}/inscripciones`);
  if (!r.ok) return r.status !== 401 && toast(mensajeError(r), 'error');
  const total = r.data.reduce((s, i) => s + i.cantidad, 0);
  abrirModal(
    h('h2', {}, 'Participantes'),
    h('p', { class: 'muted' }, `${e.titulo} · ${r.data.length} inscripción(es), ${total} lugar(es)`),
    r.data.length
      ? h('ul', { class: 'people' }, r.data.map((i) =>
          h('li', {},
            h('span', { class: 'avatar avatar--xs' }, iniciales(i.participante.nombre)),
            h('div', {}, h('strong', {}, i.participante.nombre), h('small', {}, i.participante.correo)),
            h('span', { class: 'qty-pill' }, `${i.cantidad} ${i.cantidad === 1 ? 'lugar' : 'lugares'}`))))
      : h('div', { class: 'empty', style: 'margin-top:16px' }, 'Aún no hay inscritos.'));
}

function aLocal(iso) {
  const d = new Date(iso);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function abrirFormEvento(e) {
  const editando = !!e;
  const base = e || { titulo: '', descripcion: '', fecha: new Date(Date.now() + 14 * 864e5).toISOString(), cupo: 50, precio: 0 };
  const error = h('p', { class: 'form-error' });
  const form = h('form', { class: 'form' },
    h('label', { class: 'field' }, h('span', {}, 'Título'), h('input', { name: 'titulo', required: true, minlength: 3, maxlength: 120, value: base.titulo })),
    h('label', { class: 'field' }, h('span', {}, 'Descripción'), h('textarea', { name: 'descripcion', maxlength: 1000 }, base.descripcion || '')),
    h('label', { class: 'field' }, h('span', {}, 'Fecha y hora'), h('input', { name: 'fecha', type: 'datetime-local', required: true, value: aLocal(base.fecha) })),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Cupo'), h('input', { name: 'cupo', type: 'number', min: 1, max: 10000, step: 1, required: true, value: base.cupo })),
      h('label', { class: 'field' }, h('span', {}, 'Precio (Q)'), h('input', { name: 'precio', type: 'number', min: 0, step: '0.01', required: true, value: base.precio }))),
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
      toast(editando ? 'Cambios guardados.' : '¡Evento publicado!', 'ok');
      await refrescarTodo();
    } else if (r.status !== 401) {
      error.textContent = mensajeError(r);
    }
  });

  abrirModal(h('h2', {}, editando ? 'Editar evento' : 'Nuevo evento'), form);
}

/* ---------- Mis inscripciones ---------- */
function pintarInscripciones() {
  const cont = $('#lista-inscripciones');
  if (!estado.usuario) return cont.replaceChildren();
  if (!estado.mias.length) {
    return cont.replaceChildren(h('div', { class: 'empty' },
      h('strong', {}, 'Aún no tienes inscripciones'), 'Explora los eventos y reserva tu lugar.'));
  }
  cont.replaceChildren(...estado.mias.map((i) => {
    const e = estado.eventos.find((x) => x.id === i.eventoId);
    const [c1, c2] = paleta(i.eventoId);
    const fecha = e ? new Date(e.fecha) : null;
    return h('article', { class: 'ticket' },
      h('div', { class: 'ticket__stub', style: `background: linear-gradient(160deg, ${c1}, ${c2});` },
        h('strong', {}, i.cantidad), h('span', {}, i.cantidad === 1 ? 'lugar' : 'lugares')),
      h('div', { class: 'ticket__body' },
        h('h3', {}, e ? e.titulo : 'Evento'),
        h('div', { class: 'ticket__meta' },
          fecha && h('span', {}, fmtFecha(fecha, { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })),
          e && h('span', {}, `Total: ${fmtPrecio(e.precio * i.cantidad)}`)),
        h('span', { class: 'ticket__code' }, `Reserva N.º ${String(i.id).padStart(5, '0')}`)));
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
          if (res.ok) {
            toast(`Rol de ${u.nombre} actualizado.`, 'ok');
            if (yo) finSesion('Cambiaste tu propio rol: inicia sesión de nuevo.');
          } else if (res.status !== 401) {
            toast(mensajeError(res), 'error');
          }
        },
      }, 'Guardar')));
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

function abrirLogin() {
  const error = h('p', { class: 'form-error' });
  const form = h('form', { class: 'form' },
    h('label', { class: 'field' }, h('span', {}, 'Correo electrónico'),
      h('input', { name: 'correo', type: 'email', required: true, autocomplete: 'username', placeholder: 'tu@correo.com' })),
    h('label', { class: 'field' }, h('span', {}, 'Contraseña'),
      h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password', placeholder: 'Tu contraseña' })),
    error,
    h('button', { class: 'btn btn--dark btn--block', type: 'submit' }, 'Iniciar sesión'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const boton = form.querySelector('button[type=submit]');
    boton.disabled = true;
    const f = new FormData(form);
    const fallo = await iniciarSesion(f.get('correo'), f.get('password'));
    boton.disabled = false;
    if (fallo) error.textContent = fallo;
    else cerrarModal();
  });
  abrirModal(
    h('div', { class: 'modal__brand' }, h('span', { class: 'brand__logo' }, 'E')),
    h('h2', {}, 'Bienvenido de nuevo'),
    h('p', { class: 'muted' }, 'Ingresa para reservar y administrar tus eventos.'),
    form,
    h('p', { class: 'modal__foot' }, '¿No tienes cuenta? ',
      h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); abrirRegistro(); } }, 'Crea una gratis')));
  form.querySelector('input').focus();
}

function abrirRegistro() {
  const error = h('p', { class: 'form-error' });
  const form = h('form', { class: 'form' },
    h('label', { class: 'field' }, h('span', {}, 'Nombre'), h('input', { name: 'nombre', required: true, minlength: 2, maxlength: 80, autocomplete: 'name' })),
    h('label', { class: 'field' }, h('span', {}, 'Correo electrónico'), h('input', { name: 'correo', type: 'email', required: true, autocomplete: 'email' })),
    h('label', { class: 'field' }, h('span', {}, 'Contraseña'), h('input', { name: 'password', type: 'password', required: true, minlength: 8, autocomplete: 'new-password', placeholder: 'Mínimo 8 caracteres' })),
    h('label', { class: 'field' }, h('span', {}, 'Teléfono (opcional)'), h('input', { name: 'telefono', inputmode: 'numeric', pattern: '[0-9]{8}', placeholder: '8 dígitos', autocomplete: 'tel' })),
    error,
    h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Crear cuenta'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    if (!f.telefono) delete f.telefono;
    const r = await api('POST', '/usuarios', { body: f, sinToken: true });
    if (!r.ok) {
      error.textContent = mensajeError(r);
      return;
    }
    const fallo = await iniciarSesion(f.correo, f.password);
    if (fallo) error.textContent = fallo;
    else cerrarModal();
  });
  abrirModal(
    h('div', { class: 'modal__brand' }, h('span', { class: 'brand__logo' }, 'E')),
    h('h2', {}, 'Crea tu cuenta'),
    h('p', { class: 'muted' }, 'Reserva lugares en los mejores eventos de la ciudad.'),
    form,
    h('p', { class: 'modal__foot' }, '¿Ya tienes cuenta? ',
      h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); abrirLogin(); } }, 'Inicia sesión')));
  form.querySelector('input').focus();
}

/* ---------- Navegación ---------- */
function activarTab(nombre) {
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === nombre));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${nombre}`));
  if (nombre === 'mis-eventos') pintarMisEventos();
  if (nombre === 'admin') pintarAdmin();
  if (nombre === 'inscripciones') cargarMias().then(pintarInscripciones);
}

/* ---------- Inicio ---------- */
function init() {
  $('#btn-abrir-login').addEventListener('click', abrirLogin);
  $('#btn-abrir-registro').addEventListener('click', abrirRegistro);
  $('#btn-logout').addEventListener('click', () => cerrarSesion(false));
  $('#btn-logout-todas').addEventListener('click', () => cerrarSesion(true));
  $('#btn-nuevo-evento').addEventListener('click', () => abrirFormEvento(null));

  $('#btn-menu').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const abierto = $('#dropdown').hidden;
    $('#dropdown').hidden = !abierto;
    $('#btn-menu').setAttribute('aria-expanded', String(abierto));
  });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('#menu-usuario')) cerrarMenu(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cerrarMenu(); });

  $$('[data-tab]').forEach((t) => t.addEventListener('click', (ev) => {
    ev.preventDefault();
    cerrarMenu();
    activarTab(t.dataset.tab);
  }));
  $('#buscar').addEventListener('input', (ev) => { estado.busqueda = ev.target.value; pintarEventos(); });
  $('#filtro-estado').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    estado.filtro = b.dataset.estado;
    $$('#filtro-estado button').forEach((x) => x.classList.toggle('is-active', x === b));
    pintarEventos();
  });

  refrescarTodo();
}

init();
