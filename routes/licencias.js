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

        // 2. Validar bloqueo manual por impago o suspensión (si el campo estado o activo lo define)
        if (licencia.estado === 'suspendida' || licencia.estado === 'inactiva') {
            return res.status(403).json({
                exito: false,
                codigo_error: 'LICENCIA_INACTIVA',
                error: "Licencia suspendida por falta de pago. Por favor contacte a soporte."
            });
        }

        // 3. Validar si ya expiró
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

        // 5. Asegurar que pase a estado activa si estaba pendiente de prueba/pago inicial
        if (licencia.estado === 'pendiente_pago') {
            licencia.estado = 'activa';
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
        if (licencia.estado === 'suspendida' || licencia.estado === 'inactiva') {
            return res.status(403).json({
                exito: false,
                codigo_error: 'LICENCIA_INACTIVA',
                error: "Licencia suspendida por falta de pago. Por favor contacte a soporte."
            });
        }

        // 2. Revisar expiración (Prueba o Mensualidad)
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

module.exports = router;