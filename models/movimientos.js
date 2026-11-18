const mongoose = require('mongoose');

const MovimientoSchema = new mongoose.Schema({
  tenantId: { type: String, required: true }, // Numero de Cliente
  terminalId: { type: String, required: true }, // Identificador único o prefijo de la tableta (ej. T1, T2, etc.)
  
  // ➔ Huella digital obligatoria del operador para auditoría y cortes de caja por usuario
  usuarioId: { type: String, required: true },
  nombreUsuario: { type: String, required: true },
  rolUsuario: { type: String, required: true, default: 'empleado' },

  tipoMovimiento: { 
    type: String, 
    required: true, 
    enum: ['venta', 'devolucion', 'devolucion_cuarentena', 'entrada_caja', 'salida_caja', 'corte_caja'] 
  },
  
  // Campos para Ventas y Devoluciones (Obligatorio SOLO si es venta o devolución)
  folioTicket: { 
    type: String, 
    required: function() {
      return this.tipoMovimiento === 'venta' || this.tipoMovimiento === 'devolucion' || this.tipoMovimiento === 'devolucion_cuarentena';
    }, 
    unique: false 
  }, // Ej. T1-000142 (Único por terminal)
  
  totalOriginal: { type: Number },
  totalVenta: { type: Number },
  totalDevolucion: { type: Number },
  
  // Estructura detallada de los ítems de venta
  items: [{
    idProducto: { type: String },
    codigoBarras: { type: String },
    nombre: { type: String },
    cantidad: { type: Number },
    precioUnitario: { type: Number },
    tipoPrecioAplicado: { type: String, enum: ['REGULAR', 'HORARIO', 'PROMOCION'], default: 'REGULAR' },
    subtotal: { type: Number },
    costoUnitario: { type: Number }
  }],
  
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
  
  fechaEmision: { type: Date, default: Date.now }
});

// Índice compuesto optimizado por sucursal, usuario y fecha
MovimientoSchema.index({ tenantId: 1, usuarioId: 1, fechaEmision: -1 });

module.exports = mongoose.model('Movimiento', MovimientoSchema);