const express = require('express');
const router = express.Router();
const Movimiento = require('../models/movimientos');
const Producto = require('../models/Product'); // ➔ Importamos el modelo de productos para actualizar stock

// POST: Registrar movimiento financiero (Enfocado en Ventas y Devoluciones con actualización de stock)
router.post('/', async (routerReq, routerRes) => {
  try {
    const { tenantId, terminalId, tipoMovimiento, items } = routerReq.body;

    // 1. Validaciones básicas de seguridad
    if (!tenantId || !tipoMovimiento) {
      return routerRes.status(400).json({ 
        exito: false, 
        error: 'Faltan campos obligatorios (tenantId o tipoMovimiento)' 
      });
    }

    // 2. Procesamiento de inventarios según el tipo de movimiento
    if (tipoMovimiento === 'venta' && Array.isArray(items)) {
      for (let item of items) {
        // Descontamos del stock la cantidad vendida
        await Producto.findOneAndUpdate(
          { tenantId, codigoBarras: item.codigoBarras },
          { $inc: { existencia: -item.cantidad } }
        );
      }
    } else if (tipoMovimiento === 'devolucion' && Array.isArray(items)) {
      for (let item of items) {
        // Devolvemos al stock la cantidad retornada
        await Producto.findOneAndUpdate(
          { tenantId, codigoBarras: item.codigoBarras },
          { $inc: { existencia: item.cantidad } }
        );
      }
    } 
    // =========================================================================
    // ➔ COMENTARIO FUTURO: Aquí irán validaciones o ajustes para entradas/salidas de caja o cortes
    // =========================================================================

    // 3. Guardar el movimiento en la base de datos
    const nuevoMovimiento = new Movimiento(routerReq.body);
    await nuevoMovimiento.save();

    routerRes.status(201).json({ 
      exito: true, 
      mensaje: 'Transacción registrada e inventario sincronizado con éxito' 
    });

  } catch (error) {
    console.error('Error al registrar movimiento y actualizar stock en backend:', error);
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