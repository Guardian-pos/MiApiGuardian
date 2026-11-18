const express = require('express');
const router = express.Router();
const Movimiento = require('../models/movimientos');
const Producto = require('../models/Product'); 

// POST: Registrar movimiento financiero (Ventas, Devoluciones y Cuarentena) asociados a un usuario
router.post('/', async (routerReq, routerRes) => {
  console.log('--------------------------------------------------');
  console.log('>>> [BACKEND MONGODB] RECIBIENDO PETICIÓN POST EN /movimientos');
  console.log('>>> [BODY CRUDO RECIBIDO]:', JSON.stringify(routerReq.body, null, 2));
  console.log('--------------------------------------------------');

  try {
    const { tenantId, terminalId, tipoMovimiento, items, usuarioId, nombreUsuario } = routerReq.body;

    // 1. Validaciones básicas de seguridad (incluyendo identidad del cajero)
    if (!tenantId || !tipoMovimiento) {
      console.log('>>> [ERROR BACKEND] Faltan campos obligatorios (tenantId o tipoMovimiento)');
      return routerRes.status(400).json({ 
        exito: false, 
        error: 'Faltan campos obligatorios (tenantId o tipoMovimiento)' 
      });
    }

    if (!usuarioId || !nombreUsuario) {
      console.log('>>> [ERROR BACKEND] Falta la huella digital del usuario (usuarioId o nombreUsuario)');
      return routerRes.status(400).json({ 
        exito: false, 
        error: 'El movimiento debe estar asociado obligatoriamente a un operador' 
      });
    }

    // 2. Procesamiento de inventarios basado en tenantId y tipo de movimiento
    if (tipoMovimiento === 'venta' && Array.isArray(items)) {
      console.log(`>>> [INVENTARIO] Procesando VENTA de [${nombreUsuario}] (${terminalId || 'Sin Terminal'}) con ${items.length} ítems. Descontando stock...`);
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
      console.log(`>>> [INVENTARIO] Procesando DEVOLUCIÓN DE ADMIN de [${nombreUsuario}] con ${items.length} ítems. Reponiendo stock...`);
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
      console.log(`>>> [CUARENTENA ANTIFRAUDE] Procesando DEVOLUCIÓN EN CUARENTENA de [${nombreUsuario}] con ${items.length} ítems.`);
      for (let item of items) {
        console.log(`- Ítems retenidos en cuarentena: [${item.codigoBarras}] ${item.nombre} x ${item.cantidad}`);
      }
    }

    // 3. Guardar el movimiento en la base de datos con la huella digital completa
    console.log('>>> [DB] Guardando el documento del movimiento para el operador:', nombreUsuario);
    const nuevoMovimiento = new Movimiento(routerReq.body);
    await nuevoMovimiento.save();
    console.log('>>> [ÉXITO] Movimiento guardado correctamente en la colección con su respectivo usuario.');

    routerRes.status(201).json({ 
      exito: true, 
      mensaje: 'Transacción registrada, operador identificado e inventario sincronizado con éxito' 
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
// FUNCIÓN AUXILIAR: Ecuación Antifraude (Resta devoluciones previas a un ticket)
// =========================================================================
async function aplicarEcuacionAntifraude(tenantId, ticketVenta) {
  let ticketObj = ticketVenta.toObject ? ticketVenta.toObject() : { ...ticketVenta };
  
  const devolucionesPrevias = await Movimiento.find({ 
    tenantId: tenantId.trim().toLowerCase(), 
    folioTicket: ticketObj.folioTicket.trim(),
    tipoMovimiento: { $in: ['devolucion', 'devolucion_cuarentena'] }
  });

  if (devolucionesPrevias && devolucionesPrevias.length > 0) {
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

      return {
        ...itemOriginal,
        cantidad: cantidadRestante,
        cantidadComprada: cantidadRestante,
        cantidadYaDevuelta: cantidadDevueltaAcumulada
      };
    });
  }
  return ticketObj;
}

// =========================================================================
// GET: Buscar un ticket específico por su folio
// =========================================================================
router.get('/ticket/:tenantId/:folio', async (routerReq, routerRes) => {
  try {
    const { tenantId, folio } = routerReq.params;
    console.log(`>>> [BUSCAR TICKET] Buscando ticket para tenant [${tenantId}] con folio [${folio}]`);

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

    const ticketProcesado = await aplicarEcuacionAntifraude(tenantId, ticketVenta);
    routerRes.json({ 
      exito: true, 
      data: ticketProcesado 
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
// GET: Consultar ventas/tickets por un rango de fechas (CON ANTIFRAUDE)
// =========================================================================
router.get('/rango-fechas/:tenantId', async (routerReq, routerRes) => {
  try {
    const { tenantId } = routerReq.params;
    const { inicio, fin } = routerReq.query;

    if (!inicio || !fin) {
      return routerRes.status(400).json({ 
        exito: false, 
        error: 'Faltan los parámetros de fecha inicio y fin' 
      });
    }

    const ticketsEncontrados = await Movimiento.find({
      tenantId: tenantId.trim().toLowerCase(),
      tipoMovimiento: 'venta',
      fechaEmision: {
        $gte: new Date(inicio),
        $lte: new Date(fin)
      }
    }).sort({ fechaEmision: -1 });

    const ticketsProcesados = [];
    for (let ticket of ticketsEncontrados) {
      const ticketConDescuento = await aplicarEcuacionAntifraude(tenantId, ticket);
      ticketsProcesados.push(ticketConDescuento);
    }

    routerRes.json({ 
      exito: true, 
      data: ticketsProcesados 
    });
  } catch (error) {
    console.error('>>> [ERROR AL CONSULTAR RANGO DE FECHAS]:', error);
    routerRes.status(500).json({ 
      exito: false, 
      error: error.message 
    });
  }
});

// =========================================================================
// GET: Consultar historial de movimientos (Con filtro opcional por cajero/usuario)
// =========================================================================
router.get('/:tenantId', async (routerReq, routerRes) => {
  try {
    const { tenantId } = routerReq.params;
    const { usuarioId, rol } = routerReq.query;

    let filtro = { tenantId: tenantId.trim().toLowerCase() };

    // Si es un empleado, limitamos los movimientos estrictamente a su ID para proteger los financieros
    if (rol && rol.toLowerCase() !== 'administrador' && usuarioId) {
      filtro.usuarioId = usuarioId;
      console.log(`>>> [FILTRO MOVIMIENTOS] Aplicando aislamiento para cajero ID: [${usuarioId}]`);
    } else {
      console.log(`>>> [FILTRO MOVIMIENTOS] Vista global de movimientos para Administrador`);
    }

    const movimientos = await Movimiento.find(filtro).sort({ fechaEmision: -1 });
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