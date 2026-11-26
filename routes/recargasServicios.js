const express = require('express');
const router = express.Router();
const { Resend } = require('resend'); // [CAMBIO]
const BilleteraTokens = require('../models/BilleteraTokens');
const HistorialTokens = require('../models/HistorialTokens');
const Movimiento = require('../models/movimientos');
const Licencia = require('../models/Licencia'); // [CAMBIO]
const Empleado = require('../models/Empleado'); // [CAMBIO]
const proveedorService = require('../services/proveedorRecargasService');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null; // [CAMBIO]
const TARIFA_SERVICIO_DEFAULT = Number(process.env.TARIFA_FIJA_SERVICIO || 8); // [CAMBIO] Costo por operación $8.00 MXN

// [CAMBIO] Caché en memoria para catálogo dinámico de RTM (30 minutos)
const CACHE_CATALOGO_TTL_MS = 30 * 60 * 1000;
const cacheCatalogo = new Map();

// [CAMBIO] Helpers para correo de abono en horario de México
function formatearFechaMexico(fechaValor) {
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
}

function formatearMoneda(valor) {
  return `$${Number(valor || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function enviarCorreoAbonoTokens({ cleanTenantId, historial, notaReferencia }) {
  if (!resend) return { enviado: false, motivo: 'RESEND_API_KEY no configurada' };

  const regexTenant = new RegExp(`^${cleanTenantId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const licencia = await Licencia.findOne({ 'client.numero_cliente': regexTenant });

  const correoDestino = licencia?.client?.correo ? String(licencia.client.correo).trim() : '';
  if (!correoDestino) return { enviado: false, motivo: 'Cliente sin correo registrado' };

  const nombreNegocio = licencia?.client?.nombre_negocio
    ? String(licencia.client.nombre_negocio).trim()
    : cleanTenantId.toUpperCase();

  const fechaStr = formatearFechaMexico(historial.createdAt || new Date());
  const detalleBono = historial.bolsa === 'RECARGAS'
    ? `Bono aplicado: ${formatearMoneda(historial.bonoAplicado)}`
    : `Tarifa fija: ${formatearMoneda(historial.tarifaFija)}`;

  const htmlCorreo = `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 22px; color: #1F2937; border: 1px solid #E5E7EB; border-radius: 10px;">
      <div style="border-bottom: 3px solid #7C3AED; padding-bottom: 12px; margin-bottom: 18px;">
        <h2 style="margin: 0; color: #7C3AED;">Guardián POS — Confirmación de Saldo</h2>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: #4B5563;">
          Cliente: <strong>${cleanTenantId.toUpperCase()}</strong> | Negocio: <strong>${nombreNegocio}</strong>
        </p>
      </div>

      <p style="font-size: 14px; line-height: 1.5; margin-top: 0;">
        ¡Hola! Tu saldo ha sido abonado correctamente a tu cuenta. Aquí tienes el reporte de tu compra de saldo:
      </p>

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px;">
        <tr><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Fecha y hora:</strong></td><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;">${fechaStr}</td></tr>
        <tr><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Bolsa:</strong></td><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;">${historial.bolsa}</td></tr>
        <tr><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Tipo de movimiento:</strong></td><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;">${historial.tipo}</td></tr>
        <tr><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Monto depositado:</strong></td><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;">${formatearMoneda(historial.montoOperacion)}</td></tr>
        <tr><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Bono / Tarifa:</strong></td><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;">${detalleBono}</td></tr>
        <tr><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Total acreditado:</strong></td><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;"><strong>${formatearMoneda(historial.montoTokens)}</strong></td></tr>
        <tr><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Saldo anterior:</strong></td><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;">${formatearMoneda(historial.saldoAnterior)}</td></tr>
        <tr><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Saldo posterior:</strong></td><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;"><strong style="color: #059669;">${formatearMoneda(historial.saldoPosterior)}</strong></td></tr>
        <tr><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Estado:</strong></td><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;">${historial.estado}</td></tr>
        <tr><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;"><strong>Folio / Referencia:</strong></td><td style="padding: 7px 8px; border-bottom: 1px solid #F3F4F6;">${historial.folioReferencia}${notaReferencia ? ` (${notaReferencia})` : ''}</td></tr>
      </table>

      <p style="margin: 18px 0 0 0; font-size: 13px; color: #4B5563;">
        Este correo fue enviado por cortesía de <strong>Guardián POS</strong>. ¡Gracias por seguir trabajando con nosotros!
      </p>
    </div>
  `;

  const { error } = await resend.emails.send({
    from: 'Guardián POS <soporte@guardianpos.mx>',
    to: [correoDestino],
    subject: `${nombreNegocio} - Abono de Saldo Confirmado (Guardián POS)`,
    html: htmlCorreo,
  });

  if (error) {
    console.error('>>> [CORREO TOKENS ERROR]:', error);
    return { enviado: false, motivo: error.message || 'Error Resend' };
  }

  return { enviado: true, destino: correoDestino };
}

function normalizarTenant(tenantId) {
  return String(tenantId || '').trim().toLowerCase();
}

function generarFolioLite(prefijo, terminalId) {
  const term = String(terminalId || 'T1').trim().toUpperCase();
  return `LITE-${prefijo}-${term}-${Date.now()}`;
}

// =========================================================================
// [CAMBIO] GET: Catálogo dinámico de productos RTM (recargas, servicios, tarjetas, todos)
// =========================================================================
router.get('/catalogo', async (req, res) => {
  try {
    const categoria = String(req.query.categoria || 'todos').trim().toLowerCase();
    const carrier = String(req.query.carrier || '').trim();
    const forzar = String(req.query.forzar || '').toLowerCase() === 'true';

    const cacheKey = `${categoria}|${carrier.toUpperCase()}`;
    const ahora = Date.now();

    if (!forzar && cacheCatalogo.has(cacheKey)) {
      const cached = cacheCatalogo.get(cacheKey);
      if (ahora - cached.timestamp < CACHE_CATALOGO_TTL_MS) {
        return res.json({ exito: true, desdeCache: true, data: cached.data });
      }
    }

    const resultado = await proveedorService.obtenerProductos({ categoria, carrier });
    if (!resultado.exito) {
      return res.status(502).json({
        exito: false,
        error: resultado.mensaje || 'No se pudo obtener el catálogo de RTM.',
      });
    }

    cacheCatalogo.set(cacheKey, { timestamp: ahora, data: resultado });
    return res.json({ exito: true, desdeCache: false, data: resultado });
  } catch (error) {
    console.error('>>> [RTM CATALOGO ERROR]:', error);
    return res.status(500).json({ exito: false, error: error.message });
  }
});

// =========================================================================
// GET: Consultar saldo actual de las dos bolsas por tenantId
// =========================================================================
router.get('/saldo/:tenantId', async (req, res) => {
  try {
    const cleanTenantId = normalizarTenant(req.params.tenantId);
    if (!cleanTenantId) {
      return res.status(400).json({ exito: false, error: 'tenantId es obligatorio' });
    }

    const billetera = await BilleteraTokens.findOne({ tenantId: cleanTenantId });

    return res.json({
      exito: true,
      data: {
        tenantId: cleanTenantId,
        tokensRecargas: billetera ? billetera.tokensRecargas : 0,
        tokensServicios: billetera ? billetera.tokensServicios : 0,
        tarifaFijaServicio: TARIFA_SERVICIO_DEFAULT,
        activo: billetera ? billetera.activo : true,
      },
    });
  } catch (error) {
    console.error('>>> [TOKENS SALDO ERROR]:', error);
    return res.status(500).json({ exito: false, error: error.message });
  }
});

// =========================================================================
// [CAMBIO] GET: Consultar estatus de una operación por folio / idempotencyKey (RTM)
// =========================================================================
router.get('/estatus/:folio', async (req, res) => {
  try {
    const folio = String(req.params.folio || '').trim();
    if (!folio) {
      return res.status(400).json({ exito: false, error: 'folio es obligatorio' });
    }

    const registro = await HistorialTokens.findOne({ folioReferencia: folio }).sort({ createdAt: -1 });
    if (!registro) {
      return res.status(404).json({ exito: false, error: 'Operación no encontrada' });
    }

    return res.json({
      exito: true,
      data: {
        folioReferencia: registro.folioReferencia,
        bolsa: registro.bolsa,
        tipo: registro.tipo,
        estado: registro.estado,
        montoOperacion: registro.montoOperacion,
        autorizacion: registro.proveedorRespuesta?.autorizacion || '',
        mensaje: registro.proveedorRespuesta?.mensaje || '',
        createdAt: registro.createdAt,
      },
    });
  } catch (error) {
    console.error('>>> [TOKENS ESTATUS ERROR]:', error);
    return res.status(500).json({ exito: false, error: error.message });
  }
});

// =========================================================================
// GET: Consultar historial de movimientos de tokens por tenantId
// =========================================================================
router.get('/historial/:tenantId', async (req, res) => {
  try {
    const cleanTenantId = normalizarTenant(req.params.tenantId);
    const { bolsa, limite = 50 } = req.query;

    const filtro = { tenantId: cleanTenantId };
    if (bolsa && ['RECARGAS', 'SERVICIOS'].includes(String(bolsa).toUpperCase())) {
      filtro.bolsa = String(bolsa).toUpperCase();
    }

    const registros = await HistorialTokens.find(filtro)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limite) || 50, 200));

    return res.json({ exito: true, data: registros });
  } catch (error) {
    console.error('>>> [TOKENS HISTORIAL ERROR]:', error);
    return res.status(500).json({ exito: false, error: error.message });
  }
});

// =========================================================================
// POST: Abonar saldo desde el Panel Admin (Validación de Empleado + Correo)
// =========================================================================
router.post('/abonar', async (req, res) => {
  try {
    const {
      tenantId,
      confirmarCliente, // [CAMBIO] Validación cruzada de número de cliente
      bolsa,
      montoDeposito,
      bonoPorcentaje = 0,
      adminId,
      nombreAdmin = 'Administrador',
      nota = '',
    } = req.body;

    const cleanTenantId = normalizarTenant(tenantId);
    const cleanAdminId = String(adminId || '').trim();

    // [CAMBIO] Validar permiso real del empleado en MongoDB
    if (!cleanAdminId) {
      return res.status(401).json({ exito: false, error: 'Operador no identificado.' });
    }
    if (cleanAdminId !== 'EMP-ADMIN') {
      const empleado = await Empleado.findOne({ usuarioId: cleanAdminId });
      if (!empleado || !empleado.permisos?.tokens) {
        return res.status(403).json({
          exito: false,
          error: 'No tienes permiso para abonar tokens. Solicita acceso a tu supervisor.',
        });
      }
    }

    // [CAMBIO] Validar que confirmarCliente coincida con tenantId si fue enviado
    if (!confirmarCliente || normalizarTenant(confirmarCliente) !== cleanTenantId) {
      return res.status(400).json({
        exito: false,
        error: 'El número de cliente confirmado no coincide con el cliente seleccionado.',
      });
    }

    const bolsaUpper = String(bolsa || '').toUpperCase();
    const montoNum = Number(montoDeposito);

    if (!cleanTenantId || !['RECARGAS', 'SERVICIOS'].includes(bolsaUpper)) {
      return res.status(400).json({ exito: false, error: 'tenantId y bolsa (RECARGAS o SERVICIOS) son obligatorios' });
    }
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return res.status(400).json({ exito: false, error: 'montoDeposito debe ser mayor a 0' });
    }

    const porcentajeAplicado = bolsaUpper === 'RECARGAS' ? Math.max(0, Number(bonoPorcentaje || 0)) : 0;
    const bonoCalculado = Number(((montoNum * porcentajeAplicado) / 100).toFixed(2));
    const totalTokensAbonar = Number((montoNum + bonoCalculado).toFixed(2));

    const campoBolsa = bolsaUpper === 'RECARGAS' ? 'tokensRecargas' : 'tokensServicios';
    const campoAcumulado = bolsaUpper === 'RECARGAS' ? 'totalAbonadoRecargas' : 'totalAbonadoServicios';

    const billeteraActualizada = await BilleteraTokens.findOneAndUpdate(
      { tenantId: cleanTenantId },
      {
        $inc: {
          [campoBolsa]: totalTokensAbonar,
          [campoAcumulado]: totalTokensAbonar,
        },
        $setOnInsert: { tenantId: cleanTenantId, activo: true },
      },
      { new: true, upsert: true }
    );

    const saldoPosterior = billeteraActualizada[campoBolsa];
    const saldoAnterior = Number((saldoPosterior - totalTokensAbonar).toFixed(2));
    const notaLimpia = String(nota || '').trim();

    const historial = await HistorialTokens.create({
      tenantId: cleanTenantId,
      terminalId: 'PANEL',
      usuarioId: cleanAdminId,
      nombreUsuario: String(nombreAdmin).trim(),
      bolsa: bolsaUpper,
      tipo: 'ABONO_ADMIN',
      montoOperacion: montoNum,
      bonoAplicado: bonoCalculado,
      tarifaFija: 0,
      montoTokens: totalTokensAbonar,
      saldoAnterior,
      saldoPosterior,
      estado: 'EXITOSO',
      folioReferencia: generarFolioLite('ABONO', 'PANEL'),
      detalleOperacion: { nota: notaLimpia },
      proveedorRespuesta: { simulado: false, codigo: 'ADMIN', mensaje: 'Abono acreditado' },
    });

    // [CAMBIO] Disparar correo de confirmación al cliente
    let resultadoCorreo = { enviado: false };
    try {
      resultadoCorreo = await enviarCorreoAbonoTokens({
        cleanTenantId,
        historial,
        notaReferencia: notaLimpia,
      });
    } catch (errCorreo) {
      console.error('>>> [CORREO TOKENS EXCEPCIÓN]:', errCorreo);
    }

    return res.status(201).json({
      exito: true,
      mensaje: `Abono acreditado en ${bolsaUpper}: $${totalTokensAbonar} tokens`,
      correoEnviado: resultadoCorreo.enviado === true,
      data: {
        billetera: billeteraActualizada,
        historial,
      },
    });
  } catch (error) {
    console.error('>>> [TOKENS ABONO ERROR]:', error);
    return res.status(500).json({ exito: false, error: error.message });
  }
});

// =========================================================================
// POST: Cobrar Recarga Electrónica (Descuento atómico -> Proveedor -> Movimiento 'recarga' o Reembolso)
// =========================================================================
router.post('/cobrar-recarga', async (req, res) => {
  try {
    const {
      tenantId,
      terminalId = 'T1',
      usuarioId,
      nombreUsuario,
      rolUsuario = 'empleado',
      compania,
      numeroTelefono,
      monto,
      comisionCliente = 0, // [CAMBIO] Comisión cobrada al cliente final
      folioTicket,
      idempotencyKey, // [CAMBIO] Control anti-duplicados RTM
      simularModo = 'OK', // Para pruebas en mock: 'OK' | 'ERROR' | 'TIMEOUT'
    } = req.body;

    const cleanTenantId = normalizarTenant(tenantId);
    const montoNum = Number(monto);
    const comisionNum = Math.max(0, Number(comisionCliente || 0)); // [CAMBIO]
    const totalCobradoCaja = Number((montoNum + comisionNum).toFixed(2)); // [CAMBIO]

    if (!cleanTenantId || !usuarioId || !nombreUsuario || !compania || !numeroTelefono) {
      return res.status(400).json({
        exito: false,
        error: 'Faltan campos obligatorios (tenantId, usuarioId, nombreUsuario, compania, numeroTelefono)',
      });
    }
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return res.status(400).json({ exito: false, error: 'El monto de la recarga debe ser mayor a 0' });
    }

    // [CAMBIO] Folio único priorizando idempotencyKey / folioTicket para evitar recargas duplicadas
    const folioRef = idempotencyKey
      ? String(idempotencyKey).trim()
      : (folioTicket ? String(folioTicket).trim() : generarFolioLite('REC', terminalId));

    const operacionPrevia = await HistorialTokens.findOne({
      tenantId: cleanTenantId,
      folioReferencia: folioRef,
    });
    if (operacionPrevia) {
      if (operacionPrevia.estado === 'EXITOSO') {
        const billeteraActual = await BilleteraTokens.findOne({ tenantId: cleanTenantId });
        return res.status(200).json({
          exito: true,
          duplicadoEvitado: true,
          mensaje: 'Operación ya procesada anteriormente.',
          data: {
            folioTicket: folioRef,
            autorizacion: operacionPrevia.proveedorRespuesta?.autorizacion || '',
            simulado: operacionPrevia.proveedorRespuesta?.simulado ?? true,
            saldoRestanteRecargas: billeteraActual ? billeteraActual.tokensRecargas : 0,
          },
        });
      }
      return res.status(409).json({
        exito: false,
        error: 'Esta operación ya fue intentada y falló. Genere un nuevo intento.',
      });
    }

    // 1. Validación y descuento ATÓMICO en MongoDB ($gte)
    const billeteraDescontada = await BilleteraTokens.findOneAndUpdate(
      {
        tenantId: cleanTenantId,
        activo: true,
        tokensRecargas: { $gte: montoNum },
      },
      { $inc: { tokensRecargas: -montoNum } },
      { new: true }
    );

    if (!billeteraDescontada) {
      return res.status(400).json({
        exito: false,
        codigo: 'SALDO_INSUFICIENTE',
        error: 'Saldo insuficiente en tokens de recargas para realizar esta operación.',
      });
    }

    const saldoTrasDescuento = billeteraDescontada.tokensRecargas;
    const saldoInicial = Number((saldoTrasDescuento + montoNum).toFixed(2));

    // 2. Disparar al proveedor (RTM SOAP 1.2 o mock)
    let respProveedor;
    try {
      respProveedor = await proveedorService.ejecutarRecarga({
        folioReferencia: folioRef,
        compania: String(compania).trim(),
        numeroTelefono: String(numeroTelefono).trim(),
        monto: montoNum,
        simularModo,
      });
    } catch (errProv) {
      respProveedor = {
        exito: false,
        simulado: process.env.RECARGAS_MODO_MOCK !== 'false',
        codigo: 'EXCEPCION_PROVEEDOR',
        mensaje: errProv.message || 'Error de conexión con el proveedor',
        autorizacion: '',
      };
    }

    // 3A. Si FALLA o hace TIMEOUT -> Reembolsar automáticamente y NO registrar movimiento
    if (!respProveedor.exito) {
      const billeteraReembolsada = await BilleteraTokens.findOneAndUpdate(
        { tenantId: cleanTenantId },
        { $inc: { tokensRecargas: montoNum } },
        { new: true }
      );

      await HistorialTokens.create({
        tenantId: cleanTenantId,
        terminalId,
        usuarioId: String(usuarioId).trim(),
        nombreUsuario: String(nombreUsuario).trim(),
        bolsa: 'RECARGAS',
        tipo: 'REEMBOLSO_AUTO',
        montoOperacion: montoNum,
        montoTokens: 0, // Neto 0 tras descuento + reembolso automático
        saldoAnterior: saldoInicial,
        saldoPosterior: billeteraReembolsada ? billeteraReembolsada.tokensRecargas : saldoInicial,
        estado: 'FALLIDO_REEMBOLSADO',
        folioReferencia: folioRef,
        detalleOperacion: {
          compania: String(compania).trim(),
          numeroTelefono: String(numeroTelefono).trim(),
        },
        proveedorRespuesta: respProveedor,
      });

      return res.status(502).json({
        exito: false,
        reembolsado: true,
        error: respProveedor.mensaje || 'El proveedor rechazó la recarga; tus tokens fueron reembolsados.',
        saldoActual: billeteraReembolsada ? billeteraReembolsada.tokensRecargas : saldoInicial,
      });
    }

    // 3B. Si ÉXITO -> Registrar movimiento como 'recarga' (abierto: true para Cierre de Caja)
    const movimientoVenta = await Movimiento.create({
      tenantId: cleanTenantId,
      terminalId: String(terminalId).trim(),
      usuarioId: String(usuarioId).trim(),
      nombreUsuario: String(nombreUsuario).trim(),
      rolUsuario: String(rolUsuario).trim(),
      tipoMovimiento: 'recarga', // [CAMBIO] Separado de 'venta' para Cierre de Caja
      abierto: true,
      cuarentena: false,
      folioTicket: folioRef,
      totalOriginal: totalCobradoCaja, // [CAMBIO] Incluye comisión si se configuró
      totalVenta: totalCobradoCaja,    // [CAMBIO]
      items: [
        {
          idProducto: `REC-${String(compania).trim().toUpperCase()}`,
          codigoBarras: `REC-${String(compania).trim().toUpperCase()}`,
          nombre: `Recarga ${compania} (${numeroTelefono})`,
          cantidad: 1,
          precioUnitario: totalCobradoCaja, // [CAMBIO]
          tipoPrecioAplicado: 'SERVICIO',
          subtotal: totalCobradoCaja,       // [CAMBIO]
          costoUnitario: montoNum,
        },
      ],
    });

    await HistorialTokens.create({
      tenantId: cleanTenantId,
      terminalId,
      usuarioId: String(usuarioId).trim(),
      nombreUsuario: String(nombreUsuario).trim(),
      bolsa: 'RECARGAS',
      tipo: 'COBRO_RECARGA',
      montoOperacion: montoNum,
      montoTokens: -montoNum,
      saldoAnterior: saldoInicial,
      saldoPosterior: saldoTrasDescuento,
      estado: 'EXITOSO',
      folioReferencia: folioRef,
      detalleOperacion: {
        compania: String(compania).trim(),
        numeroTelefono: String(numeroTelefono).trim(),
      },
      proveedorRespuesta: respProveedor,
      movimientoId: movimientoVenta._id,
    });

    return res.status(201).json({
      exito: true,
      mensaje: respProveedor.mensaje,
      data: {
        folioTicket: folioRef,
        autorizacion: respProveedor.autorizacion,
        simulado: respProveedor.simulado,
        saldoRestanteRecargas: saldoTrasDescuento,
        movimiento: movimientoVenta,
      },
    });
  } catch (error) {
    console.error('>>> [COBRAR RECARGA ERROR]:', error);
    return res.status(500).json({ exito: false, error: error.message });
  }
});

// =========================================================================
// POST: Cobrar Pago de Servicio (Monto + Tarifa Fija -> Proveedor -> Movimiento 'servicio' o Reembolso)
// =========================================================================
router.post('/cobrar-servicio', async (req, res) => {
  try {
    const {
      tenantId,
      terminalId = 'T1',
      usuarioId,
      nombreUsuario,
      rolUsuario = 'empleado',
      nombreServicio,
      referenciaServicio,
      telefonoCliente = '', // [CAMBIO] Requerido por RTM (<Phone> 10 dígitos)
      emailCliente = '',    // [CAMBIO] Requerido por RTM (<Email> comprobante)
      montoRecibo,
      comisionCliente, // Opcional: lo que el negocio cobra al cliente final en caja (default = tarifaFija)
      folioTicket,
      idempotencyKey, // [CAMBIO] Control anti-duplicados RTM
      simularModo = 'OK',
    } = req.body;

    const cleanTenantId = normalizarTenant(tenantId);
    const montoReciboNum = Number(montoRecibo);
    const tarifaFija = TARIFA_SERVICIO_DEFAULT;

    if (!cleanTenantId || !usuarioId || !nombreUsuario || !nombreServicio || !referenciaServicio) {
      return res.status(400).json({
        exito: false,
        error: 'Faltan campos obligatorios (tenantId, usuarioId, nombreUsuario, nombreServicio, referenciaServicio)',
      });
    }
    if (!Number.isFinite(montoReciboNum) || montoReciboNum <= 0) {
      return res.status(400).json({ exito: false, error: 'montoRecibo debe ser mayor a 0' });
    }

    // [CAMBIO] Folio único priorizando idempotencyKey / folioTicket para evitar pagos duplicados
    const folioRef = idempotencyKey
      ? String(idempotencyKey).trim()
      : (folioTicket ? String(folioTicket).trim() : generarFolioLite('SERV', terminalId));

    const operacionPrevia = await HistorialTokens.findOne({
      tenantId: cleanTenantId,
      folioReferencia: folioRef,
    });
    if (operacionPrevia) {
      if (operacionPrevia.estado === 'EXITOSO') {
        const billeteraActual = await BilleteraTokens.findOne({ tenantId: cleanTenantId });
        return res.status(200).json({
          exito: true,
          duplicadoEvitado: true,
          mensaje: 'Pago de servicio ya procesado anteriormente.',
          data: {
            folioTicket: folioRef,
            autorizacion: operacionPrevia.proveedorRespuesta?.autorizacion || '',
            codigoPin: operacionPrevia.proveedorRespuesta?.codigoPin || '', // [CAMBIO]
            simulado: operacionPrevia.proveedorRespuesta?.simulado ?? true,
            tarifaAplicada: tarifaFija,
            saldoRestanteServicios: billeteraActual ? billeteraActual.tokensServicios : 0,
          },
        });
      }
      return res.status(409).json({
        exito: false,
        error: 'Esta operación ya fue intentada y falló. Genere un nuevo intento.',
      });
    }

    const totalDescontarTokens = Number((montoReciboNum + tarifaFija).toFixed(2));
    const comisionVenta = comisionCliente !== undefined ? Math.max(0, Number(comisionCliente)) : tarifaFija;
    const totalCobradoCaja = Number((montoReciboNum + comisionVenta).toFixed(2));

    // 1. Validación y descuento ATÓMICO en tokensServicios
    const billeteraDescontada = await BilleteraTokens.findOneAndUpdate(
      {
        tenantId: cleanTenantId,
        activo: true,
        tokensServicios: { $gte: totalDescontarTokens },
      },
      { $inc: { tokensServicios: -totalDescontarTokens } },
      { new: true }
    );

    if (!billeteraDescontada) {
      return res.status(400).json({
        exito: false,
        codigo: 'SALDO_INSUFICIENTE',
        error: `Saldo insuficiente en tokens de servicios (requiere $${totalDescontarTokens} MXN incluyendo tarifa de $${tarifaFija}).`,
      });
    }

    const saldoTrasDescuento = billeteraDescontada.tokensServicios;
    const saldoInicial = Number((saldoTrasDescuento + totalDescontarTokens).toFixed(2));

    // 2. Disparar al proveedor
    let respProveedor;
    try {
      respProveedor = await proveedorService.ejecutarPagoServicio({
        folioReferencia: folioRef,
        nombreServicio: String(nombreServicio).trim(),
        referenciaServicio: String(referenciaServicio).trim(),
        montoRecibo: montoReciboNum,
        telefonoCliente, // [CAMBIO]
        emailCliente,    // [CAMBIO]
        simularModo,
      });
    } catch (errProv) {
      respProveedor = {
        exito: false,
        simulado: process.env.RECARGAS_MODO_MOCK !== 'false',
        codigo: 'EXCEPCION_PROVEEDOR',
        mensaje: errProv.message || 'Error de conexión con el proveedor',
        autorizacion: '',
        codigoPin: '',
      };
    }

    // 3A. Si FALLA o TIMEOUT -> Reembolso automático completo (recibo + tarifa)
    if (!respProveedor.exito) {
      const billeteraReembolsada = await BilleteraTokens.findOneAndUpdate(
        { tenantId: cleanTenantId },
        { $inc: { tokensServicios: totalDescontarTokens } },
        { new: true }
      );

      await HistorialTokens.create({
        tenantId: cleanTenantId,
        terminalId,
        usuarioId: String(usuarioId).trim(),
        nombreUsuario: String(nombreUsuario).trim(),
        bolsa: 'SERVICIOS',
        tipo: 'REEMBOLSO_AUTO',
        montoOperacion: montoReciboNum,
        tarifaFija,
        montoTokens: 0,
        saldoAnterior: saldoInicial,
        saldoPosterior: billeteraReembolsada ? billeteraReembolsada.tokensServicios : saldoInicial,
        estado: 'FALLIDO_REEMBOLSADO',
        folioReferencia: folioRef,
        detalleOperacion: {
          nombreServicio: String(nombreServicio).trim(),
          referenciaServicio: String(referenciaServicio).trim(),
        },
        proveedorRespuesta: respProveedor,
      });

      return res.status(502).json({
        exito: false,
        reembolsado: true,
        error: respProveedor.mensaje || 'El proveedor rechazó el pago; tus tokens fueron reembolsados.',
        saldoActual: billeteraReembolsada ? billeteraReembolsada.tokensServicios : saldoInicial,
      });
    }

    // 3B. Si ÉXITO -> Registrar movimiento como 'servicio' (abierto: true para Cierre de Caja)
    const movimientoVenta = await Movimiento.create({
      tenantId: cleanTenantId,
      terminalId: String(terminalId).trim(),
      usuarioId: String(usuarioId).trim(),
      nombreUsuario: String(nombreUsuario).trim(),
      rolUsuario: String(rolUsuario).trim(),
      tipoMovimiento: 'servicio', // [CAMBIO] Separado de 'venta' para Cierre de Caja
      abierto: true,
      cuarentena: false,
      folioTicket: folioRef,
      totalOriginal: totalCobradoCaja,
      totalVenta: totalCobradoCaja,
      items: [
        {
          idProducto: `SERV-${String(nombreServicio).trim().toUpperCase()}`,
          codigoBarras: `SERV-${String(nombreServicio).trim().toUpperCase()}`,
          nombre: `Pago ${nombreServicio} (Ref: ${referenciaServicio})`,
          cantidad: 1,
          precioUnitario: totalCobradoCaja,
          tipoPrecioAplicado: 'SERVICIO',
          subtotal: totalCobradoCaja,
          costoUnitario: totalDescontarTokens,
        },
      ],
    });

    await HistorialTokens.create({
      tenantId: cleanTenantId,
      terminalId,
      usuarioId: String(usuarioId).trim(),
      nombreUsuario: String(nombreUsuario).trim(),
      bolsa: 'SERVICIOS',
      tipo: 'COBRO_SERVICIO',
      montoOperacion: montoReciboNum,
      tarifaFija,
      montoTokens: -totalDescontarTokens,
      saldoAnterior: saldoInicial,
      saldoPosterior: saldoTrasDescuento,
      estado: 'EXITOSO',
      folioReferencia: folioRef,
      detalleOperacion: {
        nombreServicio: String(nombreServicio).trim(),
        referenciaServicio: String(referenciaServicio).trim(),
      },
      proveedorRespuesta: respProveedor,
      movimientoId: movimientoVenta._id,
    });

    return res.status(201).json({
      exito: true,
      mensaje: respProveedor.mensaje,
      data: {
        folioTicket: folioRef,
        autorizacion: respProveedor.autorizacion,
        codigoPin: respProveedor.codigoPin || '', // [CAMBIO] PIN de tarjeta digital si aplica
        simulado: respProveedor.simulado,
        tarifaAplicada: tarifaFija,
        saldoRestanteServicios: saldoTrasDescuento,
        movimiento: movimientoVenta,
      },
    });
  } catch (error) {
    console.error('>>> [COBRAR SERVICIO ERROR]:', error);
    return res.status(500).json({ exito: false, error: error.message });
  }
});

// =========================================================================
// [CAMBIO] GET: Métricas reales consolidadas para el Dashboard (16 KPIs)
// =========================================================================
router.get('/dashboard-metricas', async (req, res) => {
  try {
    const ahora = new Date();
    const en7Dias = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [licencias, billeteras, resumenHistorial, saldoProveedor] = await Promise.all([
      Licencia.find({}, 'estado fecha_expiracion metodo_pago purchaseOrder'),
      BilleteraTokens.find({}, 'tenantId tokensRecargas tokensServicios totalAbonadoRecargas totalAbonadoServicios'),
      HistorialTokens.aggregate([
        { $match: { estado: 'EXITOSO' } },
        {
          $group: {
            _id: '$tipo',
            totalOperacion: { $sum: '$montoOperacion' },
            totalTokens: { $sum: { $abs: '$montoTokens' } },
            totalTarifas: { $sum: '$tarifaFija' },
            cantidad: { $sum: 1 },
          },
        },
      ]),
      proveedorService.obtenerSaldo().catch(() => ({ exito: false, saldoRecargas: 0, saldoServicios: 0 })), // [CAMBIO]
    ]);

    let totalLicencias = licencias.length;
    let clientesActivos = 0;
    let clientesInactivos = 0;
    let licenciasVencidas = 0;
    let licenciasGratuitas = 0;
    let pagosTarjeta = 0;
    let pagosTransferencia = 0;
    let porVencer7Dias = 0;

    licencias.forEach((lic) => {
      const estado = String(lic.estado || '').toLowerCase();
      const pasarela = String(lic.metodo_pago?.pasarela || '').toLowerCase();
      const fechaExp = lic.fecha_expiracion ? new Date(lic.fecha_expiracion) : null;
      const vencida = fechaExp && fechaExp < ahora;

      if (estado.includes('inactiv') || estado.includes('suspend') || estado.includes('cancel')) {
        clientesInactivos++;
      } else if (vencida || estado.includes('vencid')) {
        licenciasVencidas++;
      } else {
        clientesActivos++;
        if (fechaExp && fechaExp >= ahora && fechaExp <= en7Dias) {
          porVencer7Dias++;
        }
      }

      if (
        estado.includes('trial') ||
        estado.includes('prueba') ||
        pasarela.includes('cortesia') ||
        pasarela.includes('trial') ||
        pasarela.includes('grat')
      ) {
        licenciasGratuitas++;
      }

      if (pasarela.includes('transferencia') || pasarela.includes('spei')) {
        pagosTransferencia++;
      } else if (
        pasarela.includes('tarjeta') ||
        pasarela.includes('card') ||
        pasarela.includes('stripe') ||
        pasarela.includes('mercadopago') ||
        pasarela.includes('conekta')
      ) {
        pagosTarjeta++;
      }
    });

    let clientesConTokens = 0;
    let saldoVivoClientes = 0;
    billeteras.forEach((b) => {
      const saldoActual = Number(b.tokensRecargas || 0) + Number(b.tokensServicios || 0);
      const tuvoMovimiento =
        saldoActual > 0 || Number(b.totalAbonadoRecargas || 0) > 0 || Number(b.totalAbonadoServicios || 0) > 0;
      if (tuvoMovimiento) clientesConTokens++;
      saldoVivoClientes += saldoActual;
    });

    const mapaHist = {};
    resumenHistorial.forEach((r) => {
      mapaHist[r._id] = r;
    });

    const abonos = mapaHist.ABONO_ADMIN || { totalOperacion: 0, totalTokens: 0, cantidad: 0 };
    const recargas = mapaHist.COBRO_RECARGA || { totalOperacion: 0, cantidad: 0 };
    const servicios = mapaHist.COBRO_SERVICIO || { totalOperacion: 0, totalTarifas: 0, cantidad: 0 };

    const saldoBolsaApi = saldoProveedor?.exito
      ? Number(((saldoProveedor.saldoRecargas || 0) + (saldoProveedor.saldoServicios || 0)).toFixed(2))
      : Number(process.env.SALDO_API_MOCK || 0);

    return res.json({
      exito: true,
      data: {
        totalLicencias,
        licenciasGratuitas,
        pagosTarjeta,
        pagosTransferencia,
        clientesActivos,
        clientesInactivos,
        licenciasVencidas,
        porVencer7Dias,
        ventaTokensTotal: Number(abonos.totalOperacion || 0),
        ventaTokensCantidad: Number(abonos.cantidad || 0),
        clientesConTokens,
        saldoBolsaApi,
        saldoBolsaRecargasApi: Number(saldoProveedor?.saldoRecargas || 0), // [CAMBIO]
        saldoBolsaServiciosApi: Number(saldoProveedor?.saldoServicios || 0), // [CAMBIO]
        saldoBolsaSimulado: process.env.RECARGAS_MODO_MOCK !== 'false',
        saldoVivoClientes: Number(saldoVivoClientes.toFixed(2)),
        recargasMonto: Number(recargas.totalOperacion || 0),
        recargasCantidad: Number(recargas.cantidad || 0),
        serviciosMonto: Number(servicios.totalOperacion || 0),
        serviciosTarifas: Number(servicios.totalTarifas || 0),
        serviciosCantidad: Number(servicios.cantidad || 0),
        tokensUsadosTotal: Number((Number(recargas.totalOperacion || 0) + Number(servicios.totalOperacion || 0)).toFixed(2)),
      },
    });
  } catch (error) {
    console.error('>>> [DASHBOARD METRICAS ERROR]:', error);
    return res.status(500).json({ exito: false, error: error.message });
  }
});

module.exports = router;