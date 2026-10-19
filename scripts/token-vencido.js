// Genera un JWT correctamente firmado pero ya vencido, para probar el manejo de sesiones
// expiradas desde Postman o Thunder Client.
// Uso: node scripts/token-vencido.js [idUsuario]
const { firmarToken } = require('../src/middleware/auth');

const id = Number(process.argv[2] ?? 4);
console.log(firmarToken({ id, token_version: 0 }, { expiresIn: -60 }));
