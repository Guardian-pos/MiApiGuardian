const mongoose = require('mongoose');

const MovimientoSchema = new mongoose.Schema({
  tenantId: { type: String, required: true }, // Clave de licencia o sucursal
  tipoMovimiento: { 
    type: String, 
    required: true, 
    enum: ['venta', 'devolucion', 'entrada_caja', 'salida_caja', 'corte_caja'] 
  },
  
  // Campos para Ventas y Devoluciones
  folioTicket: { type: String },
  totalOriginal: { type: Number },
  totalVenta: { type: Number },
  totalDevolucion: { type: Number },
  items: { type: Array },
  
  // Campos para Movimientos de Caja (Entradas / Salidas)
  concepto: { type: String },
  monto: { type: Number },
  esIngreso: { type: Boolean },
  
  // Campos específicos para Cierre de Caja
  efectivoContado: { type: Number },
  ventasTotalesSistema: { type: Number },
  totalEntradas: { type: Number },
  totalSalidas: { type: Number },
  diferencia: { type: Number },
  totalRecargas: { type: Number, default: 0 },
  totalServicios: { type: Number, default: 0 },
  
  fechaEmision: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Movimiento', MovimientoSchema);