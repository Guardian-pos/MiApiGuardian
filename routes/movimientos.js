const express = require('express');
const router = express.Router();
const Movimiento = require('../models/movimientos');

// POST: Registrar cualquier movimiento financiero (Ventas, Devoluciones, Entradas/Salidas, Cortes de Caja)
router.post('/', async (routerReq, routerRes) => {
  try {
    const nuevoMovimiento = new Movimiento(routerReq.body);
    await nuevoMovimiento.save();
    routerRes.status(201).json({ 
      exito: true, 
      mensaje: 'Movimiento/Transacción registrado correctamente en MongoDB' 
    });
  } catch (error) {
    console.error('Error al registrar movimiento en backend:', error);
    routerRes.status(500).json({ 
      exito: false, 
      error: error.message 
    });
  }
});

// GET: Consultar el historial de movimientos de una sucursal/tenant específico
router.get('/:tenantId', async (routerReq, routerRes) => {
  try {
    const { tenantId } = routerReq.params;
    const movimientos = await Movimiento.find({ tenantId }).sort({ fechaEmision: -1 });
    routerRes.json({ 
      exito: true, 
      data: movimientos 
    });
  } catch (error) {
    console.error('Error al consultar movimientos:', error);
    routerRes.status(500).json({ 
      exito: false, 
      error: error.message 
    });
  }
});

module.exports = router;