const express = require('express');
const router = express.Router();
const Movimiento = require('../models/movimientos');
const Producto = require('../models/Product'); // ➔ Modelo de productos para la actualización de stock

// POST: Registrar movimiento financiero (Ventas y Devoluciones con sincronización de inventario)
router.post('/', async (routerReq, routerRes) => {
  console.log('--------------------------------------------------');
  console.log('>>> [BACKEND MONGODB] RECIBIENDO PETICIÓN POST EN /movimientos');
  console.log('>>> [BODY CRUDO RECIBIDO]:', JSON.stringify(routerReq.body, null, 2));
  console.log('--------------------------------------------------');

  try {
    const { tenantId, terminalId, tipoMovimiento, items } = routerReq.body;

    // 1. Validaciones básicas de seguridad
    if (!tenantId || !tipoMovimiento) {
      console.log('>>> [ERROR BACKEND] Faltan campos obligatorios (tenantId o tipoMovimiento)');
      return routerRes.status(400).json({ 
        exito: false, 
        error: 'Faltan campos obligatorios (tenantId o tipoMovimiento)' 
      });
    }

    // 2. Procesamiento de inventarios basado estrictamente en tenantId y codigoBarras
    if (tipoMovimiento === 'venta' && Array.isArray(items)) {
      console.log(`>>> [INVENTARIO] Procesando VENTA con ${items.length} ítems. Descontando stock...`);
      for (let item of items) {
        console.log(`>>> Buscando producto - Tenant: [${tenantId}] | Código de Barras: [${item.codigoBarras}] | Cantidad a descontar: ${item.cantidad}`);
        
        const productoActualizado = await Producto.findOneAndUpdate(
          { tenantId: tenantId, codigoBarras: item.codigoBarras },
          { $inc: { existencia: -item.cantidad } },
          { new: true }
        );

        if (!productoActualizado) {
          console.log(`>>> [AVISO] No se encontró el producto con código de barras [${item.codigoBarras}] para descontar stock.`);
        } else {
          console.log(`>>> [STOCK ACTUALIZADO] Producto: ${productoActualizado.nombre} | Nueva existencia: ${productoActualizado.existencia}`);
        }
      }
    } else if (tipoMovimiento === 'devolucion' && Array.isArray(items)) {
      console.log(`>>> [INVENTARIO] Procesando DEVOLUCIÓN con ${items.length} ítems. Reponiendo stock...`);
      for (let item of items) {
        console.log(`>>> Buscando producto - Tenant: [${tenantId}] | Código de Barras: [${item.codigoBarras}] | Cantidad a reponer: ${item.cantidad}`);
        
        const productoActualizado = await Producto.findOneAndUpdate(
          { tenantId: tenantId, codigoBarras: item.codigoBarras },
          { $inc: { existencia: item.cantidad } },
          { new: true }
        );

        if (!productoActualizado) {
          console.log(`>>> [AVISO] No se encontró el producto con código de barras [${item.codigoBarras}] para reponer stock.`);
        } else {
          console.log(`>>> [STOCK RESTAURADO] Producto: ${productoActualizado.nombre} | Nueva existencia: ${productoActualizado.existencia}`);
        }
      }
    } 

    // 3. Guardar el movimiento en la base de datos (con su propio identificador único de venta)
    console.log('>>> [DB] Guardando el documento del movimiento en MongoDB Atlas...');
    const nuevoMovimiento = new Movimiento(routerReq.body);
    await nuevoMovimiento.save();
    console.log('>>> [ÉXITO] Movimiento guardado correctamente en la colección de movimientos.');

    routerRes.status(201).json({ 
      exito: true, 
      mensaje: 'Transacción registrada e inventario sincronizado con éxito' 
    });

  } catch (error) {
    console.error('>>> [ERROR CRÍTICO EN BACKEND]:', error);
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
    console.log(`>>> [GET] Consultando movimientos para el tenant: ${tenantId}`);
    
    const movimientos = await Movimiento.find({ tenantId }).sort({ fechaEmision: -1 });
    routerRes.json({ 
      exito: true, 
      data: movimientos 
    });
  } catch (error) {
    console.error('>>> [ERROR AL CONSULTAR MOVIMIENTOS]:', error);
    routerRes.status(500).json({ 
      exito: false, 
      error: error.message 
    });
  }
});

module.exports = router;