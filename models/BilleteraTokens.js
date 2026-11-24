const mongoose = require('mongoose');

const BilleteraTokensSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    tokensRecargas: {
      type: Number,
      default: 0,
      min: 0,
    },
    tokensServicios: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Acumulados informativos para métricas rápidas
    totalAbonadoRecargas: {
      type: Number,
      default: 0,
    },
    totalAbonadoServicios: {
      type: Number,
      default: 0,
    },
    activo: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BilleteraTokens', BilleteraTokensSchema);