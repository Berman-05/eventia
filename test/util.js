// Las pruebas usan SQLite en memoria. Con TEST_DATABASE_URL corren contra PostgreSQL
// (las tablas se borran y se vuelven a crear al inicio de cada archivo de pruebas).
function baseDeDatosDePrueba() {
  const url = process.env.TEST_DATABASE_URL;
  return url ? { databaseUrl: url, reiniciar: true } : { dbPath: ':memory:' };
}

module.exports = { baseDeDatosDePrueba };
