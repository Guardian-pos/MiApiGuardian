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

  // [CAMBIO] Control de turno abierto/cerrado para aislar movimientos hasta ejecutar el corte de caja
  abierto: { type: Boolean, default: true }, // true = pendiente de cierre en turno actual; false = ya cerrado en corte
  corteId: { type: String, default: null },    // [CAMBIO] Folio o ID del corte de caja que cerró este movimiento
  fechaCorte: { type: Date, default: null },   // [CAMBIO] Fecha/hora en que se ejecutó el corte de caja

  // [CAMBIO] Estado independiente para devoluciones retenidas en cuarentena hasta confirmación/reingreso en panel web
  cuarentena: { type: Boolean, default: false }, // true = pendiente de revisión/reingreso en panel web; false = resuelto o no aplica
  
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
    tipoPrecioAplicado: { type: String, enum: ['REGULAR', 'HORARIO', 'PROMOCION', 'SERVICIO'], default: 'REGULAR' }, // [CAMBIO] Se agrega 'SERVICIO' para evitar rechazo en validación de Mongoose
    subtotal: { type: Number },
    costoUnitario: { type: Number }
  }],
  
  // Campos para Movimientos de Caja (Entradas / Salidas)
  concepto: { type: String },
  monto: { type: Number },
  esIngreso: { type: Boolean },
  
  // Campos específicos para Cierre de Caja
  fechaInicioTurno: { type: Date }, // [CAMBIO] Inicio del turno/periodo que abarca el cierre
  efectivoContado: { type: Number },
  ventasTotalesSistema: { type: Number },
  totalDevoluciones: { type: Number }, // [CAMBIO] Monto total de devoluciones del turno
  totalEntradas: { type: Number },
  totalSalidas: { type: Number },
  diferencia: { type: Number },
  
  fechaEmision: { type: Date, default: Date.now }
});

// Índice compuesto optimizado por sucursal, usuario y fecha
MovimientoSchema.index({ tenantId: 1, usuarioId: 1, fechaEmision: -1 });
// [CAMBIO] Índice adicional para filtrar rápidamente movimientos abiertos del turno actual por cajero
MovimientoSchema.index({ tenantId: 1, usuarioId: 1, abierto: 1, fechaEmision: -1 });
// [CAMBIO] Índice para contar y consultar rápidamente folios pendientes en cuarentena por sucursal
MovimientoSchema.index({ tenantId: 1, tipoMovimiento: 1, cuarentena: 1, fechaEmision: -1 });

module.exports = mongoose.model('Movimiento', MovimientoSchema);