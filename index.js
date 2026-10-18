const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Servir archivos estáticos de la carpeta public
app.use(express.static('public'));

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

// Ruta de prueba inicial
app.get('/', (req, res) => {
    res.json({ mensaje: "¡Bienvenido al Panel y Servidor de Licencias de Guarián POS!" });
});

// Inicializar tareas automáticas (Cron Job)
require('./jobs/expiracionCron');

// Conexión a MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log("¡Conectado exitosamente a MongoDB Atlas!");
        app.listen(PORT, () => {
            console.log(`Servidor corriendo en el puerto ${PORT}`);
        });
    })
    .catch((error) => {
        console.error("Error al conectar con MongoDB Atlas:", error);
    });