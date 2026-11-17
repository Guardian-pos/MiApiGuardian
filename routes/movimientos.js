const express = require('express');
const router = express.Router();
const Movimiento = require('../models/movimientos');
const Producto = require('../models/Product'); 

// POST: Registrar movimiento financiero (Ventas, Devoluciones y Cuarentena)
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

    // 2. Procesamiento de inventarios basado en tenantId y tipo de movimiento
    if (tipoMovimiento === 'venta' && Array.isArray(items)) {
      console.log(`>>> [INVENTARIO] Procesando VENTA (${terminalId || 'Sin Terminal'}) con ${items.length} ítems. Descontando stock...`);
      for (let item of items) {
        const productoActualizado = await Producto.findOneAndUpdate(
          { tenantId: tenantId, codigoBarras: item.codigoBarras },
          { $inc: { existencia: -item.cantidad } },
          { new: true }
        );

        if (!productoActualizado) {
          console.log(`>>> [AVISO] No se encontró el producto con código [${item.codigoBarras}] para descontar stock.`);
        } else {
          console.log(`>>> [STOCK ACTUALIZADO] Producto: ${productoActualizado.nombre} | Nueva existencia: ${productoActualizado.existencia}`);
        }
      }
    } else if (tipoMovimiento === 'devolucion' && Array.isArray(items)) {
      // ➔ Devolución de ADMINISTRADOR: Reingresa stock al inventario activo
      console.log(`>>> [INVENTARIO] Procesando DEVOLUCIÓN DE ADMIN (${terminalId || 'Sin Terminal'}) con ${items.length} ítems. Reponiendo stock...`);
      for (let item of items) {
        const productoActualizado = await Producto.findOneAndUpdate(
          { tenantId: tenantId, codigoBarras: item.codigoBarras },
          { $inc: { existencia: item.cantidad } },
          { new: true }
        );

        if (!productoActualizado) {
          console.log(`>>> [AVISO] No se encontró el producto con código [${item.codigoBarras}] para reponer stock.`);
        } else {
          console.log(`>>> [STOCK RESTAURADO] Producto: ${productoActualizado.nombre} | Nueva existencia: ${productoActualizado.existencia}`);
        }
      }
    } else if (tipoMovimiento === 'devolucion_cuarentena' && Array.isArray(items)) {
      // ➔ Devolución de EMPLEADO: Se va a CUARENTENA. NO toca el stock físico.
      console.log(`>>> [CUARENTENA ANTIFRAUDE] Procesando DEVOLUCIÓN EN CUARENTENA (${terminalId || 'Sin Terminal'}) con ${items.length} ítems.`);
      console.log(`>>> [AVISO] El stock físico NO se incrementa automáticamente. Queda pendiente de auditoría web.`);
      for (let item of items) {
        console.log(`- Ítems retenidos en cuarentena: [${item.codigoBarras}] ${item.nombre} x ${item.cantidad}`);
      }
    }

    // 3. Guardar el movimiento en la base de datos (incluyendo terminalId y usuarioId si viene en el body)
    console.log('>>> [DB] Guardando el documento del movimiento con terminalId:', terminalId);
    const nuevoMovimiento = new Movimiento(routerReq.body);
    await nuevoMovimiento.save();
    console.log('>>> [ÉXITO] Movimiento guardado correctamente en la colección de movimientos.');

    routerRes.status(201).json({ 
      exito: true, 
      mensaje: 'Transacción registrada, terminal identificada e inventario sincronizado con éxito' 
    });

  } catch (error) {
    console.error('>>> [ERROR CRÍTICO EN BACKEND]:', error);
    routerRes.status(500).json({ 
      exito: false, 
      error: error.message 
    });
  }
});

// =========================================================================
// GET: Buscar un ticket específico por su tenantId y folio (OBLIGATORIO ANTES DE /:tenantId)
// =========================================================================
router.get('/ticket/:tenantId/:folio', async (routerReq, routerRes) => {
  try {
    const { tenantId, folio } = routerReq.params;
    console.log(`>>> [BUSCAR TICKET] Buscando ticket para tenant [${tenantId}] con folio [${folio}]`);

    const ticketEncontrado = await Movimiento.findOne({ 
      tenantId: tenantId.trim().toLowerCase(), 
      folioTicket: folio.trim(),
      tipoMovimiento: 'venta' 
    });

    if (!ticketEncontrado) {
      console.log(`>>> [BUSCAR TICKET] Ticket no encontrado en MongoDB.`);
      return routerRes.status(404).json({ 
        exito: false, 
        error: 'Ticket no encontrado' 
      });
    }

    console.log(`>>> [BUSCAR TICKET] ¡Ticket encontrado con éxito! Folio: ${ticketEncontrado.folioTicket}`);
    routerRes.json({ 
      exito: true, 
      data: ticketEncontrado 
    });
  } catch (error) {
    console.error('>>> [ERROR AL BUSCAR TICKET]:', error);
    routerRes.status(500).json({ 
      exito: false, 
      error: error.message 
    });
  }
});

// GET: Consultar el historial de movimientos de una sucursal específica
router.get('/:tenantId', async (routerReq, routerRes) => {
  try {
    const { tenantId } = routerReq.params;
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