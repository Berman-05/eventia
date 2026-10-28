// Capa de datos con la misma interfaz asíncrona para dos motores:
//   - PostgreSQL (producción y Docker): se activa con DATABASE_URL.
//   - SQLite (desarrollo rápido y pruebas): archivo local o ':memory:'.
// Las consultas se escriben con marcadores '?', que se traducen a $1, $2… en PostgreSQL.
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const ESQUEMA = {
  sqlite: `
    CREATE TABLE IF NOT EXISTS usuarios (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre        TEXT NOT NULL,
      correo        TEXT NOT NULL UNIQUE,
      telefono      TEXT,
      password_hash TEXT NOT NULL,
      rol           TEXT NOT NULL DEFAULT 'usuario'
                    CHECK (rol IN ('usuario', 'organizador', 'administrador')),
      token_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS eventos (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo          TEXT NOT NULL,
      descripcion     TEXT,
      fecha           TEXT NOT NULL,
      cupo            INTEGER NOT NULL CHECK (cupo > 0),
      disponibles     INTEGER NOT NULL CHECK (disponibles >= 0),
      precio          REAL NOT NULL CHECK (precio >= 0),
      organizador_id  INTEGER NOT NULL REFERENCES usuarios(id),
      estado          TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado'))
    );
    CREATE TABLE IF NOT EXISTS inscripciones (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      evento_id   INTEGER NOT NULL REFERENCES eventos(id),
      usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
      cantidad    INTEGER NOT NULL CHECK (cantidad > 0),
      creada_en   TEXT NOT NULL,
      UNIQUE (evento_id, usuario_id)
    );
    -- Tokens cerrados con logout antes de expirar (lista de revocación por jti).
    CREATE TABLE IF NOT EXISTS tokens_revocados (
      jti        TEXT PRIMARY KEY,
      expira_en  INTEGER NOT NULL
    );
  `,
  postgres: `
    CREATE TABLE IF NOT EXISTS usuarios (
      id            SERIAL PRIMARY KEY,
      nombre        TEXT NOT NULL,
      correo        TEXT NOT NULL UNIQUE,
      telefono      TEXT,
      password_hash TEXT NOT NULL,
      rol           TEXT NOT NULL DEFAULT 'usuario'
                    CHECK (rol IN ('usuario', 'organizador', 'administrador')),
      token_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS eventos (
      id              SERIAL PRIMARY KEY,
      titulo          TEXT NOT NULL,
      descripcion     TEXT,
      fecha           TEXT NOT NULL,
      cupo            INTEGER NOT NULL CHECK (cupo > 0),
      disponibles     INTEGER NOT NULL CHECK (disponibles >= 0),
      precio          DOUBLE PRECISION NOT NULL CHECK (precio >= 0),
      organizador_id  INTEGER NOT NULL REFERENCES usuarios(id),
      estado          TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado'))
    );
    CREATE TABLE IF NOT EXISTS inscripciones (
      id          SERIAL PRIMARY KEY,
      evento_id   INTEGER NOT NULL REFERENCES eventos(id),
      usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
      cantidad    INTEGER NOT NULL CHECK (cantidad > 0),
      creada_en   TEXT NOT NULL,
      UNIQUE (evento_id, usuario_id)
    );
    CREATE TABLE IF NOT EXISTS tokens_revocados (
      jti        TEXT PRIMARY KEY,
      expira_en  BIGINT NOT NULL
    );
  `,
};

const TABLAS = ['tokens_revocados', 'inscripciones', 'eventos', 'usuarios'];

/* ---------------- SQLite ---------------- */

function crearSqlite(ruta) {
  const conexion = new DatabaseSync(ruta);
  conexion.exec('PRAGMA foreign_keys = ON;');

  // node:sqlite es síncrono y usa una sola conexión: mientras una transacción está abierta,
  // las demás operaciones esperan a que termine para no mezclarse con ella.
  let bloqueo = null;
  const esperar = async () => { while (bloqueo) await bloqueo; };

  const ejecutar = {
    get: (sql, p = []) => conexion.prepare(sql).get(...p),
    all: (sql, p = []) => conexion.prepare(sql).all(...p),
    run: (sql, p = []) => ({ changes: Number(conexion.prepare(sql).run(...p).changes) }),
  };
  const directo = {
    get: async (sql, p) => ejecutar.get(sql, p),
    all: async (sql, p) => ejecutar.all(sql, p),
    run: async (sql, p) => ejecutar.run(sql, p),
  };

  return {
    dialecto: 'sqlite',
    get: async (sql, p) => { await esperar(); return ejecutar.get(sql, p); },
    all: async (sql, p) => { await esperar(); return ejecutar.all(sql, p); },
    run: async (sql, p) => { await esperar(); return ejecutar.run(sql, p); },
    exec: async (sql) => { await esperar(); conexion.exec(sql); },
    async transaccion(fn) {
      await esperar();
      let liberar;
      bloqueo = new Promise((r) => { liberar = r; });
      conexion.exec('BEGIN IMMEDIATE');
      try {
        const resultado = await fn(directo);
        conexion.exec('COMMIT');
        return resultado;
      } catch (err) {
        conexion.exec('ROLLBACK');
        throw err;
      } finally {
        bloqueo = null;
        liberar();
      }
    },
    async columnas(tabla) {
      return conexion.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
    },
    async cerrar() { conexion.close(); },
  };
}

/* ---------------- PostgreSQL ---------------- */

// Traduce los marcadores '?' a $1, $2, … (las consultas del proyecto no usan '?' dentro de textos).
const aPostgres = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

function crearPostgres(url) {
  const { Pool } = require('pg');
  const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({ connectionString: url, ssl, max: 10 });

  const sobre = (cliente) => ({
    get: async (sql, p = []) => (await cliente.query(aPostgres(sql), p)).rows[0],
    all: async (sql, p = []) => (await cliente.query(aPostgres(sql), p)).rows,
    run: async (sql, p = []) => ({ changes: (await cliente.query(aPostgres(sql), p)).rowCount }),
  });

  return {
    dialecto: 'postgres',
    ...sobre(pool),
    exec: async (sql) => { await pool.query(sql); },
    async transaccion(fn) {
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        const resultado = await fn(sobre(cliente));
        await cliente.query('COMMIT');
        return resultado;
      } catch (err) {
        await cliente.query('ROLLBACK');
        throw err;
      } finally {
        cliente.release();
      }
    },
    async columnas(tabla) {
      const { rows } = await pool.query(
        'SELECT column_name FROM information_schema.columns WHERE table_name = $1', [tabla]
      );
      return rows.map((r) => r.column_name);
    },
    async cerrar() { await pool.end(); },
  };
}

/* ---------------- Esquema, migraciones y datos iniciales ---------------- */

// Agrega columnas nuevas a bases creadas con versiones anteriores del esquema.
async function migrar(db) {
  if (!(await db.columnas('usuarios')).includes('token_version')) {
    await db.exec('ALTER TABLE usuarios ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await db.columnas('eventos')).includes('estado')) {
    await db.exec(`ALTER TABLE eventos ADD COLUMN estado TEXT NOT NULL DEFAULT 'abierto'
                   CHECK (estado IN ('abierto', 'cerrado'))`);
  }
}

// Contraseña de las cuentas de demostración. En un despliegue público se define con SEED_PASSWORD.
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'Eventia2026!';

async function sembrar(db) {
  const { n } = await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM usuarios');
  if (n > 0) return;

  const hash = bcrypt.hashSync(SEED_PASSWORD, 10);
  const usuarios = [
    ['Admin', 'admin@eventia.test', null, 'administrador'],       // id 1
    ['Olga Organiza', 'olga@eventia.test', '44444444', 'organizador'], // id 2
    ['Oscar Organiza', 'oscar@eventia.test', '33333333', 'organizador'], // id 3
    ['Carlos', 'carlos@eventia.test', '55555555', 'usuario'],     // id 4
    ['Ana', 'ana@eventia.test', '66666666', 'usuario'],           // id 5
  ];
  for (const [nombre, correo, telefono, rol] of usuarios) {
    await db.run(
      'INSERT INTO usuarios (nombre, correo, telefono, password_hash, rol) VALUES (?, ?, ?, ?, ?)',
      [nombre, correo, telefono, hash, rol]
    );
  }

  const eventos = [
    ['Concierto universitario', 'Bandas locales', '2026-12-05T19:00:00Z', 150, 75, 2, 'abierto'],   // id 1
    ['Taller de seguridad web', 'OWASP API Top 10', '2026-11-20T15:00:00Z', 30, 0, 3, 'abierto'],   // id 2
    ['Hackatón Eventia', 'Último cupo', '2026-11-28T08:00:00Z', 3, 25, 2, 'abierto'],               // id 3
    ['Feria de emprendimiento', 'Inscripciones cerradas', '2026-11-10T09:00:00Z', 50, 0, 2, 'cerrado'], // id 4
  ];
  for (const [titulo, descripcion, fecha, cupo, precio, organizador, estado] of eventos) {
    await db.run(
      `INSERT INTO eventos (titulo, descripcion, fecha, cupo, disponibles, precio, organizador_id, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [titulo, descripcion, fecha, cupo, cupo, precio, organizador, estado]
    );
  }
}

/**
 * Abre la base de datos, crea el esquema y carga los datos iniciales si está vacía.
 * @param {object} opciones
 * @param {string} [opciones.databaseUrl] URL de PostgreSQL. Si se omite se usa SQLite.
 * @param {string} [opciones.dbPath] Archivo SQLite (o ':memory:').
 * @param {boolean} [opciones.reiniciar] Borra las tablas antes de empezar (solo pruebas).
 */
async function abrirDb({ databaseUrl, dbPath = 'eventia.db', reiniciar = false } = {}) {
  const db = databaseUrl ? crearPostgres(databaseUrl) : crearSqlite(dbPath);
  if (reiniciar) {
    for (const tabla of TABLAS) await db.exec(`DROP TABLE IF EXISTS ${tabla}`);
  }
  await db.exec(ESQUEMA[db.dialecto]);
  await migrar(db);
  await sembrar(db);
  // Limpieza de revocaciones cuyo token ya expiró por sí solo.
  await db.run('DELETE FROM tokens_revocados WHERE expira_en < ?', [Math.floor(Date.now() / 1000)]);
  return db;
}

module.exports = { abrirDb, SEED_PASSWORD };
