const cron = require('node-cron');
const Licencia = require('../models/Licencia');

// Programar la tarea para que se ejecute todos los días a la medianoche ('0 0 * * *')
// Para pruebas de desarrollo, se mantiene temporalmente a cada minuto: '*/1 * * * *'
cron.schedule('*/1 * * * *', async () => {
    try {
        const ahora = new Date();
        
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

        // 2. Marcar pruebas gratuitas vencidas como 'prueba_vencida'
        const resultadoPruebas = await Licencia.updateMany(
            {
                "estado": "prueba_activa",
                "fecha_expiracion": { $lt: ahora }
            },
            {
                $set: { estado: "prueba_vencida" }
            }
        );

        if (resultadoPruebas.modifiedCount > 0) {
            console.log(`[CRON] Se marcaron ${resultadoPruebas.modifiedCount} pruebas gratuitas como vencidas.`);
        }

        // 3. Marcar licencias de pago manual (transferencia) vencidas como 'licencia_vencida'
        const resultadoLicenciasManuales = await Licencia.updateMany(
            {
                "estado": "licencia_activa",
                "fecha_expiracion": { $lt: ahora }
            },
            {
                $set: { estado: "licencia_vencida" }
            }
        );

        if (resultadoLicenciasManuales.modifiedCount > 0) {
            console.log(`[CRON] Se marcaron ${resultadoLicenciasManuales.modifiedCount} licencias manuales como vencidas.`);
        }

        // 4. Marcar licencias de Stripe vencidas como 'stripe_vencida'
        const resultadoStripe = await Licencia.updateMany(
            {
                "estado": "stripe_activa",
                "fecha_expiracion": { $lt: ahora }
            },
            {
                $set: { estado: "stripe_vencida" }
            }
        );

        if (resultadoStripe.modifiedCount > 0) {
            console.log(`[CRON] Se marcaron ${resultadoStripe.modifiedCount} licencias de Stripe como vencidas.`);
        }

    } catch (error) {
        console.error("[CRON] Error al ejecutar la revisión de licencias y órdenes vencidas:", error);
    }
});

console.log("Módulo de tareas automáticas (Cron Job) inicializado correctamente.");