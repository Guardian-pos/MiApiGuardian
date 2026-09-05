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

module.exports = router;