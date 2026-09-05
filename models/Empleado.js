const mongoose = require('mongoose');

const empleadoSchema = new mongoose.Schema({
    usuarioId: { type: String, unique: true, required: true }, // Ej. EMP-4012
    nombre: { type: String, required: true },
    correo: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Contraseña generada automáticamente
    permisos: {
        cortesia: { type: Boolean, default: false },
        renovacion: { type: Boolean, default: false },
        reactivacion: { type: Boolean, default: false },
        telefonica: { type: Boolean, default: true }
    },
    fecha_creacion: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Empleado', empleadoSchema);