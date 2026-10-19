const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const SCHEMA = `
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
    creada_en   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (evento_id, usuario_id)
  );

  -- Tokens cerrados con logout antes de expirar (lista de revocación por jti).
  CREATE TABLE IF NOT EXISTS tokens_revocados (
    jti        TEXT PRIMARY KEY,
    expira_en  INTEGER NOT NULL
  );
`;

// Agrega columnas nuevas a bases creadas con versiones anteriores del esquema.
function migrar(db) {
  const columnas = (tabla) => db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
  if (!columnas('usuarios').includes('token_version')) {
    db.exec('ALTER TABLE usuarios ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  }
  if (!columnas('eventos').includes('estado')) {
    db.exec(`ALTER TABLE eventos ADD COLUMN estado TEXT NOT NULL DEFAULT 'abierto'
             CHECK (estado IN ('abierto', 'cerrado'))`);
  }
}

// Datos de prueba. Todas las cuentas usan la contraseña SEED_PASSWORD.
const SEED_PASSWORD = 'Eventia2026!';

function seed(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get();
  if (n > 0) return;

  const hash = bcrypt.hashSync(SEED_PASSWORD, 10);
  const insertUser = db.prepare(
    'INSERT INTO usuarios (nombre, correo, telefono, password_hash, rol) VALUES (?, ?, ?, ?, ?)'
  );
  insertUser.run('Admin', 'admin@eventia.test', null, hash, 'administrador');     // id 1
  insertUser.run('Olga Organiza', 'olga@eventia.test', '44444444', hash, 'organizador'); // id 2
  insertUser.run('Oscar Organiza', 'oscar@eventia.test', '33333333', hash, 'organizador'); // id 3
  insertUser.run('Carlos', 'carlos@eventia.test', '55555555', hash, 'usuario');   // id 4
  insertUser.run('Ana', 'ana@eventia.test', '66666666', hash, 'usuario');         // id 5

  const insertEvento = db.prepare(
    `INSERT INTO eventos (titulo, descripcion, fecha, cupo, disponibles, precio, organizador_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertEvento.run('Concierto universitario', 'Bandas locales', '2026-12-05T19:00:00Z', 150, 150, 75, 2); // id 1
  insertEvento.run('Taller de seguridad web', 'OWASP API Top 10', '2026-11-20T15:00:00Z', 30, 30, 0, 3);  // id 2
  insertEvento.run('Hackatón Eventia', 'Último cupo', '2026-11-28T08:00:00Z', 3, 3, 25, 2);              // id 3
  insertEvento.run('Feria de emprendimiento', 'Inscripciones cerradas', '2026-11-10T09:00:00Z', 50, 50, 0, 2); // id 4
  db.prepare("UPDATE eventos SET estado = 'cerrado' WHERE id = 4").run();
}

function openDb(path = 'eventia.db') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrar(db);
  seed(db);
  // Limpieza de revocaciones cuyo token ya expiró por sí solo.
  db.prepare('DELETE FROM tokens_revocados WHERE expira_en < ?').run(Math.floor(Date.now() / 1000));
  return db;
}

module.exports = { openDb, SEED_PASSWORD };
