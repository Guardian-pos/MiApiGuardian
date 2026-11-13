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
    
    // LOG DE DEPURACIÓN (Muestra en la consola de Render/Node qué llegó exactamente, incluidos horarios y días)
    console.log('>>> [RECIBIENDO PRODUCTO]:', JSON.stringify(productData));

    if (!tenantId || !productData.codigoBarras || !productData.nombre) {
      console.log('>>> [ERROR BACKEND]: Faltan campos obligatorios -> tenantId:', tenantId, '| codigoBarras:', productData.codigoBarras, '| nombre:', productData.nombre);
      return res.status(400).json({ success: false, message: 'Faltan campos obligatorios.' });
    }

    productData.tenantId = tenantId.trim().toLowerCase();

    // Actualiza o inserta el producto (incluyendo configuración horaria, días activos y precioHorario)
    const productoActualizado = await Product.findOneAndUpdate(
      { tenantId: productData.tenantId, codigoBarras: productData.codigoBarras },
      productData,
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    );    

    res.status(200).json({ success: true, message: 'Producto guardado exitosamente.', data: productoActualizado });
  } catch (error) {
    console.error('>>> [ERROR CRÍTICO AL GUARDAR PRODUCTO EN MONGO]:', error);
    res.status(500).json({ success: false, message: 'Error interno al guardar el producto.', error: error.message });
  }
});

// =========================================================================
// ➔ RUTA RESTAURADA: ACTUALIZACIÓN RÁPIDA DE EXISTENCIA (BORRAR / PONER EN CEROS)
// =========================================================================
router.put('/existencia', async (req, res) => {
  try {
    const { tenantId, codigoBarras, existencia } = req.body;

    console.log('>>> [ACTUALIZANDO EXISTENCIA]:', { tenantId, codigoBarras, existencia });

    if (!tenantId || !codigoBarras) {
      return res.status(400).json({ success: false, message: 'Faltan tenantId o codigoBarras.' });
    }

    const productoActualizado = await Product.findOneAndUpdate(
      { tenantId: tenantId.trim().toLowerCase(), codigoBarras: codigoBarras.trim() },
      { $set: { existencia: existencia ?? 0.0 } },
      { new: true }
    );

    if (!productoActualizado) {
      return res.status(404).json({ success: false, message: 'Producto no encontrado en la base de datos.' });
    }

    res.status(200).json({ success: true, message: 'Existencia actualizada exitosamente.', data: productoActualizado });
  } catch (error) {
    console.error('>>> [ERROR AL ACTUALIZAR EXISTENCIA]:', error);
    res.status(500).json({ success: false, message: 'Error interno al actualizar existencia.', error: error.message });
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