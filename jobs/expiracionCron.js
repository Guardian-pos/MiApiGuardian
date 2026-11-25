const cron = require('node-cron');
const { Resend } = require('resend'); // [CAMBIO] Cliente Resend igual que en routes/movimientos.js
const Licencia = require('../models/Licencia');
const Producto = require('../models/Product'); // [CAMBIO] Para contar productos en fin de prueba
const Movimiento = require('../models/movimientos'); // [CAMBIO] Para contar ventas y cortes en fin de prueba

// [CAMBIO] Inicialización de Resend usando RESEND_API_KEY
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const CORREO_REMITENTE = 'Guardián POS <soporte@guardianpos.mx>';
const CORREO_SOPORTE = 'soporte@guardianpos.mx';

// [CAMBIO] Formatea fechas en zona horaria de México
function formatearFechaMexico(fechaValor) {
    try {
        const fecha = fechaValor instanceof Date ? fechaValor : new Date(fechaValor);
        if (Number.isNaN(fecha.getTime())) return 'N/D';
        return fecha.toLocaleString('es-MX', {
            timeZone: 'America/Mexico_City',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (_) {
        return 'N/D';
    }
}

// [CAMBIO] Helper genérico de envío con Resend
async function enviarCorreo({ to, subject, html }) {
    if (!resend) {
        console.warn('[CRON] RESEND_API_KEY no configurada; se omite el envío de correo.');
        return false;
    }
    if (!to) return false;

    const { error } = await resend.emails.send({
        from: CORREO_REMITENTE,
        to: [String(to).trim()],
        subject,
        html,
    });

    if (error) {
        console.error('[CRON] Error devuelto por Resend:', error);
        return false;
    }
    return true;
}

// [CAMBIO] Plantilla de recordatorio amistoso (7 días y 3 días antes)
function construirHtmlRecordatorio({ nombreContacto, nombreNegocio, fechaExpStr, diasRestantes }) {
    const esUrgente = diasRestantes <= 3;
    const titulo = esUrgente
        ? `Tu licencia está por expirar en ${diasRestantes} días`
        : 'Recordatorio amistoso: tu licencia vence en 7 días';
    const colorAcento = esUrgente ? '#DC2626' : '#7C3AED';
    const mensajeIntro = esUrgente
        ? `Te recordamos que la licencia de <strong>${nombreNegocio}</strong> está a punto de expirar el próximo <strong>${fechaExpStr}</strong>.`
        : `Queremos avisarte con tiempo que la licencia de <strong>${nombreNegocio}</strong> vencerá el próximo <strong>${fechaExpStr}</strong>.`;

    return `
        <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; color: #1F2937; border: 1px solid #E5E7EB; border-radius: 8px;">
            <h2 style="margin: 0 0 12px 0; color: ${colorAcento};">${titulo}</h2>
            <p style="font-size: 14px; line-height: 1.5;">Hola <strong>${nombreContacto}</strong>,</p>
            <p style="font-size: 14px; line-height: 1.5;">${mensajeIntro}</p>
            <div style="background: #F9FAFB; border-left: 4px solid ${colorAcento}; padding: 12px 14px; margin: 16px 0; font-size: 14px;">
                <strong>Fecha de expiración:</strong> ${fechaExpStr} (hora centro de México)
            </div>
            <p style="font-size: 14px; line-height: 1.5;">
                Para evitar interrupciones en tu operación, puedes renovar enviando tu comprobante de transferencia a
                <a href="mailto:${CORREO_SOPORTE}" style="color: ${colorAcento}; font-weight: bold;">${CORREO_SOPORTE}</a>.
                <br><span style="color: #6B7280; font-size: 13px;">(El pago directo con tarjeta en línea estará disponible próximamente en tu panel.)</span>
            </p>
            <p style="margin-top: 20px; font-size: 13px; color: #6B7280;">Equipo de <strong>Guardián POS</strong></p>
        </div>
    `;
}

// [CAMBIO] Plantilla de vencimiento para licencias de pago
function construirHtmlLicenciaVencida({ nombreContacto, nombreNegocio, fechaExpStr }) {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; color: #1F2937; border: 1px solid #E5E7EB; border-radius: 8px;">
            <h2 style="margin: 0 0 12px 0; color: #DC2626;">Tu licencia ha vencido y fue suspendida</h2>
            <p style="font-size: 14px; line-height: 1.5;">Hola <strong>${nombreContacto}</strong>,</p>
            <p style="font-size: 14px; line-height: 1.5;">
                Te informamos que la licencia de <strong>${nombreNegocio}</strong> venció el <strong>${fechaExpStr}</strong>, por lo que el servicio ha sido suspendido temporalmente.
            </p>
            <p style="font-size: 14px; line-height: 1.5;">
                Tus datos y catálogo siguen seguros. Si deseas renovar tu servicio, envíanos tu comprobante de pago o solicítanos los datos de transferencia a
                <a href="mailto:${CORREO_SOPORTE}" style="color: #7C3AED; font-weight: bold;">${CORREO_SOPORTE}</a>.
            </p>
            <p style="font-size: 13px; color: #6B7280;">El pago en línea con tarjeta estará disponible próximamente desde tu panel web.</p>
            <p style="margin-top: 20px; font-size: 13px; color: #6B7280;">Equipo de <strong>Guardián POS</strong></p>
        </div>
    `;
}

// [CAMBIO] Plantilla exclusiva para fin de prueba gratuita con desglose real de MongoDB y comparativa de planes
function construirHtmlPruebaVencida({ nombreContacto, nombreNegocio, fechaExpStr, resumen }) {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1F2937; border: 1px solid #E5E7EB; border-radius: 8px;">
            <h2 style="margin: 0 0 10px 0; color: #7C3AED;">Tu periodo de prueba ha finalizado</h2>
            <p style="font-size: 14px; line-height: 1.5;">Hola <strong>${nombreContacto}</strong>,</p>
            <p style="font-size: 14px; line-height: 1.5;">
                Esperamos que la prueba de <strong>Guardián POS Lite</strong> en <strong>${nombreNegocio}</strong> haya sido de tu agrado.
                Tu periodo de prueba concluyó el <strong>${fechaExpStr}</strong>, pero toda tu información permanece guardada de forma segura.
            </p>

            <div style="background: #F5F3FF; border: 1px solid #DDD6FE; border-radius: 6px; padding: 14px 16px; margin: 16px 0;">
                <p style="margin: 0 0 8px 0; font-weight: bold; color: #5B21B6; font-size: 14px;">
                    Resumen actual de tu base de datos almacenada:
                </p>
                <ul style="margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.6;">
                    <li><strong>${resumen.totalProductos}</strong> productos registrados en tu catálogo</li>
                    <li><strong>${resumen.totalVentas}</strong> ventas registradas</li>
                    <li><strong>${resumen.totalCortes}</strong> cortes de caja ejecutados</li>
                    <li><strong>${resumen.totalUsuarios}</strong> usuarios / cajeros configurados</li>
                </ul>
            </div>

            <p style="font-size: 14px; line-height: 1.5;">
                Si deseas seguir trabajando con todos estos datos sin volver a capturar nada, elige la versión mensual que mejor se adapte a tu negocio:
            </p>

            <table style="width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px;">
                <tr>
                    <td style="width: 50%; vertical-align: top; border: 1px solid #E5E7EB; border-radius: 6px; padding: 12px;">
                        <h3 style="margin: 0 0 6px 0; color: #1F2937;">Guardián POS Lite — Básica</h3>
                        <p style="margin: 0 0 10px 0; font-size: 18px; font-weight: bold; color: #7C3AED;">$199 MXN / mes</p>
                        <ul style="margin: 0; padding-left: 16px; line-height: 1.5; color: #4B5563;">
                            <li>Cobro rápido en tablet Android</li>
                            <li>Respaldo offline de ventas hasta 15 días</li>
                            <li>Catálogo con precio regular y mayoreo</li>
                            <li>Cortes de caja enviados por correo</li>
                            <li>Módulo de recargas y servicios</li>
                        </ul>
                    </td>
                    <td style="width: 50%; vertical-align: top; border: 2px solid #7C3AED; border-radius: 6px; padding: 12px; background: #FAF5FF;">
                        <h3 style="margin: 0 0 6px 0; color: #5B21B6;">Guardián POS Lite — Completa</h3>
                        <p style="margin: 0 0 10px 0; font-size: 18px; font-weight: bold; color: #7C3AED;">$350 MXN / mes</p>
                        <ul style="margin: 0; padding-left: 16px; line-height: 1.5; color: #374151;">
                            <li><strong>Todo lo de la Versión Básica</strong></li>
                            <li>Precios por horario (tarifa nocturna)</li>
                            <li>Combos y promociones por volumen</li>
                            <li>Métricas en vivo y panel web completo</li>
                            <li>Control antifraude de devoluciones en cuarentena</li>
                            <li>Reportes avanzados y pedidos a proveedores por correo</li>
                        </ul>
                    </td>
                </tr>
            </table>

            <div style="background: #F9FAFB; border-radius: 6px; padding: 12px 14px; margin-top: 14px; font-size: 13px; line-height: 1.5;">
                <strong>¿Cómo activar tu licencia?</strong><br>
                Envía tu comprobante de transferencia (voucher) indicando la versión elegida a
                <a href="mailto:${CORREO_SOPORTE}" style="color: #7C3AED; font-weight: bold;">${CORREO_SOPORTE}</a>.<br>
                <span style="color: #6B7280;">Pago en línea con tarjeta (Stripe): próximamente disponible desde tu panel web.</span>
            </div>

            <p style="margin-top: 20px; font-size: 13px; color: #6B7280;">Equipo de <strong>Guardián POS</strong></p>
        </div>
    `;
}

// Programar la tarea para que se ejecute todos los días a la medianoche ('0 0 * * *')
// Para pruebas de desarrollo, se mantiene temporalmente a cada minuto: '*/1 * * * *'
cron.schedule('*/15 * * * *', async () => {
    try {
        const ahora = new Date();
        const en3Dias = new Date(ahora.getTime() + 3 * 24 * 60 * 60 * 1000); // [CAMBIO]
        const en7Dias = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000); // [CAMBIO]

        // 1. Buscar órdenes pendientes de transferencia cuya fecha límite ya haya expirado
        const resultadoTransferencia = await Licencia.updateMany(
            {
                "estado": "pendiente_pago",
                "fecha_limite_pago": { $lt: ahora }
            },
            {
                $set: { estado: "cancelada_por_tiempo" }
            }
        );

        if (resultadoTransferencia.modifiedCount > 0) {
            console.log(`[CRON] Se cancelaron ${resultadoTransferencia.modifiedCount} órdenes de compra por exceder el plazo de pago.`);
        }

        // [CAMBIO] 1B. Recordatorio amistoso a 7 días de expirar (entre >3 y <=7 días)
        const licencias7Dias = await Licencia.find({
            estado: { $in: ['prueba_activa', 'licencia_activa', 'stripe_activa'] },
            fecha_expiracion: { $gt: en3Dias, $lte: en7Dias },
            aviso_7d_enviado: { $ne: true }
        });

        for (const lic of licencias7Dias) {
            const fechaExpStr = formatearFechaMexico(lic.fecha_expiracion);
            const enviado = await enviarCorreo({
                to: lic.client?.correo,
                subject: `Guardián POS - Tu licencia vence en 7 días (${lic.client?.nombre_negocio || ''})`,
                html: construirHtmlRecordatorio({
                    nombreContacto: lic.client?.nombre_contacto || 'Cliente',
                    nombreNegocio: lic.client?.nombre_negocio || 'tu negocio',
                    fechaExpStr,
                    diasRestantes: 7,
                }),
            });
            if (enviado) {
                await Licencia.updateOne({ _id: lic._id }, { $set: { aviso_7d_enviado: true } });
            }
        }

        // [CAMBIO] 1C. Recordatorio a 3 días de expirar (entre >ahora y <=3 días)
        const licencias3Dias = await Licencia.find({
            estado: { $in: ['prueba_activa', 'licencia_activa', 'stripe_activa'] },
            fecha_expiracion: { $gt: ahora, $lte: en3Dias },
            aviso_3d_enviado: { $ne: true }
        });

        for (const lic of licencias3Dias) {
            const fechaExpStr = formatearFechaMexico(lic.fecha_expiracion);
            const enviado = await enviarCorreo({
                to: lic.client?.correo,
                subject: `Guardián POS - Recordatorio: tu licencia expira pronto (${lic.client?.nombre_negocio || ''})`,
                html: construirHtmlRecordatorio({
                    nombreContacto: lic.client?.nombre_contacto || 'Cliente',
                    nombreNegocio: lic.client?.nombre_negocio || 'tu negocio',
                    fechaExpStr,
                    diasRestantes: 3,
                }),
            });
            if (enviado) {
                await Licencia.updateOne({ _id: lic._id }, { $set: { aviso_3d_enviado: true } });
            }
        }

        // 2. Marcar pruebas gratuitas vencidas como 'prueba_vencida' y enviar correo con desglose de datos
        const pruebasVencidas = await Licencia.find({
            estado: 'prueba_activa',
            fecha_expiracion: { $lt: ahora }
        });

        for (const lic of pruebasVencidas) {
            await Licencia.updateOne({ _id: lic._id }, { $set: { estado: 'prueba_vencida' } });

            if (!lic.aviso_vencimiento_enviado) {
                const cleanTenantId = lic.client?.numero_cliente
                    ? String(lic.client.numero_cliente).trim().toLowerCase()
                    : '';

                let resumen = {
                    totalProductos: 0,
                    totalVentas: 0,
                    totalCortes: 0,
                    totalUsuarios: Array.isArray(lic.usuarios) ? lic.usuarios.length : 0,
                };

                if (cleanTenantId) {
                    const [totalProductos, totalVentas, totalCortes] = await Promise.all([
                        Producto.countDocuments({ tenantId: cleanTenantId }),
                        Movimiento.countDocuments({ tenantId: cleanTenantId, tipoMovimiento: 'venta' }),
                        Movimiento.countDocuments({ tenantId: cleanTenantId, tipoMovimiento: 'corte_caja' }),
                    ]);
                    resumen.totalProductos = totalProductos;
                    resumen.totalVentas = totalVentas;
                    resumen.totalCortes = totalCortes;
                }

                const fechaExpStr = formatearFechaMexico(lic.fecha_expiracion);
                const enviado = await enviarCorreo({
                    to: lic.client?.correo,
                    subject: `Tu prueba de Guardián POS ha finalizado — ${lic.client?.nombre_negocio || 'Resumen de tu cuenta'}`,
                    html: construirHtmlPruebaVencida({
                        nombreContacto: lic.client?.nombre_contacto || 'Cliente',
                        nombreNegocio: lic.client?.nombre_negocio || 'tu negocio',
                        fechaExpStr,
                        resumen,
                    }),
                });
                if (enviado) {
                    await Licencia.updateOne({ _id: lic._id }, { $set: { aviso_vencimiento_enviado: true } });
                }
            }
        }

        if (pruebasVencidas.length > 0) {
            console.log(`[CRON] Se marcaron ${pruebasVencidas.length} pruebas gratuitas como vencidas.`);
        }

        // 3. Marcar licencias de pago manual (transferencia) vencidas como 'licencia_vencida' y notificar
        const licenciasManualesVencidas = await Licencia.find({
            estado: 'licencia_activa',
            fecha_expiracion: { $lt: ahora }
        });

        for (const lic of licenciasManualesVencidas) {
            await Licencia.updateOne({ _id: lic._id }, { $set: { estado: 'licencia_vencida' } });

            if (!lic.aviso_vencimiento_enviado) {
                const fechaExpStr = formatearFechaMexico(lic.fecha_expiracion);
                const enviado = await enviarCorreo({
                    to: lic.client?.correo,
                    subject: `Guardián POS - Tu licencia ha vencido (${lic.client?.nombre_negocio || ''})`,
                    html: construirHtmlLicenciaVencida({
                        nombreContacto: lic.client?.nombre_contacto || 'Cliente',
                        nombreNegocio: lic.client?.nombre_negocio || 'tu negocio',
                        fechaExpStr,
                    }),
                });
                if (enviado) {
                    await Licencia.updateOne({ _id: lic._id }, { $set: { aviso_vencimiento_enviado: true } });
                }
            }
        }

        if (licenciasManualesVencidas.length > 0) {
            console.log(`[CRON] Se marcaron ${licenciasManualesVencidas.length} licencias manuales como vencidas.`);
        }

        // 4. Marcar licencias de Stripe vencidas como 'stripe_vencida' y notificar
        const licenciasStripeVencidas = await Licencia.find({
            estado: 'stripe_activa',
            fecha_expiracion: { $lt: ahora }
        });

        for (const lic of licenciasStripeVencidas) {
            await Licencia.updateOne({ _id: lic._id }, { $set: { estado: 'stripe_vencida' } });

            if (!lic.aviso_vencimiento_enviado) {
                const fechaExpStr = formatearFechaMexico(lic.fecha_expiracion);
                const enviado = await enviarCorreo({
                    to: lic.client?.correo,
                    subject: `Guardián POS - Tu licencia ha vencido (${lic.client?.nombre_negocio || ''})`,
                    html: construirHtmlLicenciaVencida({
                        nombreContacto: lic.client?.nombre_contacto || 'Cliente',
                        nombreNegocio: lic.client?.nombre_negocio || 'tu negocio',
                        fechaExpStr,
                    }),
                });
                if (enviado) {
                    await Licencia.updateOne({ _id: lic._id }, { $set: { aviso_vencimiento_enviado: true } });
                }
            }
        }

        if (licenciasStripeVencidas.length > 0) {
            console.log(`[CRON] Se marcaron ${licenciasStripeVencidas.length} licencias de Stripe como vencidas.`);
        }

    } catch (error) {
        console.error("[CRON] Error al ejecutar la revisión de licencias y órdenes vencidas:", error);
    }
});

console.log("Módulo de tareas automáticas (Cron Job) inicializado correctamente.");