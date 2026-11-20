const express = require('express');
const router = express.Router();
const { Resend } = require('resend'); // [CAMBIO] Cliente Resend para enviar reporte del corte de caja
const Movimiento = require('../models/movimientos');
const Producto = require('../models/Product');
const Licencia = require('../models/Licencia'); // [CAMBIO] Modelo Licencia para obtener correo y nombre del negocio

// [CAMBIO] Inicialización de Resend usando la variable de entorno RESEND_API_KEY
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// [CAMBIO] Helper para formatear fechas de inicio y cierre en zona horaria de México
function formatearFechaMexico(fechaValor) {
  try {
    const fecha = fechaValor instanceof Date ? fechaValor : new Date(fechaValor);
    if (Number.isNaN(fecha.getTime())) return 'N/D';
    return fecha.toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (_) {
    return 'N/D';
  }
}

// [CAMBIO] Helper para formatear moneda en MXN
function formatearMoneda(valor) {
  const num = Number(valor || 0);
  return `$${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// [CAMBIO] Envía el correo con el resumen del corte, contador acumulado en cuarentena y folios del corte actual
async function enviarCorreoCorteCaja({
  cleanTenantId,
  documentoCorte,
  foliosCuarentenaCorte,
  totalPendientesCuarentena,
}) {
  if (!resend) {
    console.warn('>>> [CORREO CORTE] RESEND_API_KEY no configurada; se omite el envío de correo.');
    return { enviado: false, motivo: 'RESEND_API_KEY no configurada' };
  }

  const regexTenant = new RegExp(`^${cleanTenantId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const licencia = await Licencia.findOne({ 'client.numero_cliente': regexTenant });

  const correoDestino = licencia?.client?.correo ? String(licencia.client.correo).trim() : '';
  if (!correoDestino) {
    console.warn(`>>> [CORREO CORTE] No se encontró correo registrado para el tenant [${cleanTenantId}].`);
    return { enviado: false, motivo: 'Sin correo registrado en licencia' };
  }

  const nombreNegocio = licencia?.client?.nombre_negocio
    ? String(licencia.client.nombre_negocio).trim()
    : cleanTenantId.toUpperCase();

  const ventasSistema = Number(documentoCorte.ventasTotalesSistema || 0);
  const devoluciones = Number(documentoCorte.totalDevoluciones || 0);
  const entradas = Number(documentoCorte.totalEntradas || 0);
  const salidas = Number(documentoCorte.totalSalidas || 0);
  const efectivoEsperado = ventasSistema - devoluciones - salidas + entradas;
  const efectivoContado = Number(documentoCorte.efectivoContado || 0);
  const diferencia =
    documentoCorte.diferencia !== undefined && documentoCorte.diferencia !== null
      ? Number(documentoCorte.diferencia)
      : efectivoContado - efectivoEsperado;

  const inicioStr = formatearFechaMexico(documentoCorte.fechaInicioTurno);
  const cierreStr = formatearFechaMexico(documentoCorte.fechaCorte || documentoCorte.fechaEmision);

  const acumuladosNum = Number(totalPendientesCuarentena || 0);
  const textoContadorPendientes =
    acumuladosNum === 1
      ? 'Tienes 1 folio pendiente de revisión en cuarentena en tu sucursal.'
      : `Tienes ${acumuladosNum} folios pendientes de revisión en cuarentena en tu sucursal.`;

  const listaCuarentenaHtml =
    Array.isArray(foliosCuarentenaCorte) && foliosCuarentenaCorte.length > 0
      ? `<ul style="margin: 8px 0 0 18px; padding: 0;">${foliosCuarentenaCorte
          .map(
            (q) =>
              `<li style="color: #B91C1C; font-weight: bold; margin-bottom: 4px;">Folio: ${q.folioTicket || 'Sin folio'} — Monto: ${formatearMoneda(q.totalDevolucion)} (Operador: ${q.nombreUsuario || 'N/D'})</li>`
          )
          .join('')}</ul>`
      : `<p style="margin: 6px 0 0 0; color: #374151;">Sin devoluciones en cuarentena registradas en este corte.</p>`;

  const htmlCorreo = `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; color: #1F2937; border: 1px solid #E5E7EB; border-radius: 8px;">
      <!-- [CAMBIO] Espacio reservado para integrar el logotipo más adelante:
      <div style="text-align: center; margin-bottom: 12px;">
        <img src="URL_DEL_LOGOTIPO" alt="Logo" style="max-height: 60px;" />
      </div>
      -->
      <h2 style="margin: 0 0 6px 0; color: #C2410C;">Reporte de Corte de Caja — ${nombreNegocio}</h2>
      <p style="margin: 0 0 16px 0; font-size: 13px; color: #4B5563;">
        Cliente / Sucursal: <strong>${cleanTenantId.toUpperCase()}</strong> | Folio de corte: <strong>${documentoCorte.corteId}</strong>
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px;">
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Cajero y rol:</strong></td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;">${documentoCorte.nombreUsuario} (${documentoCorte.rolUsuario || 'empleado'})</td>
        </tr>
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Terminal:</strong></td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;">${documentoCorte.terminalId}</td>
        </tr>
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Inicio de turno:</strong></td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;">${inicioStr}</td>
        </tr>
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Cierre de turno:</strong></td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;">${cierreStr}</td>
        </tr>
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Ventas:</strong></td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;">${formatearMoneda(ventasSistema)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Devoluciones:</strong></td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;">${formatearMoneda(devoluciones)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Entradas:</strong></td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;">${formatearMoneda(entradas)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Salidas:</strong></td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;">${formatearMoneda(salidas)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Efectivo esperado:</strong></td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;"><strong>${formatearMoneda(efectivoEsperado)}</strong></td>
        </tr>
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Efectivo contado:</strong></td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;"><strong>${formatearMoneda(efectivoContado)}</strong></td>
        </tr>
        <tr>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Diferencia:</strong></td>
          <td style="padding: 6px 8px; border-bottom: 1px solid #F3F4F6;"><strong>${formatearMoneda(diferencia)}</strong></td>
        </tr>
      </table>

      <div style="background: #FEF2F2; border: 1px solid #FCA5A5; border-left: 5px solid #DC2626; padding: 12px 14px; border-radius: 6px; margin-bottom: 18px;">
        <div style="color: #991B1B; font-weight: bold; font-size: 14px; margin-bottom: 6px;">
          ${textoContadorPendientes}
        </div>
        <div style="color: #DC2626; font-weight: bold; font-size: 13px;">
          FOLIOS EN CUARENTENA DE ESTE CORTE (Visita tu panel web para revisar y realizar el reingreso a inventario):
        </div>
        ${listaCuarentenaHtml}
      </div>

      <p style="margin: 16px 0 0 0; font-size: 13px; color: #4B5563;">
        Este cierre de caja llega por cortesía de <strong>Guardián POS</strong>. ¡Gracias por operar con nosotros!
      </p>
    </div>
  `;

  const { error } = await resend.emails.send({
    from: 'Guardián POS <soporte@guardianpos.mx>',
    to: [correoDestino],
    subject: `${nombreNegocio} - Cierre de Caja Actual`, // [CAMBIO] Nombre del negocio seguido de "Cierre de Caja Actual"
    html: htmlCorreo,
  });

  if (error) {
    console.error('>>> [CORREO CORTE] Error devuelto por Resend:', error);
    return { enviado: false, motivo: error.message || 'Error en Resend' };
  }

  console.log(`>>> [CORREO CORTE] Correo enviado exitosamente a ${correoDestino} para corte ${documentoCorte.corteId}`);
  return { enviado: true, destino: correoDestino };
}

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
    const esCuarentena = tipoMovimiento === 'devolucion_cuarentena'; // [CAMBIO] Estado independiente de cuarentena para revisión en panel web
    const nuevoMovimiento = new Movimiento({
      ...routerReq.body,
      tenantId: cleanTenantId,
      usuarioId: cleanUsuarioId,
      nombreUsuario: String(nombreUsuario).trim(),
      rolUsuario: rolUsuario ? String(rolUsuario).trim() : 'empleado',
      abierto: esCorte ? false : (routerReq.body.abierto !== undefined ? Boolean(routerReq.body.abierto) : true),
      cuarentena: esCuarentena ? true : false,
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

    // [CAMBIO] Cierra únicamente los movimientos abiertos de este tenant y este cajero en turno (sin tocar 'cuarentena')
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
      cuarentena: false,
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

    // [CAMBIO] Folios en cuarentena pertenecientes exclusivamente a este corte actual
    const foliosCuarentenaCorte = await Movimiento.find({
      tenantId: cleanTenantId,
      tipoMovimiento: 'devolucion_cuarentena',
      corteId: corteId
    }).sort({ fechaEmision: -1 });

    // [CAMBIO] Contador acumulado total de folios pendientes en cuarentena (cuarentena: true) en la sucursal
    const totalPendientesCuarentena = await Movimiento.countDocuments({
      tenantId: cleanTenantId,
      tipoMovimiento: 'devolucion_cuarentena',
      cuarentena: true
    });

    let resultadoCorreo = { enviado: false };
    try {
      resultadoCorreo = await enviarCorreoCorteCaja({
        cleanTenantId,
        documentoCorte,
        foliosCuarentenaCorte,
        totalPendientesCuarentena,
      });
    } catch (correoErr) {
      console.error('>>> [CORREO CORTE] Excepción al disparar correo:', correoErr);
    }

    routerRes.status(200).json({
      exito: true,
      mensaje: 'Corte de caja registrado y movimientos del turno marcados como cerrados',
      corteId,
      movimientosCerrados: resultadoCierre.modifiedCount || 0,
      totalPendientesCuarentena,
      correoEnviado: resultadoCorreo.enviado === true, // [CAMBIO] Indica si se disparó el correo vía Resend
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
// FUNCIÓN AUXILIAR: Ecuación Antifraude + Estado de Devolución (Verde / Naranja / Rojo)
// =========================================================================
async function aplicarEcuacionAntifraude(tenantId, ticketVenta) {
  let ticketObj = ticketVenta.toObject ? ticketVenta.toObject() : { ...ticketVenta };
  const itemsOriginales = Array.isArray(ticketObj.items) ? ticketObj.items : [];

  let totalOriginalPiezas = 0;
  let totalRestantePiezas = 0;
  let totalDevueltoPiezas = 0;

  const devolucionesPrevias = await Movimiento.find({
    tenantId: tenantId.trim().toLowerCase(),
    folioTicket: ticketObj.folioTicket.trim(),
    tipoMovimiento: { $in: ['devolucion', 'devolucion_cuarentena'] }
  });

  const tieneDevolucionesPrevias = Array.isArray(devolucionesPrevias) && devolucionesPrevias.length > 0;

  ticketObj.items = itemsOriginales.map(itemOriginal => {
    const cantOriginal = Number(itemOriginal.cantidad || 0);
    totalOriginalPiezas += cantOriginal;

    let cantidadDevueltaAcumulada = 0;
    if (tieneDevolucionesPrevias) {
      devolucionesPrevias.forEach(dev => {
        if (Array.isArray(dev.items)) {
          dev.items.forEach(itemDev => {
            if (
              (itemDev.codigoBarras && itemDev.codigoBarras === itemOriginal.codigoBarras) ||
              (itemDev.idProducto && itemDev.idProducto === itemOriginal.idProducto)
            ) {
              cantidadDevueltaAcumulada += Number(itemDev.cantidad || 0);
            }
          });
        }
      });
    }

    const cantidadRestante = Math.max(0, cantOriginal - cantidadDevueltaAcumulada);
    totalRestantePiezas += cantidadRestante;
    totalDevueltoPiezas += Math.min(cantOriginal, cantidadDevueltaAcumulada);

    return {
      ...itemOriginal,
      cantidad: cantidadRestante,
      cantidadComprada: cantidadRestante,
      cantidadOriginal: cantOriginal,
      cantidadYaDevuelta: cantidadDevueltaAcumulada
    };
  });

  // [CAMBIO] Determina estadoDevolucion para el semáforo en Flutter:
  // 'completo' (Rojo) | 'parcial' (Naranja/Amarillo) | 'sin_devolucion' (Verde)
  let estadoDevolucion = 'sin_devolucion';
  if (totalOriginalPiezas > 0 && totalRestantePiezas <= 0) {
    estadoDevolucion = 'completo';
  } else if (totalDevueltoPiezas > 0 || (tieneDevolucionesPrevias && totalRestantePiezas < totalOriginalPiezas)) {
    estadoDevolucion = 'parcial';
  }

  ticketObj.estadoDevolucion = estadoDevolucion;
  ticketObj.totalOriginalPiezas = totalOriginalPiezas;
  ticketObj.totalRestantePiezas = totalRestantePiezas;

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