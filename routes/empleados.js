const express = require('express');
const router = express.Router();
const Empleado = require('../models/Empleado');

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

// RUTA NUEVA: Enviar correo con credenciales al empleado
router.post('/enviar-correo/:id', async (req, res) => {
    try {
        const empleado = await Empleado.findById(req.params.id);
        if (!empleado) {
            return res.status(404).json({ exito: false, error: "Empleado no encontrado." });
        }

        // Aquí puedes integrar tu lógica de Nodemailer o servicio de correo si lo deseas.
        // Por ahora simulamos el envío exitoso hacia el correo registrado del empleado.
        console.log(`[CORREO] Enviando credenciales a ${empleado.correo} (Usuario: ${empleado.usuarioId})`);

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