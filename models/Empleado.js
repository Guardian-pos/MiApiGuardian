const mongoose = require('mongoose');

const empleadoSchema = new mongoose.Schema({
    usuarioId: { type: String, unique: true, required: true }, // Ej. EMP-4012
    nombre: { type: String, required: true },
    correo: { type: String, required: true, unique: true },
    password: { type: String, required: true },

    // [CAMBIO] Datos personales y de contacto para la Credencial / ID
    puesto: { type: String, default: 'Operador' },
    telefonoPersonal: { type: String, default: '' },
    extension: { type: String, default: '' },
    direccion: { type: String, default: '' },
    contactoEmergencia: { type: String, default: '' },
    foto: { type: String, default: '' }, // Base64 comprimido
    activo: { type: Boolean, default: true },

    // [CAMBIO] Los 10 permisos por módulo y acción
    permisos: {
        dashboard: { type: Boolean, default: false },
        clientes: { type: Boolean, default: false },
        cortesia: { type: Boolean, default: false },
        renovacion: { type: Boolean, default: false },
        reactivacion: { type: Boolean, default: false },
        telefonica: { type: Boolean, default: true },
        tokens: { type: Boolean, default: false },
        tareas: { type: Boolean, default: false },
        reportes: { type: Boolean, default: false },
        settings: { type: Boolean, default: false }
    },
    fecha_creacion: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Empleado', empleadoSchema);