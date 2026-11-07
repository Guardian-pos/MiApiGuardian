const express = require('express');
const router = express.Router();
const Licencia = require('../models/Licencia');

// RUTA: Registrar una nueva licencia / orden de compra (simulando la pasarela o compra web)
router.post('/crear', async (req, res) => {
    if (!req.body.client || !req.body.client.numero_cliente) {
        if (!req.body.client) req.body.client = {};
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        req.body.client.numero_cliente = `CLI-${randomNum}`;
    } 
    try {
        // Asegurar estado inicial acorde al método de pago si no viene definido
        if (!req.body.estado) {
            if (req.body.metodo_pago?.pasarela === 'transferencia_manual') {
                req.body.estado = 'licencia_activa';
            } else if (req.body.metodo_pago?.pasarela === 'stripe') {
                req.body.estado = 'stripe_activa';
            } else {
                req.body.estado = 'prueba_activa';
            }
        }

        const nuevaLicencia = new Licencia(req.body);
        const licenciaGuardada = await nuevaLicencia.save();
        res.status(201).json({
            exito: true,
            mensaje: "Orden de compra y licencia registrada correctamente en la nube.",
            datos: licenciaGuardada
        });
    } catch (error) {
        res.status(500).json({
            exito: false,
            error: error.message
        });
    }
});

// RUTA: Consultar todas las licencias (para alimentar el panel de administración web)
router.get('/', async (req, res) => {
    try {
        const licencias = await Licencia.find();
        res.status(200).json(licencias);
    } catch (error) {
        res.status(500).json({
            exito: false,
            error: error.message
        });
    }
});

// RUTA: Actualizar o extender la vigencia/estado de una licencia desde el panel web (por ID)
router.put('/actualizar/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { fecha_expiracion, estado, client, metodo_pago, hardwareBinding } = req.body;

        const licencia = await Licencia.findById(id);
        if (!licencia) {
            return res.status(404).json({ exito: false, error: "Licencia no encontrada en el sistema." });
        }

        if (fecha_expiracion) licencia.fecha_expiracion = fecha_expiracion;
        if (estado) licencia.estado = estado;
        
        if (metodo_pago) {
            if (metodo_pago.pasarela) licencia.metodo_pago.pasarela = metodo_pago.pasarela;
            if (metodo_pago.comprobante_url) licencia.metodo_pago.comprobante_url = metodo_pago.comprobante_url;
            if (metodo_pago.stripe_customer_id) licencia.metodo_pago.stripe_customer_id = metodo_pago.stripe_customer_id;
        }

        if (hardwareBinding) {
            if (hardwareBinding.tipo_dispositivo) licencia.hardwareBinding.tipo_dispositivo = hardwareBinding.tipo_dispositivo;
            if (hardwareBinding.identificador_unico) licencia.hardwareBinding.identificador_unico = hardwareBinding.identificador_unico;
        }

        if (client) {
            if (client.nombre_negocio) licencia.client.nombre_negocio = client.nombre_negocio;
            if (client.nombre_contacto) licencia.client.nombre_contacto = client.nombre_contacto;
            if (client.telefono) licencia.client.telefono = client.telefono;
            if (client.correo) licencia.client.correo = client.correo;
        }

        licencia.updatedAt = Date.now();
        const licenciaActualizada = await licencia.save();

        res.status(200).json({
            exito: true,
            mensaje: "Licencia actualizada y extendida correctamente.",
            datos: licenciaActualizada
        });
    } catch (error) {
        res.status(500).json({
            exito: false,
            error: error.message
        });
    }
});

// RUTA: Activar licencia desde la tablet (Onboarding / Primer inicio)
router.post('/activar', async (req, res) => {
    const { licenseKey, identificador_unico } = req.body;

    try {
        if (!licenseKey) {
            return res.status(400).json({
                exito: false,
                error: "La clave de licencia es obligatoria."
            });
        }

        // 1. Buscar la licencia en la base de datos
        const licencia = await Licencia.findOne({ licenseKey });

        if (!licencia) {
            return res.status(404).json({
                exito: false,
                error: "La clave de licencia no existe en el sistema."
            });
        }

        // 2. Validar bloqueo manual por impago, suspensión o expiración en cualquier modalidad
        const estadosInactivos = ['suspendida', 'inactiva', 'vencida', 'prueba_vencida', 'licencia_vencida', 'stripe_vencida', 'cancelada_por_tiempo'];
        if (estadosInactivos.includes(licencia.estado)) {
            return res.status(403).json({
                exito: false,
                codigo_error: 'LICENCIA_INACTIVA',
                error: "Licencia suspendida o vencida. Por favor contacte a soporte."
            });
        }

        // 3. Validar si ya expiró por fecha
        if (licencia.fecha_expiracion && new Date() > new Date(licencia.fecha_expiracion)) {
            return res.status(403).json({
                exito: false,
                codigo_error: 'LICENCIA_EXPIRADA',
                error: "La licencia o periodo de prueba ha expirado. Por favor, renueve su plan."
            });
        }

        // 4. Vincular el dispositivo si aún no está asignado o validar que coincida
        if (!licencia.hardwareBinding.identificador_unico) {
            licencia.hardwareBinding.identificador_unico = identificador_unico || 'tablet_generica';
            licencia.hardwareBinding.tipo_dispositivo = 'android_tablet';
        } else if (identificador_unico && licencia.hardwareBinding.identificador_unico !== identificador_unico) {
            return res.status(403).json({
                exito: false,
                codigo_error: 'DISPOSITIVO_NO_AUTORIZADO',
                error: "Esta licencia ya se encuentra vinculada a otro dispositivo físico."
            });
        }

        // 5. Asegurar estado activo correspondiente según la pasarela si estaba pendiente
        if (licencia.estado === 'pendiente_pago') {
            if (licencia.metodo_pago.pasarela === 'transferencia_manual') {
                licencia.estado = 'licencia_activa';
            } else if (licencia.metodo_pago.pasarela === 'stripe') {
                licencia.estado = 'stripe_activa';
            } else {
                licencia.estado = 'prueba_activa';
            }
        }

        licencia.updatedAt = Date.now();
        await licencia.save();

        // 6. Responder con los datos críticos que la tablet necesita guardar localmente
        res.status(200).json({
            exito: true,
            mensaje: "Licencia activada y vinculada correctamente.",
            datos: {
                numero_cliente: licencia.client.numero_cliente,
                nombre_negocio: licencia.client.nombre_negocio,
                tipo_producto: licencia.tipo_producto,
                fecha_expiracion: licencia.fecha_expiracion,
                estado: licencia.estado,
                tieneUsuarios: licencia.usuarios && licencia.usuarios.length > 0
            }
        });

    } catch (error) {
        res.status(500).json({
            exito: false,
            error: error.message
        });
    }
});

// RUTA NUEVA: Validar estado en tiempo real (para PIN y Cierres de Caja - Impago / Expiración)
router.post('/validar-estado', async (req, res) => {
    const { licenseKey, identificador_unico } = req.body;

    try {
        if (!licenseKey) {
            return res.status(400).json({ exito: false, error: "Falta la clave de licencia." });
        }

        const licencia = await Licencia.findOne({ licenseKey });

        if (!licencia) {
            return res.status(404).json({ exito: false, error: "La licencia no existe en el sistema." });
        }

        // 1. Revisar bloqueo por impago o suspensión
        const estadosInactivos = ['suspendida', 'inactiva', 'vencida', 'prueba_vencida', 'licencia_vencida', 'stripe_vencida', 'cancelada_por_tiempo'];
        if (estadosInactivos.includes(licencia.estado)) {
            return res.status(403).json({
                exito: false,
                codigo_error: 'LICENCIA_INACTIVA',
                error: "Licencia suspendida o vencida. Por favor contacte a soporte."
            });
        }

        // 2. Revisar expiración
        if (licencia.fecha_expiracion && new Date() > new Date(licencia.fecha_expiracion)) {
            return res.status(403).json({
                exito: false,
                codigo_error: 'LICENCIA_EXPIRADA',
                error: "Su periodo de prueba o licencia ha expirado. Realice su pago para continuar."
            });
        }

        // 3. Revisar consistencia de hardware si se envía
        if (identificador_unico && licencia.hardwareBinding && licencia.hardwareBinding.identificador_unico) {
            if (licencia.hardwareBinding.identificador_unico !== identificador_unico) {
                return res.status(403).json({
                    exito: false,
                    codigo_error: 'DISPOSITIVO_NO_AUTORIZADO',
                    error: "Esta licencia está vinculada a otro dispositivo físico."
                });
            }
        }

        res.status(200).json({
            exito: true,
            mensaje: "Licencia vigente y activa.",
            datos: {
                numero_cliente: licencia.client.numero_cliente,
                fecha_expiracion: licencia.fecha_expiracion,
                estado: licencia.estado
            }
        });

    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Registrar un usuario (empleado/administrador) en una licencia específica
router.post('/usuarios/registrar', async (req, res) => {
    const { licenseKey, nombre, rol, pin } = req.body;

    try {
        const licencia = await Licencia.findOne({ licenseKey });

        if (!licencia) {
            return res.status(404).json({ exito: false, error: "Licencia no encontrada." });
        }

        licencia.usuarios.push({ nombre, rol, pin });
        licencia.updatedAt = Date.now();
        await licencia.save();

        res.status(201).json({
            exito: true,
            mensaje: "Usuario registrado correctamente en la nube.",
            usuarios: licencia.usuarios
        });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Validar login de usuario por PIN dentro de la licencia
router.post('/usuarios/login', async (req, res) => {
    const { licenseKey, pin } = req.body;

    try {
        const licencia = await Licencia.findOne({ licenseKey });

        if (!licencia) {
            return res.status(404).json({ exito: false, error: "Licencia no encontrada." });
        }

        const usuarioEncontrado = licencia.usuarios.find(u => u.pin === pin);

        if (!usuarioEncontrado) {
            return res.status(401).json({ exito: false, error: "PIN incorrecto o usuario no registrado." });
        }

        res.status(200).json({
            exito: true,
            mensaje: "Acceso concedido.",
            usuario: {
                nombre: usuarioEncontrado.nombre,
                rol: usuarioEncontrado.rol,
                numero_cliente: licencia.client.numero_cliente
            }
        });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});


// =========================================================================
// MÓDULOS NUEVOS: SOPORTE PARA EL CONFIGURACION PROVIDER DE FLUTTER
// =========================================================================

// RUTA: Obtener los datos generales de configuración del negocio por licenseKey
router.get('/configuracion/:licenseKey', async (req, res) => {
    try {
        const { licenseKey } = req.params;
        const licencia = await Licencia.findOne({ licenseKey });

        if (!licencia) {
            return res.status(404).json({ exito: false, error: "Licencia no encontrada." });
        }

        res.status(200).json({
            exito: true,
            datos: {
                nombre_negocio: licencia.client.nombre_negocio,
                direccion: licencia.client.facturacion?.razon_social || '', 
                telefono: licencia.client.telefono,
                correo: licencia.client.correo
            }
        });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Actualizar la configuración general del negocio
router.put('/configuracion/:licenseKey', async (req, res) => {
    try {
        const { licenseKey } = req.params;
        const { nombre_negocio, direccion, telefono, correo } = req.body;

        const licencia = await Licencia.findOne({ licenseKey });
        if (!licencia) {
            return res.status(404).json({ exito: false, error: "Licencia no encontrada." });
        }

        if (nombre_negocio) licencia.client.nombre_negocio = nombre_negocio;
        if (telefono) licencia.client.telefono = telefono;
        if (correo) licencia.client.correo = correo;
        
        licencia.updatedAt = Date.now();
        await licencia.save();

        res.status(200).json({ exito: true, mensaje: "Configuración actualizada correctamente." });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Guardar o actualizar un usuario de sucursal (Cajero / Administrador con PIN)
router.post('/usuarios/guardar', async (req, res) => {
    try {
        const { licenseKey, id, nombre, rol, pin } = req.body;

        const licencia = await Licencia.findOne({ licenseKey });
        if (!licencia) {
            return res.status(404).json({ exito: false, error: "Licencia no encontrada." });
        }

        if (id) {
            const usuarioIndex = licencia.usuarios.findIndex(u => u._id.toString() === id);
            if (usuarioIndex !== -1) {
                if (nombre) licencia.usuarios[usuarioIndex].nombre = nombre;
                if (rol) licencia.usuarios[usuarioIndex].rol = rol;
                if (pin) licencia.usuarios[usuarioIndex].pin = pin;
            } else {
                licencia.usuarios.push({ nombre, rol, pin });
            }
        } else {
            licencia.usuarios.push({ nombre, rol, pin });
        }

        licencia.updatedAt = Date.now();
        await licencia.save();

        res.status(200).json({ exito: true, mensaje: "Usuario guardado o actualizado correctamente." });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

module.exports = router;