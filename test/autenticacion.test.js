// Actividad 24: autenticación y control de acceso.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { crearApp } = require('../src/app');
const { baseDeDatosDePrueba } = require('./util');

let cerrarDb;
const { SEED_PASSWORD } = require('../src/db');
const { firmarToken } = require('../src/middleware/auth');

let server;
let base;
let admin, olga, oscar, carlos, ana;

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
  return { status: res.status, headers: res.headers, body: texto ? JSON.parse(texto) : null };
}

async function login(correo) {
  const r = await api('POST', '/auth/login', { body: { correo, password: SEED_PASSWORD } });
  assert.equal(r.status, 200);
  return r.body.token;
}

before(async () => {
  const { app, db } = await crearApp({ ...baseDeDatosDePrueba() });
  cerrarDb = () => db.cerrar();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  [admin, olga, oscar, carlos, ana] = await Promise.all(
    ['admin', 'olga', 'oscar', 'carlos', 'ana'].map((n) => login(`${n}@eventia.test`))
  );
  // Carlos (id 4) se inscribe en el evento 1 para tener una inscripción privada.
  const r = await api('POST', '/eventos/1/inscripciones', { token: carlos, body: { cantidad: 2 } });
  assert.equal(r.status, 201);
});

after(async () => {
  server.close();
  await cerrarDb();
});

describe('Autenticación', () => {
  test('login devuelve token Bearer con expiración', async () => {
    const r = await api('POST', '/auth/login', {
      body: { correo: 'carlos@eventia.test', password: SEED_PASSWORD },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.tipo, 'Bearer');
    const { exp, iat, jti } = jwt.decode(r.body.token);
    assert.equal(exp - iat, 15 * 60);
    assert.ok(jti);
  });

  test('Prueba 1: ruta privada sin autenticación -> 401', async () => {
    const r = await api('GET', '/auth/me');
    assert.equal(r.status, 401);
    assert.equal(r.body.codigo, 'token_ausente');
    assert.match(r.headers.get('www-authenticate'), /^Bearer/);
  });

  test('Prueba 2: ruta privada con token válido -> 200', async () => {
    const r = await api('GET', '/auth/me', { token: carlos });
    assert.equal(r.status, 200);
    assert.equal(r.body.correo, 'carlos@eventia.test');
  });

  test('Prueba 6a: token vencido -> 401 token_expirado', async () => {
    const vencido = firmarToken({ id: 4, token_version: 0 }, { expiresIn: -60 });
    const r = await api('GET', '/auth/me', { token: vencido });
    assert.equal(r.status, 401);
    assert.equal(r.body.codigo, 'token_expirado');
  });

  test('Prueba 6b: token alterado (firma inválida) -> 401', async () => {
    const [h, p] = carlos.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url'));
    payload.sub = '1'; // intenta hacerse pasar por el administrador
    const falso = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.firma`;
    const r = await api('GET', '/auth/me', { token: falso });
    assert.equal(r.status, 401);
    assert.equal(r.body.codigo, 'token_invalido');
  });

  test('Prueba 6c: token con alg "none" -> 401', async () => {
    const sinFirma = jwt.sign({ sub: '1', ver: 0 }, null, { algorithm: 'none' });
    const r = await api('GET', '/auth/me', { token: sinFirma });
    assert.equal(r.status, 401);
  });

  test('logout revoca el token aunque no haya expirado', async () => {
    const t = await login('ana@eventia.test');
    assert.equal((await api('GET', '/auth/me', { token: t })).status, 200);
    assert.equal((await api('POST', '/auth/logout', { token: t })).status, 204);
    const r = await api('GET', '/auth/me', { token: t });
    assert.equal(r.status, 401);
    assert.equal(r.body.codigo, 'token_revocado');
  });

  test('logout-todas invalida todas las sesiones del usuario', async () => {
    const t1 = await login('oscar@eventia.test');
    const t2 = await login('oscar@eventia.test');
    assert.equal((await api('POST', '/auth/logout-todas', { token: t1 })).status, 204);
    assert.equal((await api('GET', '/auth/me', { token: t1 })).status, 401);
    assert.equal((await api('GET', '/auth/me', { token: t2 })).status, 401);
    oscar = await login('oscar@eventia.test');
  });
});

describe('Control 1: un organizador solo modifica sus propios eventos', () => {
  test('Prueba 3: Olga modifica su evento 1 -> 200', async () => {
    const r = await api('PUT', '/eventos/1', { token: olga, body: { precio: 80 } });
    assert.equal(r.status, 200);
    assert.equal(r.body.precio, 80);
  });

  test('Prueba 4 / Situación A: Olga modifica el evento 2 de Oscar -> 403', async () => {
    const r = await api('PUT', '/eventos/2', { token: olga, body: { precio: 999 } });
    assert.equal(r.status, 403);
    const ev = await api('GET', '/eventos/2');
    assert.notEqual(ev.body.precio, 999); // el evento no cambió
  });

  test('un usuario registrado no puede usar funciones de organizador -> 403', async () => {
    const r = await api('PUT', '/eventos/1', { token: carlos, body: { precio: 1 } });
    assert.equal(r.status, 403);
  });

  test('Situación D: modificar un evento propio cerrado -> 409', async () => {
    const r = await api('PUT', '/eventos/4', { token: olga, body: { precio: 10 } });
    assert.equal(r.status, 409);
    assert.equal(r.body.codigo, 'evento_cerrado');
  });

  test('cerrar un evento propio y luego intentar cambiarlo', async () => {
    assert.equal((await api('POST', '/eventos/2/cerrar', { token: olga })).status, 403);
    const c = await api('POST', '/eventos/2/cerrar', { token: oscar });
    assert.equal(c.status, 200);
    assert.equal(c.body.estado, 'cerrado');
    assert.equal((await api('PUT', '/eventos/2', { token: oscar, body: { precio: 5 } })).status, 409);
    assert.equal((await api('POST', '/eventos/2/inscripciones', { token: ana, body: { cantidad: 1 } })).status, 409);
  });

  test('GET /eventos/mios solo devuelve eventos del organizador', async () => {
    const r = await api('GET', '/eventos/mios', { token: olga });
    assert.equal(r.status, 200);
    assert.ok(r.body.length > 0);
    assert.ok(r.body.every((e) => e.organizadorId === 2));
  });

  test('participantes: solo el organizador del evento', async () => {
    assert.equal((await api('GET', '/eventos/1/inscripciones', { token: olga })).status, 200);
    assert.equal((await api('GET', '/eventos/1/inscripciones', { token: oscar })).status, 403);
    assert.equal((await api('GET', '/eventos/1/inscripciones', { token: carlos })).status, 403);
  });
});

describe('Control 2: un usuario solo consulta sus propias inscripciones', () => {
  test('Carlos consulta sus inscripciones -> 200', async () => {
    const r = await api('GET', '/usuarios/4/inscripciones', { token: carlos });
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 1);
  });

  test('Prueba 5 / Situación B: Ana consulta las inscripciones de Carlos -> 403', async () => {
    const r = await api('GET', '/usuarios/4/inscripciones', { token: ana });
    assert.equal(r.status, 403);
  });

  test('Ana consulta la inscripción de Carlos por id -> 404', async () => {
    const r = await api('GET', '/inscripciones/1', { token: ana });
    assert.equal(r.status, 404);
  });

  test('el administrador sí puede consultarlas', async () => {
    const r = await api('GET', '/usuarios/4/inscripciones', { token: admin });
    assert.equal(r.status, 200);
  });
});

describe('Situación C: operación administrativa con sesión vencida', () => {
  test('admin con token vencido -> 401 y no se ejecuta', async () => {
    const vencido = firmarToken({ id: 1, token_version: 0 }, { expiresIn: -1 });
    const r = await api('PATCH', '/usuarios/5/rol', { token: vencido, body: { rol: 'organizador' } });
    assert.equal(r.status, 401);
    assert.equal(r.body.codigo, 'token_expirado');
    const ana5 = await api('GET', '/usuarios/5', { token: admin });
    assert.equal(ana5.body.rol, 'usuario');
  });

  test('con sesión válida el admin cambia el rol y las sesiones de ese usuario se invalidan', async () => {
    const r = await api('PATCH', '/usuarios/5/rol', { token: admin, body: { rol: 'organizador' } });
    assert.equal(r.status, 200);
    assert.equal((await api('GET', '/auth/me', { token: ana })).status, 401);
  });
});
