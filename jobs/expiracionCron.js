const cron = require('node-cron');
const Licencia = require('../models/Licencia');

// Programar la tarea para que se ejecute todos los días a la medianoche ('0 0 * * *')
// Para pruebas de desarrollo, puedes cambiarlo temporalmente a cada minuto: '*/1 * * * *'
cron.schedule('0 0 * * *', async () => {
    try {
        const ahora = new Date();
        
        // 1. Buscar órdenes pendientes de transferencia cuya fecha límite ya haya expirado
        const resultadoTransferencia = await Licencia.updateMany(
            {
                "metodo_pago.pasarela": "transferencia_manual",
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

        // 2. Marcar pruebas gratuitas vencidas como 'prueba_terminada'
        const resultadoPruebas = await Licencia.updateMany(
            {
                "metodo_pago.pasarela": "prueba_gratuita",
                "estado": "prueba_activa",
                "fecha_expiracion": { $lt: ahora }
            },
            {
                $set: { estado: "prueba_terminada" }
            }
        );

        if (resultadoPruebas.modifiedCount > 0) {
            console.log(`[CRON] Se marcaron ${resultadoPruebas.modifiedCount} pruebas gratuitas como terminadas.`);
        }

        // 3. Marcar licencias de pago cuya vigencia haya expirado como 'vencida'
        const resultadoPagadas = await Licencia.updateMany(
            {
                "metodo_pago.pasarela": { $ne: "prueba_gratuita" },
                "estado": "activa",
                "fecha_expiracion": { $lt: ahora }
            },
            {
                $set: { estado: "vencida" }
            }
        );

        if (resultadoPagadas.modifiedCount > 0) {
            console.log(`[CRON] Se marcaron ${resultadoPagadas.modifiedCount} licencias de pago como vencidas.`);
        }

    } catch (error) {
        console.error("[CRON] Error al ejecutar la revisión de licencias y órdenes vencidas:", error);
    }
});

console.log("Módulo de tareas automáticas (Cron Job) inicializado correctamente.");