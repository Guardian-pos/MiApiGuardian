const express = require('express');
const router = express.Router();
const Empleado = require('../models/Empleado');
const { Resend } = require('resend');

// Inicializar Resend con la API Key configurada en las variables de entorno
const resend = new Resend(process.env.RESEND_API_KEY);

// RUTA: Iniciar sesión del operador
router.post('/login', async (req, res) => {
    try {
        const { usuarioId, password } = req.body;
        const empleado = await Empleado.findOne({ usuarioId, password });
        
        if (!empleado) {
            return res.status(401).json({ exito: false, error: "Credenciales incorrectas." });
        }

        res.json({ exito: true, mensaje: "Autenticación exitosa", empleado });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Obtener lista de empleados
router.get('/', async (req, res) => {
    try {
        const empleados = await Empleado.find();
        res.json(empleados);
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Registrar un nuevo empleado / operador
router.post('/crear', async (req, res) => {
    try {
        const { nombre, correo, permisos } = req.body;

        // Generar ID y contraseña automáticos si no vienen definidos
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const usuarioId = req.body.usuarioId || `EMP-${randomNum}`;
        
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@$!";
        let password = req.body.password;
        if (!password) {
            password = "";
            for (let i = 0; i < 10; i++) {
                password += chars.charAt(Math.floor(Math.random() * chars.length));
            }
        }

        const nuevoEmpleado = new Empleado({
            usuarioId,
            nombre,
            correo,
            password,
            permisos: permisos || { cortesia: false, renovacion: false, reactivacion: false, telefonica: true }
        });

        const empleadoGuardado = await nuevoEmpleado.save();
        res.status(201).json({
            exito: true,
            mensaje: "Empleado registrado correctamente.",
            empleado: empleadoGuardado
        });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Actualizar datos y permisos de un empleado existente
router.put('/actualizar/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, correo, permisos } = req.body;

        const empleadoActualizado = await Empleado.findByIdAndUpdate(
            id,
            { nombre, correo, permisos },
            { new: true }
        );

        if (!empleadoActualizado) {
            return res.status(404).json({ exito: false, error: "Empleado no encontrado." });
        }

        res.json({ exito: true, mensaje: "Empleado actualizado correctamente.", empleado: empleadoActualizado });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Regenerar contraseña de un empleado
router.put('/regenerar-password/:id', async (req, res) => {
    try {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@$!";
        let nuevaPassword = "";
        for (let i = 0; i < 10; i++) {
            nuevaPassword += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        const empleado = await Empleado.findByIdAndUpdate(
            req.params.id, 
            { password: nuevaPassword }, 
            { new: true }
        );

        if (!empleado) {
            return res.status(404).json({ exito: false, error: "Empleado no encontrado." });
        }

        res.json({ exito: true, mensaje: "Contraseña regenerada con éxito.", empleado });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Enviar correo real con credenciales al empleado utilizando Resend
router.post('/enviar-correo/:id', async (req, res) => {
    try {
        const empleado = await Empleado.findById(req.params.id);
        if (!empleado) {
            return res.status(404).json({ exito: false, error: "Empleado no encontrado." });
        }

        const { data, error } = await resend.emails.send({
            from: 'Guardián POS Lite <soporte@guardianpos.mx>',
            to: [empleado.correo],
            subject: 'Tus Credenciales de Acceso - Panel Administrativo Guardián POS',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #2563EB;">¡Hola, ${empleado.nombre}!</h2>
                    <p>Se te han asignado o actualizado tus credenciales de acceso para el Panel Administrativo Central de Guardián POS.</p>
                    <p>Tus datos de acceso son:</p>
                    <div style="background: #F3F4F6; padding: 15px; font-size: 16px; border-radius: 6px; margin: 20px 0;">
                        <p><strong>Usuario ID:</strong> <span style="color: #1E40AF; font-family: monospace;">${empleado.usuarioId}</span></p>
                        <p><strong>Contraseña:</strong> <span style="color: #1E40AF; font-family: monospace;">${empleado.password}</span></p>
                    </div>
                    <p>Por favor, guárdalos en un lugar seguro para ingresar al panel administrativo.</p>
                </div>
            `,
        });

        if (error) {
            console.error('Error devuelto por Resend API al enviar correo de empleado:', error);
            return res.status(500).json({ exito: false, error: 'Error al enviar el correo mediante el servicio de mensajería.' });
        }

        res.json({ 
            exito: true, 
            mensaje: `Correo enviado exitosamente a ${empleado.correo}` 
        });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Eliminar un empleado
router.delete('/:id', async (req, res) => {
    try {
        const empleado = await Empleado.findByIdAndDelete(req.params.id);
        if (!empleado) {
            return res.status(404).json({ exito: false, error: "Empleado no encontrado." });
        }
        res.json({ exito: true, mensaje: "Empleado eliminado correctamente." });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

module.exports = router;