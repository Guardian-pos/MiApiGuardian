const express = require('express');
const router = express.Router();
const { Resend } = require('resend');
const Licencia = require('../models/Licencia');

// Inicializar Resend con la API Key configurada en las variables de entorno
const resend = new Resend(process.env.RESEND_API_KEY);

// Endpoint para solicitar la prueba de 15 días
router.post('/solicitar-prueba', async (req, res) => {
  try {
    // Extraemos la dirección de forma opcional (si no viene, será una cadena vacía)
    const { negocio, contacto, telefono, correo, direccion } = req.body;

    // NOTA: 'direccion' NO es obligatoria aquí para permitir registros web rápidos
    if (!negocio || !contacto || !telefono || !correo) {
      return res.status(400).json({ 
        exito: false, 
        mensaje: 'Todos los campos obligatorios deben ser completados.' 
      });
    }

    // Verificar si ya existe una licencia registrada con este correo
    const licenciaExistente = await Licencia.findOne({ 'client.correo': correo });
    if (licenciaExistente) {
      return res.status(400).json({
        exito: false,
        mensaje: 'Este correo ya cuenta con un periodo de prueba o licencia registrada.'
      });
    }

    // Generar una clave de licencia de prueba única
    const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    const licenseKey = `GPOS-TRIAL-${randomCode}`;

    // Calcular fecha de expiración (15 días a partir de hoy)
    const fechaExpiracion = new Date();
    fechaExpiracion.setDate(fechaExpiracion.getDate() + 15);

    // Generar un número de cliente único para el tenant
    const numeroClienteUnico = 'CLI-' + Math.floor(1000 + Math.random() * 9000);

    // Guardar el registro en MongoDB Atlas asegurando el numero_cliente y la direccion opcional
    const nuevaLicencia = new Licencia({
      tipo_producto: 'guardian_pos_lite',
      licenseKey: licenseKey,
      client: {
        numero_cliente: numeroClienteUnico,
        nombre_negocio: negocio,
        nombre_contacto: contacto,
        telefono: telefono,
        correo: correo,
        direccion: direccion ? direccion.trim() : '' // <-- Se guarda si viene, o vacío si no se especificó
      },
      estado: 'activa',
      fecha_expiracion: fechaExpiracion,
      metodo_pago: {
        pasarela: 'prueba_gratuita'
      },
      usuarios: []
    });

    await nuevaLicencia.save();

    // Enviar correo corporativo utilizando la API HTTP de Resend
    const { data, error } = await resend.emails.send({
      from: 'Guardián POS Lite <soporte@guardianpos.mx>',
      to: [correo],
      subject: 'Tu Código de Activación - Prueba Gratuita de 15 Días',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #2563EB;">¡Bienvenido a Guardián POS Lite, ${negocio}!</h2>
          <p>Hola <strong>${contacto}</strong>, hemos recibido tu solicitud para probar nuestro sistema punto de venta.</p>
          <p>Tu código de activación temporal por <strong>15 días</strong> es:</p>
          <div style="background: #F3F4F6; padding: 15px; font-size: 22px; font-weight: bold; text-align: center; letter-spacing: 2px; color: #1E40AF; border-radius: 6px; margin: 20px 0;">
            ${licenseKey}
          </div>
          <p>Copia este código e ingrésalo en tu aplicación para comenzar a utilizar tu sistema de inmediato.</p>
          <p>Este código vencerá el: <strong>${fechaExpiracion.toLocaleDateString()}</strong>.</p>
        </div>
      `,
    });

    if (error) {
      console.error('Error devuelto por Resend API:', error);
      return res.status(500).json({
        exito: false,
        mensaje: 'Error al enviar el correo mediante el servicio de mensajería.'
      });
    }

    res.json({
      exito: true,
      mensaje: 'Código generado y enviado por correo exitosamente.',
      licenseKey: licenseKey
    });

  } catch (error) {
    console.error('Error al procesar solicitud de prueba:', error);
    res.status(500).json({
      exito: false,
      mensaje: 'Hubo un error al procesar tu solicitud en el servidor.'
    });
  }
});

module.exports = router;