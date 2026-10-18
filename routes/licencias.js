const express = require('express');
const router = express.Router();
const Licencia = require('../models/Licencia');

// RUTA: Registrar una nueva licencia / orden de compra (simulando la pasarela o compra web)
router.post('/crear', async (req, res) => {

   if (!req.body.client.numero_cliente) {
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

        // 2. Validar si ya expiró
        if (new Date() > new Date(licencia.fecha_expiracion)) {
            return res.status(400).json({
                exito: false,
                error: "La licencia ha expirado. Por favor, renueve su plan."
            });
        }

        // 3. Vincular el dispositivo si aún no está asignado o actualizarlo
        if (!licencia.hardwareBinding.identificador_unico) {
            licencia.hardwareBinding.identificador_unico = identificador_unico || 'tablet_generica';
            licencia.hardwareBinding.tipo_dispositivo = 'android_tablet';
        }

        // 4. Asegurar que pase a estado activa si estaba pendiente de prueba/pago inicial
        if (licencia.estado === 'pendiente_pago') {
            licencia.estado = 'activa';
        }

        licencia.updatedAt = Date.now();
        await licencia.save();

        // 5. Responder con los datos críticos que la tablet necesita guardar localmente
        res.status(200).json({
            exito: true,
            mensaje: "Licencia activada y vinculada correctamente.",
            datos: {
                numero_cliente: licencia.client.numero_cliente,
                nombre_negocio: licencia.client.nombre_negocio,
                tipo_producto: licencia.tipo_producto,
                fecha_expiracion: licencia.fecha_expiracion,
                estado: licencia.estado,
                tieneUsuarios: licencia.usuarios && licencia.usuarios.length > 0 // <-- Añadido clave para el onboarding
            }
        });

    } catch (error) {
        res.status(500).json({
            exito: false,
            error: error.message
        });
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

        // Agregar el nuevo usuario al arreglo
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

        // Buscar si algún usuario coincide con el PIN
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
                numero_cliente: licencia.client.numero_cliente // Importante para el tenantId
            }
        });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

module.exports = router;