const { crearApp } = require('./app');

const PORT = Number(process.env.PORT) || 3005;
const { app } = crearApp({ dbPath: process.env.DB_PATH || 'eventia.db' });

app.listen(PORT, () => {
  console.log(`Eventia API escuchando en http://localhost:${PORT}`);
});
