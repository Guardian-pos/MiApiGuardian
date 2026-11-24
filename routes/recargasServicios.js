const express = require('express');
const router = express.Router();
const BilleteraTokens = require('../models/BilleteraTokens');
const HistorialTokens = require('../models/HistorialTokens');
const Movimiento = require('../models/movimientos');
const proveedorService = require('../services/proveedorRecargasService');

const TARIFA_SERVICIO_DEFAULT = Number(process.env.TARIFA_FIJA_SERVICIO || 7);

function normalizarTenant(tenantId) {
  return String(tenantId || '').trim().toLowerCase();
}

function generarFolioLite(prefijo, terminalId) {
  const term = String(terminalId || 'T1').trim().toUpperCase();
  return `LITE-${prefijo}-${term}-${Date.now()}`;
}

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
// POST: Abonar saldo desde el Panel Admin (Recargas con bono % / Servicios sin bono)
// =========================================================================
router.post('/abonar', async (req, res) => {
  try {
    const adminKeyEnv = process.env.ADMIN_TOKENS_KEY;
    if (adminKeyEnv && req.headers['x-admin-key'] !== adminKeyEnv) {
      return res.status(401).json({ exito: false, error: 'No autorizado para abonar tokens' });
    }

    const {
      tenantId,
      bolsa, // 'RECARGAS' | 'SERVICIOS'
      montoDeposito,
      bonoPorcentaje = 0, // Ej. 6 para 6% en recargas ($1,000 -> $1,060)
      adminId = 'admin_panel',
      nombreAdmin = 'Administrador',
      nota = '',
    } = req.body;

    const cleanTenantId = normalizarTenant(tenantId);
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

    const historial = await HistorialTokens.create({
      tenantId: cleanTenantId,
      terminalId: 'PANEL',
      usuarioId: String(adminId).trim(),
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
      detalleOperacion: { nota: String(nota || '').trim() },
      proveedorRespuesta: { simulado: false, codigo: 'ADMIN', mensaje: 'Abono acreditado' },
    });

    return res.status(201).json({
      exito: true,
      mensaje: `Abono acreditado en ${bolsaUpper}: $${totalTokensAbonar} tokens`,
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
// POST: Cobrar Recarga Electrónica (Descuento atómico -> Proveedor -> Venta o Reembolso)
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
      folioTicket,
      simularModo = 'OK', // Para pruebas en mock: 'OK' | 'ERROR' | 'TIMEOUT'
    } = req.body;

    const cleanTenantId = normalizarTenant(tenantId);
    const montoNum = Number(monto);

    if (!cleanTenantId || !usuarioId || !nombreUsuario || !compania || !numeroTelefono) {
      return res.status(400).json({
        exito: false,
        error: 'Faltan campos obligatorios (tenantId, usuarioId, nombreUsuario, compania, numeroTelefono)',
      });
    }
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return res.status(400).json({ exito: false, error: 'El monto de la recarga debe ser mayor a 0' });
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
    const folioRef = folioTicket ? String(folioTicket).trim() : generarFolioLite('REC', terminalId);

    // 2. Disparar al proveedor (simulador/mock por ahora)
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
        simulado: true,
        codigo: 'EXCEPCION_PROVEEDOR',
        mensaje: errProv.message || 'Error de conexión con el proveedor',
        autorizacion: '',
      };
    }

    // 3A. Si FALLA o hace TIMEOUT -> Reembolsar automáticamente y NO registrar venta
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

    // 3B. Si ÉXITO -> Registrar venta en Movimientos (abierto: true para Cierre de Caja)
    const movimientoVenta = await Movimiento.create({
      tenantId: cleanTenantId,
      terminalId: String(terminalId).trim(),
      usuarioId: String(usuarioId).trim(),
      nombreUsuario: String(nombreUsuario).trim(),
      rolUsuario: String(rolUsuario).trim(),
      tipoMovimiento: 'venta',
      abierto: true,
      cuarentena: false,
      folioTicket: folioRef,
      totalOriginal: montoNum,
      totalVenta: montoNum,
      items: [
        {
          idProducto: `REC-${String(compania).trim().toUpperCase()}`,
          codigoBarras: `REC-${String(compania).trim().toUpperCase()}`,
          nombre: `Recarga ${compania} (${numeroTelefono})`,
          cantidad: 1,
          precioUnitario: montoNum,
          tipoPrecioAplicado: 'SERVICIO',
          subtotal: montoNum,
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
// POST: Cobrar Pago de Servicio (Monto + Tarifa Fija -> Proveedor -> Venta o Reembolso)
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
      montoRecibo,
      comisionCliente, // Opcional: lo que el negocio cobra al cliente final en caja (default = tarifaFija)
      folioTicket,
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

    const totalDescontarTokens = Number((montoReciboNum + tarifaFija).toFixed(2));
    const comisionVenta = comisionCliente !== undefined ? Number(comisionCliente) : tarifaFija;
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
    const folioRef = folioTicket ? String(folioTicket).trim() : generarFolioLite('SERV', terminalId);

    // 2. Disparar al proveedor
    let respProveedor;
    try {
      respProveedor = await proveedorService.ejecutarPagoServicio({
        folioReferencia: folioRef,
        nombreServicio: String(nombreServicio).trim(),
        referenciaServicio: String(referenciaServicio).trim(),
        montoRecibo: montoReciboNum,
        simularModo,
      });
    } catch (errProv) {
      respProveedor = {
        exito: false,
        simulado: true,
        codigo: 'EXCEPCION_PROVEEDOR',
        mensaje: errProv.message || 'Error de conexión con el proveedor',
        autorizacion: '',
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

    // 3B. Si ÉXITO -> Registrar venta en Movimientos (abierto: true para Cierre de Caja)
    const movimientoVenta = await Movimiento.create({
      tenantId: cleanTenantId,
      terminalId: String(terminalId).trim(),
      usuarioId: String(usuarioId).trim(),
      nombreUsuario: String(nombreUsuario).trim(),
      rolUsuario: String(rolUsuario).trim(),
      tipoMovimiento: 'venta',
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

module.exports = router;