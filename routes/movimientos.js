const express = require('express');
const router = express.Router();
const Movimiento = require('../models/movimientos');
const Producto = require('../models/Product'); 

// POST: Registrar movimiento financiero (Ventas, Devoluciones, Cuarentena, Entradas/Salidas y Corte) asociados a un usuario
router.post('/', async (routerReq, routerRes) => {
  console.log('--------------------------------------------------');
  console.log('>>> [BACKEND MONGODB] RECIBIENDO PETICIÓN POST EN /movimientos');
  console.log('>>> [BODY CRUDO RECIBIDO]:', JSON.stringify(routerReq.body, null, 2));
  console.log('--------------------------------------------------');

  try {
    const { tenantId, terminalId, tipoMovimiento, items, usuarioId, nombreUsuario, rolUsuario } = routerReq.body;

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

    const cleanTenantId = String(tenantId).trim().toLowerCase(); // [CAMBIO] Normalización consistente de tenantId
    const cleanUsuarioId = String(usuarioId).trim();

    // 2. Procesamiento de inventarios basado en tenantId y tipo de movimiento
    if (tipoMovimiento === 'venta' && Array.isArray(items)) {
      console.log(`>>> [INVENTARIO] Procesando VENTA de [${nombreUsuario}] (${terminalId || 'Sin Terminal'}) con ${items.length} ítems. Descontando stock...`);
      for (let item of items) {
        const productoActualizado = await Producto.findOneAndUpdate(
          { tenantId: cleanTenantId, codigoBarras: item.codigoBarras }, // [CAMBIO] Usa cleanTenantId
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
          { tenantId: cleanTenantId, codigoBarras: item.codigoBarras }, // [CAMBIO] Usa cleanTenantId
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

    // 3. Guardar el movimiento en la base de datos con la huella digital completa y estado de turno
    console.log('>>> [DB] Guardando el documento del movimiento para el operador:', nombreUsuario);
    const esCorte = tipoMovimiento === 'corte_caja'; // [CAMBIO] Un corte_caja nace cerrado; movimientos operativos nacen abiertos
    const nuevoMovimiento = new Movimiento({
      ...routerReq.body,
      tenantId: cleanTenantId,
      usuarioId: cleanUsuarioId,
      nombreUsuario: String(nombreUsuario).trim(),
      rolUsuario: rolUsuario ? String(rolUsuario).trim() : 'empleado',
      abierto: esCorte ? false : (routerReq.body.abierto !== undefined ? Boolean(routerReq.body.abierto) : true),
    });
    await nuevoMovimiento.save();
    console.log('>>> [ÉXITO] Movimiento guardado correctamente en la colección con su respectivo usuario.');

    routerRes.status(201).json({ 
      exito: true, 
      mensaje: 'Transacción registrada, operador identificado e inventario sincronizado con éxito',
      data: nuevoMovimiento
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
// POST: Cerrar turno / corte de caja por usuario y marcar movimientos abiertos como cerrados
// =========================================================================
router.post('/corte-caja', async (routerReq, routerRes) => {
  try {
    const {
      tenantId,
      terminalId,
      usuarioId,
      nombreUsuario,
      rolUsuario,
      fechaInicioTurno,
      efectivoContado,
      ventasTotalesSistema,
      totalDevoluciones,
      totalEntradas,
      totalSalidas,
      diferencia
    } = routerReq.body;

    if (!tenantId || !usuarioId || !nombreUsuario) {
      return routerRes.status(400).json({
        exito: false,
        error: 'Faltan datos obligatorios para el corte de caja (tenantId, usuarioId o nombreUsuario)'
      });
    }

    const cleanTenantId = String(tenantId).trim().toLowerCase();
    const cleanUsuarioId = String(usuarioId).trim();
    const fechaCierre = new Date();
    const corteId = `CORTE-${cleanUsuarioId}-${fechaCierre.getTime()}`;

    // [CAMBIO] Cierra únicamente los movimientos abiertos de este tenant y este cajero en turno
    const resultadoCierre = await Movimiento.updateMany(
      {
        tenantId: cleanTenantId,
        usuarioId: cleanUsuarioId,
        abierto: true,
        tipoMovimiento: { $ne: 'corte_caja' }
      },
      {
        $set: {
          abierto: false,
          corteId,
          fechaCorte: fechaCierre
        }
      }
    );

    const documentoCorte = new Movimiento({
      tenantId: cleanTenantId,
      terminalId: terminalId || 'T1',
      usuarioId: cleanUsuarioId,
      nombreUsuario: String(nombreUsuario).trim(),
      rolUsuario: rolUsuario ? String(rolUsuario).trim() : 'empleado',
      tipoMovimiento: 'corte_caja',
      abierto: false,
      corteId,
      fechaCorte: fechaCierre,
      fechaInicioTurno: fechaInicioTurno ? new Date(fechaInicioTurno) : fechaCierre,
      efectivoContado: Number(efectivoContado || 0),
      ventasTotalesSistema: Number(ventasTotalesSistema || 0),
      totalDevoluciones: Number(totalDevoluciones || 0),
      totalEntradas: Number(totalEntradas || 0),
      totalSalidas: Number(totalSalidas || 0),
      diferencia: Number(diferencia || 0),
      fechaEmision: fechaCierre
    });

    await documentoCorte.save();

    routerRes.status(200).json({
      exito: true,
      mensaje: 'Corte de caja registrado y movimientos del turno marcados como cerrados',
      corteId,
      movimientosCerrados: resultadoCierre.modifiedCount || 0,
      data: documentoCorte
    });
  } catch (error) {
    console.error('>>> [ERROR AL EJECUTAR CORTE DE CAJA]:', error);
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
// GET: Calcular financieros en vivo para el Cierre de Caja (INTEGRADO NUEVO)
// =========================================================================
router.get('/financieros/:tenantId', async (routerReq, routerRes) => {
  try {
    const { tenantId } = routerReq.params;
    const { usuarioId, rol } = routerReq.query;

    console.log(`>>> [FINANCIEROS] Calculando para tenant [${tenantId}], usuario: [${usuarioId}], rol: [${rol}]`);

    // [CAMBIO] Filtra estrictamente por turno abierto (abierto: true) y por el usuarioId en turno
    let filtro = {
      tenantId: tenantId.trim().toLowerCase(),
      abierto: true,
      tipoMovimiento: { $ne: 'corte_caja' }
    };

    if (usuarioId && String(usuarioId).trim().length > 0) {
      filtro.usuarioId = String(usuarioId).trim();
    }

    const movimientos = await Movimiento.find(filtro).sort({ fechaEmision: 1 });

    let totalVentas = 0;
    let devoluciones = 0;
    let entradaEfectivo = 0;
    let salidaEfectivo = 0;

    movimientos.forEach(m => {
      const tipo = (m.tipoMovimiento || '').toLowerCase();
      
      if (tipo === 'venta') {
        totalVentas += Number(m.totalVenta || m.totalOriginal || 0);
      } else if (tipo === 'devolucion' || tipo === 'devolucion_cuarentena') {
        devoluciones += Number(m.totalDevolucion || 0);
      } else if (tipo === 'entrada_caja') {
        entradaEfectivo += Number(m.monto || 0);
      } else if (tipo === 'salida_caja') {
        salidaEfectivo += Number(m.monto || 0);
      }
    });

    // Total final esperado en caja
    const totalFinal = totalVentas - devoluciones - salidaEfectivo + entradaEfectivo;

    let nombreUsuario = 'OPERADOR';
    if (movimientos.length > 0 && movimientos[0].nombreUsuario) {
      nombreUsuario = movimientos[0].nombreUsuario;
    }

    const datosFinancieros = {
      _id: usuarioId || 'turno',
      usuarioId: usuarioId || '',
      nombreUsuario: nombreUsuario,
      rol: rol || 'empleado',
      fechaInicial: movimientos.length > 0 ? movimientos[0].fechaEmision : new Date().toISOString(),
      fechaFinal: new Date().toISOString(),
      totalVentas,
      devoluciones,
      salidaEfectivo,
      entradaEfectivo,
      totalFinal
    };

    routerRes.json({
      exito: true,
      data: datosFinancieros
    });

  } catch (error) {
    console.error('>>> [ERROR AL CALCULAR FINANCIEROS]:', error);
    routerRes.status(500).json({
      exito: false,
      error: error.message
    });
  }
});

// =========================================================================
// GET: Consultar historial de movimientos abiertos del turno actual por cajero
// =========================================================================
router.get('/:tenantId', async (routerReq, routerRes) => {
  try {
    const { tenantId } = routerReq.params;
    const { usuarioId, rol } = routerReq.query;

    // [CAMBIO] Filtra estrictamente movimientos abiertos (abierto: true) del usuario en turno para aislar cajas
    let filtro = {
      tenantId: tenantId.trim().toLowerCase(),
      abierto: true,
      tipoMovimiento: { $ne: 'corte_caja' }
    };

    if (usuarioId && String(usuarioId).trim().length > 0) {
      filtro.usuarioId = String(usuarioId).trim();
      console.log(`>>> [FILTRO MOVIMIENTOS] Aislamiento estricto para cajero ID: [${usuarioId}] (rol: ${rol || 'N/A'})`);
    } else {
      console.log(`>>> [FILTRO MOVIMIENTOS] Sin usuarioId especificado en consulta de turno abierto`);
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