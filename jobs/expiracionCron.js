const cron = require('node-cron');
const Licencia = require('../models/Licencia');

// Programar la tarea para que se ejecute todos los días a la medianoche ('0 0 * * *')
// Para pruebas de desarrollo, puedes cambiarlo temporalmente a cada minuto: '*/1 * * * *'
cron.schedule('0 0 * * *', async () => {
    try {
        const ahora = new Date();
        
        // Buscar órdenes pendientes de transferencia cuya fecha límite ya haya expirado
        const resultado = await Licencia.updateMany(
            {
                "metodo_pago.pasarela": "transferencia_manual",
                "estado": "pendiente_pago",
                "fecha_limite_pago": { $lt: ahora }
            },
            {
                $set: { estado: "cancelada_por_tiempo" }
            }
        );

        if (resultado.modifiedCount > 0) {
            console.log(`[CRON] Se cancelaron ${resultado.modifiedCount} órdenes de compra por exceder el plazo de 3 días.`);
        }
    } catch (error) {
        console.error("[CRON] Error al ejecutar la revisión de órdenes vencidas:", error);
    }
});

console.log("Módulo de tareas automáticas (Cron Job) inicializado correctamente.");