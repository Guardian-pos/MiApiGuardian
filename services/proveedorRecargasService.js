/**
 * Servicio adaptador para el proveedor de Recargas y Servicios (Recargas Todo México).
 * Actualmente en modo SIMULADOR / MOCK hasta integrar credenciales reales.
 */

const PROVEEDOR_MODO_MOCK = process.env.RECARGAS_MODO_MOCK !== 'false'; // true por defecto

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ejecutarRecarga({
  folioReferencia,
  compania,
  numeroTelefono,
  monto,
  simularModo = 'OK', // 'OK' | 'ERROR' | 'TIMEOUT' (solo aplica en modo mock)
}) {
  if (PROVEEDOR_MODO_MOCK) {
    await esperar(400);

    if (simularModo === 'TIMEOUT') {
      return {
        exito: false,
        simulado: true,
        codigo: 'TIMEOUT',
        mensaje: 'Tiempo de espera agotado al conectar con el proveedor (simulado).',
        autorizacion: '',
      };
    }

    if (simularModo === 'ERROR') {
      return {
        exito: false,
        simulado: true,
        codigo: 'ERR_PROVEEDOR',
        mensaje: 'Número inválido o servicio temporalmente fuera de línea (simulado).',
        autorizacion: '',
      };
    }

    return {
      exito: true,
      simulado: true,
      codigo: '00',
      mensaje: `Recarga ${compania} de $${monto} aplicada correctamente (simulado).`,
      autorizacion: `SIM-${String(Date.now()).slice(-6)}`,
    };
  }

  // TODO: Integrar llamada real con fetch() a la API de Recargas Todo México usando folioReferencia
  throw new Error('Integración real con Recargas Todo México pendiente de configurar.');
}

async function ejecutarPagoServicio({
  folioReferencia,
  nombreServicio,
  referenciaServicio,
  montoRecibo,
  simularModo = 'OK', // 'OK' | 'ERROR' | 'TIMEOUT'
}) {
  if (PROVEEDOR_MODO_MOCK) {
    await esperar(500);

    if (simularModo === 'TIMEOUT') {
      return {
        exito: false,
        simulado: true,
        codigo: 'TIMEOUT',
        mensaje: 'Timeout al procesar pago de servicio con el proveedor (simulado).',
        autorizacion: '',
      };
    }

    if (simularModo === 'ERROR') {
      return {
        exito: false,
        simulado: true,
        codigo: 'ERR_REFERENCIA',
        mensaje: 'Referencia de recibo rechazada o vencida (simulado).',
        autorizacion: '',
      };
    }

    return {
      exito: true,
      simulado: true,
      codigo: '00',
      mensaje: `Pago de servicio ${nombreServicio} por $${montoRecibo} aplicado (simulado).`,
      autorizacion: `SIMS-${String(Date.now()).slice(-6)}`,
    };
  }

  // TODO: Integrar llamada real con fetch() a la API de Recargas Todo México usando folioReferencia
  throw new Error('Integración real con Recargas Todo México pendiente de configurar.');
}

module.exports = {
  ejecutarRecarga,
  ejecutarPagoServicio,
};