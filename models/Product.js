const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  tenantId: { 
    type: String, 
    required: true, 
    index: true,
    trim: true,
    lowercase: true 
  },
  codigoBarras: { type: String, required: true, trim: true },
  claveAlterna: { type: String, default: '', trim: true },
  referencia: { type: String, default: '', trim: true },
  nombre: { type: String, required: true, trim: true },
  marca: { type: String, default: '', trim: true },
  pesoKg: { type: Number, default: 0.0 },
  existMin: { type: Number, default: 0.0 },
  precioCompra: { type: Number, default: 0.0 },
  porcentaje: { type: Number, default: 0.0 },
  precioVenta: { type: Number, default: 0.0 },
  utilidad: { type: Number, default: 0.0 },
  porcentajeMayoreo: { type: Number, default: 0.0 },
  precioMayoreo: { type: Number, default: 0.0 },
  utilidadMayoreo: { type: Number, default: 0.0 },
  iva: { type: Number, default: 0.0 },
  existencia: { type: Number, default: 0.0 },
  promociones: { type: Array, default: [] },
  componentes: { type: Object, default: {} },
  diasActivos: { type: [String], default: [] },
  esCombo: { type: Boolean, default: false },
  horaFin: { type: String, default: '' },
  horaInicio: { type: String, default: '' },
  horarioActivo: { type: Boolean, default: false }
}, {
  timestamps: true
});

productSchema.index({ tenantId: 1, codigoBarras: 1 }, { unique: true });

module.exports = mongoose.model('Product', productSchema);