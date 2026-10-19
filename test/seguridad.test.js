const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { crearApp } = require('../src/app');
const { SEED_PASSWORD } = require('../src/db');

let server;
let base;
let admin, olga, oscar, carlos, ana;

before(async () => {
  const { app } = crearApp({ dbPath: ':memory:', loginMaxIntentos: 5 });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  [admin, olga, oscar, carlos, ana] = await Promise.all(
    ['admin', 'olga', 'oscar', 'carlos', 'ana'].map((n) => login(`${n}@eventia.test`))
  );
});

after(() => server.close());

async function api(metodo, ruta, { token, body } = {}) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  return { status: res.status, body: texto ? JSON.parse(texto) : null };
}

async function login(correo) {
  const r = await api('POST', '/auth/login', { body: { correo, password: SEED_PASSWORD } });
  assert.equal(r.status, 200);
  return r.body.token;
}

const enUnMes = () => new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();


describe('API 1 - GET /inscripciones/:id (BOLA)', () => {
  let idCarlos;
  before(async () => {
    const r = await api('POST', '/eventos/1/inscripciones', { token: carlos, body: { cantidad: 2 } });
    assert.equal(r.status, 201);
    idCarlos = r.body.id;
  });

  test('el dueño puede ver su inscripción', async () => {
    const r = await api('GET', `/inscripciones/${idCarlos}`, { token: carlos });
    assert.equal(r.status, 200);
    assert.equal(r.body.id, idCarlos);
  });

  test('otro usuario recibe 404 (no se revela que existe)', async () => {
    const r = await api('GET', `/inscripciones/${idCarlos}`, { token: ana });
    assert.equal(r.status, 404);
  });

  test('organizador de otro evento recibe 404', async () => {
    const r = await api('GET', `/inscripciones/${idCarlos}`, { token: oscar });
    assert.equal(r.status, 404);
  });

  test('organizador del evento sí puede verla', async () => {
    const r = await api('GET', `/inscripciones/${idCarlos}`, { token: olga });
    assert.equal(r.status, 200);
    assert.equal(r.body.participante.nombre, 'Carlos');
  });

  test('sin token responde 401', async () => {
    const r = await api('GET', `/inscripciones/${idCarlos}`);
    assert.equal(r.status, 401);
  });
});

describe('API 2 - POST /usuarios (mass assignment)', () => {
  test('registro válido crea un usuario con rol "usuario"', async () => {
    const r = await api('POST', '/usuarios', {
      body: { nombre: 'Luis', correo: 'luis@email.com', password: 'ClaveSegura1' },
    });
    assert.equal(r.status, 201);
    assert.deepEqual(Object.keys(r.body).sort(), ['correo', 'id', 'nombre']);
  });

  test('enviar "rol: administrador" es rechazado con 400', async () => {
    const r = await api('POST', '/usuarios', {
      body: { nombre: 'Ana', correo: 'ana2@email.com', password: '12345678', rol: 'administrador' },
    });
    assert.equal(r.status, 400);
  });

  test('contraseña corta es rechazada', async () => {
    const r = await api('POST', '/usuarios', {
      body: { nombre: 'Ana', correo: 'ana3@email.com', password: '123456' },
    });
    assert.equal(r.status, 400);
  });

  test('correo duplicado responde 409', async () => {
    const r = await api('POST', '/usuarios', {
      body: { nombre: 'Carlos', correo: 'carlos@eventia.test', password: 'ClaveSegura1' },
    });
    assert.equal(r.status, 409);
  });
});

describe('API 3 - POST /eventos (validación + BFLA)', () => {
  const valido = () => ({ titulo: 'Concierto universitario', fecha: enUnMes(), cupo: 150, precio: 75 });

  test('organizador crea evento válido', async () => {
    const r = await api('POST', '/eventos', { token: olga, body: valido() });
    assert.equal(r.status, 201);
    assert.equal(r.body.organizadorId, 2);
    assert.equal(r.body.disponibles, 150);
  });

  test('cupo y precio negativos son rechazados', async () => {
    const r = await api('POST', '/eventos', { token: olga, body: { ...valido(), cupo: -50, precio: -100 } });
    assert.equal(r.status, 400);
    const campos = r.body.detalles.map((d) => d.campo);
    assert.ok(campos.includes('cupo') && campos.includes('precio'));
  });

  test('usuario normal no puede crear eventos (403)', async () => {
    const r = await api('POST', '/eventos', { token: carlos, body: valido() });
    assert.equal(r.status, 403);
  });

  test('no se puede forzar organizador_id', async () => {
    const r = await api('POST', '/eventos', { token: olga, body: { ...valido(), organizador_id: 3 } });
    assert.equal(r.status, 400);
  });
});

describe('API 4 - PUT /eventos/:id (BOLA)', () => {
  test('el organizador modifica su propio evento', async () => {
    const r = await api('PUT', '/eventos/2', { token: oscar, body: { precio: 10 } });
    assert.equal(r.status, 200);
    assert.equal(r.body.precio, 10);
  });

  test('otro organizador recibe 403', async () => {
    const r = await api('PUT', '/eventos/2', { token: olga, body: { precio: 0 } });
    assert.equal(r.status, 403);
  });

  test('administrador sí puede modificarlo', async () => {
    const r = await api('PUT', '/eventos/2', { token: admin, body: { titulo: 'Taller OWASP' } });
    assert.equal(r.status, 200);
  });

  test('no se puede bajar el cupo por debajo de lo ya inscrito', async () => {
    const r = await api('PUT', '/eventos/1', { token: olga, body: { cupo: 1 } });
    assert.equal(r.status, 409);
  });
});

describe('API 5 - POST /eventos/:id/inscripciones (límites y concurrencia)', () => {
  test('cantidad mayor al máximo por usuario es rechazada', async () => {
    const r = await api('POST', '/eventos/2/inscripciones', { token: ana, body: { cantidad: 500 } });
    assert.equal(r.status, 400);
  });

  test('no puede inscribirse dos veces al mismo evento', async () => {
    const r = await api('POST', '/eventos/1/inscripciones', { token: carlos, body: { cantidad: 1 } });
    assert.equal(r.status, 409);
  });

  test('10 inscripciones simultáneas en un evento con 3 cupos: solo 3 pasan', async () => {
    const tokens = [];
    for (let i = 0; i < 10; i++) {
      const correo = `concurrente${i}@email.com`;
      await api('POST', '/usuarios', { body: { nombre: `C${i}`, correo, password: 'ClaveSegura1' } });
      const r = await api('POST', '/auth/login', { body: { correo, password: 'ClaveSegura1' } });
      tokens.push(r.body.token);
    }
    const resultados = await Promise.all(
      tokens.map((t) => api('POST', '/eventos/3/inscripciones', { token: t, body: { cantidad: 1 } }))
    );
    const creadas = resultados.filter((r) => r.status === 201).length;
    const rechazadas = resultados.filter((r) => r.status === 409).length;
    assert.equal(creadas, 3);
    assert.equal(rechazadas, 7);
    const ev = await api('GET', '/eventos/3');
    assert.equal(ev.body.disponibles, 0);
  });
});

describe('API 6 - GET /usuarios/:id (exposición de datos)', () => {
  test('el usuario ve solo id, nombre y correo', async () => {
    const r = await api('GET', '/usuarios/4', { token: carlos });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { id: 4, nombre: 'Carlos', correo: 'carlos@eventia.test' });
  });

  test('otro usuario no puede consultarlo (403)', async () => {
    const r = await api('GET', '/usuarios/4', { token: ana });
    assert.equal(r.status, 403);
  });

  test('ni siquiera el admin recibe passwordHash', async () => {
    const r = await api('GET', '/usuarios/4', { token: admin });
    assert.equal(r.status, 200);
    assert.equal(r.body.passwordHash, undefined);
    assert.equal(r.body.password_hash, undefined);
  });
});

describe('API 7 - POST /auth/login (enumeración y fuerza bruta)', () => {
  test('correo inexistente y contraseña incorrecta dan el mismo mensaje', async () => {
    const a = await api('POST', '/auth/login', { body: { correo: 'noexiste@email.com', password: 'x' } });
    const b = await api('POST', '/auth/login', { body: { correo: 'ana@eventia.test', password: 'x' } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.deepEqual(a.body, b.body);
  });

  test('tras 5 intentos fallidos responde 429', async () => {
    const body = { correo: 'oscar@eventia.test', password: 'incorrecta' };
    const estados = [];
    for (let i = 0; i < 6; i++) estados.push((await api('POST', '/auth/login', { body })).status);
    assert.deepEqual(estados, [401, 401, 401, 401, 401, 429]);
  });
});
