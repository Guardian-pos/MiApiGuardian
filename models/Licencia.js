const mongoose = require('mongoose');

const LicenciaSchema = new mongoose.Schema({
    
    // Identificador único de la orden (Opcional para pruebas gratuitas generadas por sistema)
    purchaseOrder: { 
        type: String, 
        required: false, 
        unique: true,
        sparse: true // Permite múltiples nulos si no hay orden de compra web aún
    },

    /**
     * Tipo de producto adquirido dentro del ecosistema Guarián POS.
     */
    tipo_producto: { 
        type: String, 
        required: true,
        default: 'guardian_pos_lite' 
    },

    // Clave de licencia única generada para el software (ej. GPOS-TEST-2026-1234)
    licenseKey: { 
        type: String, 
        required: true, 
        unique: true 
    },

    // Datos generales y fiscales del cliente
    client: {
        numero_cliente: { type: String, unique: true, sparse: true },
        nombre_negocio: { type: String, required: true },
        nombre_contacto: { type: String, required: true },
        telefono: { type: String, required: true },
        correo: { type: String, required: true },
        
        // Datos de facturación (Opcionales: solo si el cliente los solicita)
        facturacion: {
            requiere_factura: { type: Boolean, default: false },
            rfc: { type: String, uppercase: true, trim: true },
            codigo_postal: { type: String },
            razon_social: { type: String },
            regimen_fiscal: { type: String }
        }
    },

    // Vinculación de seguridad por hardware o dispositivo para evitar piratería
    hardwareBinding: {
        tipo_dispositivo: { type: String, enum: ['pc', 'android_tablet', 'web_simulator'], default: 'android_tablet' },
        identificador_unico: { type: String, default: null }
    },

    // Estado actual de la licencia en el sistema
    estado: { 
        type: String, 
        enum: ['pendiente_pago', 'activa', 'suspendida', 'cancelada_por_tiempo', 'prueba_activa'], 
        default: 'activa' 
    },

    /**
     * Vigencia del producto:
     */
    fecha_expiracion: { 
        type: Date, 
        required: true 
    },

    // Aislamiento de datos (Opcional en fases iniciales de prueba)
    conexion_bd_asignada: {
        nombre_base_datos: { type: String, required: false }
    },

    // Control de pagos y pasarelas
    metodo_pago: {
        pasarela: { type: String, enum: ['stripe', 'transferencia_manual', 'prueba_gratuita'], default: 'prueba_gratuita' },
        stripe_customer_id: { type: String, default: null },
        comprobante_url: { type: String, default: null }
    },

    // Control de caducidad automática para órdenes no pagadas (Opcional para pruebas)
    fecha_limite_pago: { 
        type: Date, 
        required: false 
    },

    // Control de usuarios (administradores y cajeros)
    usuarios: [
        {
            nombre: { type: String, required: false },
            rol: { type: String, enum: ['administrador', 'empleado'], default: 'administrador' },
            pin: { type: String, required: false }
        }
    ],

    updatedAt: { 
        type: Date, 
        default: Date.now 
    }
}, { timestamps: true });

module.exports = mongoose.model('Licencia', LicenciaSchema);