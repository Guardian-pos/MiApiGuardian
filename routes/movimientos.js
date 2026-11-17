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
// GET: Buscar un ticket específico con Ecuación Antifraude de Devoluciones Previas
// =========================================================================
router.get('/ticket/:tenantId/:folio', async (routerReq, routerRes) => {
  try {
    const { tenantId, folio } = routerReq.params;
    console.log(`>>> [BUSCAR TICKET] Buscando ticket para tenant [${tenantId}] con folio [${folio}]`);

    // 1. Buscamos el ticket original de venta
    const ticketVenta = await Movimiento.findOne({ 
      tenantId: tenantId.trim().toLowerCase(), 
      folioTicket: folio.trim(),
      tipoMovimiento: 'venta' 
    });

    if (!ticketVenta) {
      console.log(`>>> [BUSCAR TICKET] Ticket no encontrado en MongoDB.`);
      return routerRes.status(404).json({ 
        exito: false, 
        error: 'Ticket no encontrado' 
      });
    }

    // 2. Buscamos si ya existen devoluciones previas para este mismo folio
    const devolucionesPrevias = await Movimiento.find({ 
      tenantId: tenantId.trim().toLowerCase(), 
      folioTicket: folio.trim(),
      tipoMovimiento: { $in: ['devolucion', 'devolucion_cuarentena'] }
    });

    // 3. Convertimos el documento de Mongoose a objeto plano para aplicar la resta matemática
    let ticketObj = ticketVenta.toObject();

    // 4. Ecuación de descuento: Restamos las cantidades que ya se devolvieron anteriormente
    if (devolucionesPrevias && devolucionesPrevias.length > 0) {
      console.log(`>>> [ANTIFRAUDE] Se encontraron ${devolucionesPrevias.length} devoluciones previas para el folio ${folio}. Aplicando descuento...`);
      
      ticketObj.items = ticketObj.items.map(itemOriginal => {
        let cantidadDevueltaAcumulada = 0;
        
        devolucionesPrevias.forEach(dev => {
          if (Array.isArray(dev.items)) {
            dev.items.forEach(itemDev => {
              if (itemDev.codigoBarras === itemOriginal.codigoBarras || itemDev.idProducto === itemOriginal.idProducto) {
                cantidadDevueltaAcumulada += (itemDev.cantidad || 0);
              }
            });
          }
        });

        const cantidadRestante = Math.max(0, itemOriginal.cantidad - cantidadDevueltaAcumulada);
        console.log(`- Producto [${itemOriginal.nombre}]: Comprado=${itemOriginal.cantidad}, Ya devuelto=${cantidadDevueltaAcumulada}, Disponible para devolver=${cantidadRestante}`);

        return {
          ...itemOriginal,
          cantidad: cantidadRestante, // Sobrescribimos con el saldo real disponible
          cantidadComprada: cantidadRestante, // Sincronizado para el modelo de la app
          cantidadYaDevuelta: cantidadDevueltaAcumulada
        };
      });
    }

    console.log(`>>> [BUSCAR TICKET] ¡Ticket procesado con éxito! Folio: ${ticketObj.folioTicket}`);
    routerRes.json({ 
      exito: true, 
      data: ticketObj 
    });
  } catch (error) {
    console.error('>>> [ERROR AL BUSCAR TICKET]:', error);
    routerRes.status(500).json({ 
      exito: false, 
      error: error.message 
    });
  }
});

// =========================================================================
// GET: Consultar ventas/tickets por un rango de fechas normalizado
// =========================================================================
router.get('/rango-fechas/:tenantId', async (routerReq, routerRes) => {
  try {
    const { tenantId } = routerReq.params;
    const { inicio, fin } = routerReq.query;

    console.log(`>>> [RANGO FECHAS] Consultando para tenant [${tenantId}] del [${inicio}] al [${fin}]`);

    if (!inicio || !fin) {
      return routerRes.status(400).json({ 
        exito: false, 
        error: 'Faltan los parámetros de fecha inicio y fin' 
      });
    }

    // Consultamos en MongoDB los movimientos tipo 'venta' dentro del rango de fechas
    const ticketsEncontrados = await Movimiento.find({
      tenantId: tenantId.trim().toLowerCase(),
      tipoMovimiento: 'venta',
      fechaEmision: {
        $gte: new Date(inicio),
        $lte: new Date(fin)
      }
    }).sort({ fechaEmision: -1 });

    console.log(`>>> [RANGO FECHAS] Se encontraron ${ticketsEncontrados.length} tickets en el rango.`);

    routerRes.json({ 
      exito: true, 
      data: ticketsEncontrados 
    });
  } catch (error) {
    console.error('>>> [ERROR AL CONSULTAR RANGO DE FECHAS]:', error);
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