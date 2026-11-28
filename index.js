const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const { crearRateLimiter } = require('./middleware/seguridad'); // [CAMBIO]

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // [CAMBIO] Necesario en Render para leer la IP real en Rate Limiter

// [CAMBIO] CORS estricto para navegadores; permite apps móviles/nativas sin Origin
const origenesPermitidos = [
  'https://admin.guardianpos.mx',
  'https://adminguardianpos.onrender.com',
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origenesPermitidos.includes(origin)) {
        return callback(null, true);
      }
      if (process.env.NODE_ENV !== 'production' && origin.startsWith('http://localhost')) {
        return callback(null, true);
      }
      return callback(new Error('Origen no permitido por CORS'));
    },
  })
);

app.use(express.json({ limit: '5mb' })); // [CAMBIO] Margen seguro para payloads de ventas/movimientos

// Servir archivos estáticos de la carpeta public
app.use(express.static('public'));

// [CAMBIO] Rate Limiters anti-fuerza bruta en rutas sensibles
const limiterAuth = crearRateLimiter({
  ventanaMs: 15 * 60 * 1000,
  maxIntentos: 40,
  mensaje: 'Demasiados intentos de acceso. Intenta nuevamente en unos minutos.',
});
const limiterOperaciones = crearRateLimiter({
  ventanaMs: 60 * 1000,
  maxIntentos: 45,
  mensaje: 'Límite temporal de operaciones excedido. Espera unos segundos.',
});

app.use('/api/empleados/login', limiterAuth);
app.use('/api/licencias/activar', limiterAuth);
app.use('/api/licencias/validar-estado', limiterAuth);
app.use('/api/solicitar-prueba', limiterAuth);
app.use('/api/recargas-servicios/cobrar-recarga', limiterOperaciones);
app.use('/api/recargas-servicios/cobrar-servicio', limiterOperaciones);

// ==========================================
// RUTAS DE LA API (MÓDULO UNIFICADO)
// ==========================================
const licenciasRutas = require('./routes/licencias');
app.use('/api/licencias', licenciasRutas);

const rutasEmpleados = require('./routes/empleados');
app.use('/api/empleados', rutasEmpleados);

const productosRutas = require('./routes/products');
app.use('/api/productos', productosRutas);

// Importar y usar las rutas de prueba (trial)
const trialRoutes = require('./routes/trial');
app.use('/api', trialRoutes);

// NUEVO: Importar y usar las rutas de movimientos (Ventas, Devoluciones, Caja, Cortes)
const movimientosRutas = require('./routes/movimientos');
app.use('/api/movimientos', movimientosRutas);

// [CAMBIO] Rutas independientes para Recargas Electrónicas, Pago de Servicios y Billetera de Tokens
const recargasServiciosRutas = require('./routes/recargasServicios');
app.use('/api/recargas-servicios', recargasServiciosRutas);

// Ruta de prueba inicial
app.get('/', (req, res) => {
  res.json({ mensaje: '¡Bienvenido al Panel y Servidor de Licencias de Guardián POS!' });
});

// Inicializar tareas automáticas (Cron Job)
require('./jobs/expiracionCron');

// Conexión a MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('Error: MONGO_URI no está configurada en las variables de entorno.');
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('¡Conectado exitosamente a MongoDB Atlas!');
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en el puerto ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Error al conectar con MongoDB Atlas:', error);
  });