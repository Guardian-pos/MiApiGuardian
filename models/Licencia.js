/**
 * MODELO UNIFICADO DE LICENCIAS Y CLIENTES - GUARDIÁN POS
 * Este esquema en Mongoose centraliza la administración para Desktop, Lite, 
 * y módulos complementarios, integrando control de pagos, facturación y seguridad.
 */

const mongoose = require('mongoose');

const LicenciaSchema = new mongoose.Schema({
    
    // Identificador único de la orden generado automáticamente en la compra web
    purchaseOrder: { 
        type: String, 
        required: true, 
        unique: true 
    },

    /**
     * Tipo de producto adquirido dentro del ecosistema Guarián POS.
     * Permite distinguir entre licencias de PC, tablets Android o módulos complementarios.
     * Ejemplos: "guardian_pos_desktop", "guardian_pos_lite", "verificador_precios", "editor_precios"
     */
    tipo_producto: { 
        type: String, 
        required: true 
    },

    // Clave de licencia única generada para el software (ej. GPOS-TEST-2026-1234)
    licenseKey: { 
        type: String, 
        required: true, 
        unique: true 
    },

    // Datos generales y fiscales del cliente
    client: {
        numero_cliente: { type: String, unique: true },
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
        tipo_dispositivo: { type: String, enum: ['pc', 'android_tablet'], default: 'pc' },
        identificador_unico: { type: String, default: null } // MAC Address, HWID de PC o Android Device ID
    },

    // Estado actual de la licencia en el sistema
    estado: { 
        type: String, 
        enum: ['pendiente_pago', 'activa', 'suspendida', 'cancelada_por_tiempo'], 
        default: 'pendiente_pago' 
    },

    /**
     * Vigencia del producto:
     * - Escritorio (Desktop): Por defecto se calcula a 10 años (considerada comercialmente vitalicia).
     * - Lite / Nube: Sujeta a renovación mensual o anual según el plan contratado.
     */
    fecha_expiracion: { 
        type: Date, 
        required: true 
    },

    // Aislamiento de datos: Cada cliente o sucursal posee su propia base de datos independiente en Atlas
    conexion_bd_asignada: {
        nombre_base_datos: { type: String, required: true }
    },

    // Control de pagos y pasarelas (Stripe vs Transferencia Manual)
    metodo_pago: {
        pasarela: { type: String, enum: ['stripe', 'transferencia_manual'], required: true },
        // IMPORTANTE (Seguridad Financiera): Nunca guardamos números de tarjeta en crudo. 
        // Stripe se encarga de tokenizarlas y solo guardamos el ID de cliente de Stripe para cobros recurrentes mensuales.
        stripe_customer_id: { type: String, default: null },
        comprobante_url: { type: String, default: null } // Usado para validar el pago por transferencia manual
    },

    // Control de caducidad automática para órdenes por transferencia no pagadas (Límite: 3 días)
    fecha_limite_pago: { 
        type: Date, 
        required: true 
    },

    // Fechas de control de actualización de registros
    updatedAt: { 
        type: Date, 
        default: Date.now 
    }
}, { timestamps: true });

module.exports = mongoose.model('Licencia', LicenciaSchema);