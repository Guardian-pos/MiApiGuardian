const mongoose = require('mongoose');

const HistorialTokensSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    terminalId: {
      type: String,
      default: 'PANEL',
      trim: true,
    },
    usuarioId: {
      type: String,
      required: true,
      trim: true,
    },
    nombreUsuario: {
      type: String,
      required: true,
      trim: true,
    },
    bolsa: {
      type: String,
      required: true,
      enum: ['RECARGAS', 'SERVICIOS'],
    },
    tipo: {
      type: String,
      required: true,
      enum: ['ABONO_ADMIN', 'COBRO_RECARGA', 'COBRO_SERVICIO', 'REEMBOLSO_AUTO', 'AJUSTE'],
    },
    montoOperacion: { type: Number, required: true }, // Monto de la recarga, recibo o depósito
    bonoAplicado: { type: Number, default: 0 },       // Bono % en abonos de recargas
    tarifaFija: { type: Number, default: 0 },         // Tarifa fija en servicios (ej. 7 MXN)
    montoTokens: { type: Number, required: true },    // Impacto neto en bolsa (+ abono/reembolso, - cobro)
    saldoAnterior: { type: Number, required: true },
    saldoPosterior: { type: Number, required: true },
    estado: {
      type: String,
      required: true,
      enum: ['EXITOSO', 'FALLIDO_REEMBOLSADO', 'PENDIENTE', 'RECHAZADO'],
    },
    folioReferencia: {
      type: String,
      required: true,
      index: true,
    },
    detalleOperacion: {
      compania: { type: String, default: '' },
      numeroTelefono: { type: String, default: '' },
      nombreServicio: { type: String, default: '' },
      referenciaServicio: { type: String, default: '' },
      nota: { type: String, default: '' },
    },
    proveedorRespuesta: {
      simulado: { type: Boolean, default: true },
      codigo: { type: String, default: '' },
      mensaje: { type: String, default: '' },
      autorizacion: { type: String, default: '' },
    },
    movimientoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Movimiento',
      default: null,
    },
  },
  { timestamps: true }
);

HistorialTokensSchema.index({ tenantId: 1, createdAt: -1 });
HistorialTokensSchema.index({ tenantId: 1, bolsa: 1, tipo: 1, createdAt: -1 });

module.exports = mongoose.model('HistorialTokens', HistorialTokensSchema);