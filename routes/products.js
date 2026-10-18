const express = require('express');
const router = express.Router();
const Product = require('../models/Product');

router.get('/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const productos = await Product.find({ tenantId });
    res.status(200).json({ success: true, count: productos.length, data: productos });
  } catch (error) {
    console.error('Error al obtener productos:', error);
    res.status(500).json({ success: false, message: 'Error interno al consultar productos.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const productData = req.body;
    const tenantId = productData.tenantId || productData.idsucursal;
    
    if (!tenantId || !productData.codigoBarras || !productData.nombre) {
      return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
    }

    productData.tenantId = tenantId.trim().toLowerCase();

    const productoActualizado = await Product.findOneAndUpdate(
      { tenantId: productData.tenantId, codigoBarras: productData.codigoBarras },
      productData,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ success: true, message: 'Producto guardado exitosamente.', data: productoActualizado });
  } catch (error) {
    console.error('Error al guardar producto:', error);
    res.status(500).json({ success: false, message: 'Error interno al guardar el producto.' });
  }
});

router.post('/sync-bulk', async (req, res) => {
  try {
    const { tenantId, productos } = req.body;
    if (!tenantId || !Array.isArray(productos)) {
      return res.status(400).json({ success: false, message: 'Datos inválidos para sincronización masiva.' });
    }

    const cleanTenantId = tenantId.trim().toLowerCase();
    let sincronizados = 0;

    for (let item of productos) {
      item.tenantId = cleanTenantId;
      if (item.codigoBarras) {
        await Product.findOneAndUpdate(
          { tenantId: cleanTenantId, codigoBarras: item.codigoBarras },
          item,
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        sincronizados++;
      }
    }

    res.status(200).json({ success: true, message: `Sincronización masiva exitosa. Se procesaron ${sincronizados} productos.`, sincronizados });
  } catch (error) {
    console.error('Error en sincronización masiva:', error);
    res.status(500).json({ success: false, message: 'Error interno.' });
  }
});

module.exports = router;