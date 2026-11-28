const express = require('express');
const router = express.Router();
const Licencia = require('../models/Licencia');
const Empleado = require('../models/Empleado'); // [CAMBIO]
const Producto = require('../models/Product'); // [CAMBIO] Para depuración en cascada de trials
const Movimiento = require('../models/movimientos'); // [CAMBIO] Para depuración en cascada de trials
const BilleteraTokens = require('../models/BilleteraTokens'); // [CAMBIO] Para depuración en cascada de trials
const HistorialTokens = require('../models/HistorialTokens'); // [CAMBIO] Para depuración en cascada de trials
const { Resend } = require('resend');           // [CAMBIO]
const bcrypt = require('bcrypt');
const { firmarToken, requerirAdmin } = require('../middleware/seguridad'); // [CAMBIO]

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null; // [CAMBIO]

// RUTA: Registrar una nueva licencia / orden de compra (simulando la pasarela o compra web)
router.post('/crear', async (req, res) => {
    if (!req.body.client || !req.body.client.numero_cliente) {
        if (!req.body.client) req.body.client = {};
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        req.body.client.numero_cliente = `CLI-${randomNum}`;
    } 
    try {
        // Asegurar estado inicial acorde al método de pago si no viene definido
        if (!req.body.estado) {
            if (req.body.metodo_pago?.pasarela === 'transferencia_manual') {
                req.body.estado = 'licencia_activa';
            } else if (req.body.metodo_pago?.pasarela === 'stripe') {
                req.body.estado = 'stripe_activa';
            } else {
                req.body.estado = 'prueba_activa';
            }
        }

        const nuevaLicencia = new Licencia(req.body);
        const licenciaGuardada = await nuevaLicencia.save();
        res.status(201).json({
            exito: true,
            mensaje: "Orden de compra y licencia registrada correctamente en la nube.",
            datos: licenciaGuardada
        });
    } catch (error) {
        res.status(500).json({
            exito: false,
            error: error.message
        });
    }
});

// RUTA: Consultar todas las licencias (para alimentar el panel de administración web)
// [CAMBIO] Protegida: solo administradores autenticados pueden ver la lista completa
router.get('/', requerirAdmin, async (req, res) => {
    try {
        const licencias = await Licencia.find();
        res.status(200).json(licencias);
    } catch (error) {
        res.status(500).json({
            exito: false,
            error: error.message
        });
    }
});

// [CAMBIO] Recupera únicamente la licencia vinculada a un hardwareId y emite token de terminal
router.post('/recuperar-por-hardware', async (req, res) => {
    try {
        const hwId = String(req.body?.identificador_unico || '').trim();
        if (!hwId || hwId === 'unknown_device') {
            return res.status(400).json({ exito: false, error: 'identificador_unico inválido.' });
        }

        const licencia = await Licencia.findOne({ 'hardwareBinding.identificador_unico': hwId });
        if (!licencia) {
            return res.status(404).json({ exito: false, error: 'Dispositivo sin licencia vinculada.' });
        }

        const tenantId = String(licencia.client?.numero_cliente || '').trim().toLowerCase();
        const tokenTerminal = firmarToken(
            {
                tipo: 'terminal',
                tenantId,
                licenseKey: licencia.licenseKey,
                hardwareId: hwId,
            },
            60 * 60 * 24 * 30
        );

        return res.status(200).json({
            exito: true,
            token: tokenTerminal,
            datos: {
                licenseKey: licencia.licenseKey,
                numero_cliente: licencia.client?.numero_cliente || '',
                nombre_negocio: licencia.client?.nombre_negocio || '',
                estado: licencia.estado,
                fecha_expiracion: licencia.fecha_expiracion,
                usuarios: licencia.usuarios || [],
            },
        });
    } catch (error) {
        return res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Actualizar o extender la vigencia/estado de una licencia desde el panel web (por ID)
router.put('/actualizar/:id', requerirAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            fecha_expiracion,
            estado,
            client,
            metodo_pago,
            hardwareBinding,
            adminId,          // [CAMBIO]
            tipoOperacion,    // [CAMBIO] 'RENOVACION' | 'CORTESIA' | 'REACTIVACION'
            confirmarCliente, // [CAMBIO]
            motivoCortesia,   // [CAMBIO]
            montoPagado       // [CAMBIO]
        } = req.body;

        // [CAMBIO] Validación real de permisos en MongoDB
        if (adminId && adminId !== 'EMP-ADMIN') {
            const empleado = await Empleado.findOne({ usuarioId: String(adminId).trim() });
            const p = empleado?.permisos || {};
            const autorizado =
                (tipoOperacion === 'RENOVACION' && p.renovacion) ||
                (tipoOperacion === 'CORTESIA' && p.cortesia) ||
                (tipoOperacion === 'REACTIVACION' && p.reactivacion);

            if (!empleado || (tipoOperacion && !autorizado)) {
                return res.status(403).json({
                    exito: false,
                    error: "No tienes permiso autorizado para realizar esta operación."
                });
            }
        }

        const licencia = await Licencia.findById(id);
        if (!licencia) {
            return res.status(404).json({ exito: false, error: "Licencia no encontrada en el sistema." });
        }

        // [CAMBIO] Validación cruzada de número de cliente
        if (confirmarCliente !== undefined) {
            const numReal = String(licencia.client?.numero_cliente || '').trim().toLowerCase();
            const numConf = String(confirmarCliente || '').trim().toLowerCase();
            if (!numConf || numConf !== numReal) {
                return res.status(400).json({
                    exito: false,
                    error: "El número de cliente confirmado no coincide con la licencia seleccionada."
                });
            }
        }

        if (fecha_expiracion) licencia.fecha_expiracion = fecha_expiracion;
        if (estado) licencia.estado = estado;

        // [CAMBIO] Reiniciar banderas de notificación del cron al renovar, reactivar o extender fecha
        if (fecha_expiracion || ['RENOVACION', 'CORTESIA', 'REACTIVACION'].includes(tipoOperacion)) {
            licencia.aviso_7d_enviado = false;
            licencia.aviso_3d_enviado = false;
            licencia.aviso_vencimiento_enviado = false;
        }

        if (metodo_pago) {
            if (!licencia.metodo_pago) licencia.metodo_pago = {};
            if (metodo_pago.pasarela) licencia.metodo_pago.pasarela = metodo_pago.pasarela;
            if (metodo_pago.comprobante_url) licencia.metodo_pago.comprobante_url = metodo_pago.comprobante_url;
            if (metodo_pago.stripe_customer_id) licencia.metodo_pago.stripe_customer_id = metodo_pago.stripe_customer_id;
        }

        if (hardwareBinding) {
            if (!licencia.hardwareBinding) licencia.hardwareBinding = {};
            if (hardwareBinding.tipo_dispositivo) licencia.hardwareBinding.tipo_dispositivo = hardwareBinding.tipo_dispositivo;
            if (hardwareBinding.identificador_unico) licencia.hardwareBinding.identificador_unico = hardwareBinding.identificador_unico;
        }

        if (client) {
            if (client.nombre_negocio) licencia.client.nombre_negocio = client.nombre_negocio;
            if (client.nombre_contacto) licencia.client.nombre_contacto = client.nombre_contacto;
            if (client.telefono) licencia.client.telefono = client.telefono;
            if (client.correo) licencia.client.correo = client.correo;
        }

        licencia.updatedAt = Date.now();
        const licenciaActualizada = await licencia.save();

        // [CAMBIO] Enviar correo de confirmación al cliente si es Renovación o Cortesía
        let correoEnviado = false;
        const correoDestino = licenciaActualizada.client?.correo ? String(licenciaActualizada.client.correo).trim() : '';
        if (resend && correoDestino && (tipoOperacion === 'RENOVACION' || tipoOperacion === 'CORTESIA')) {
            try {
                const fechaVigencia = new Date(licenciaActualizada.fecha_expiracion).toLocaleDateString('es-MX', {
                    timeZone: 'America/Mexico_City',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                });
                const titulo = tipoOperacion === 'RENOVACION' ? 'Renovación de Licencia Confirmada' : 'Extensión de Vigencia / Cortesía';
                const detalleExtra = tipoOperacion === 'RENOVACION'
                    ? `<tr><td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;"><strong>Referencia:</strong></td><td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;">${metodo_pago?.comprobante_url || 'N/A'} ${montoPagado ? `($${Number(montoPagado).toFixed(2)} MXN)` : ''}</td></tr>`
                    : `<tr><td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;"><strong>Motivo:</strong></td><td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;">${motivoCortesia || 'Extensión autorizada'}</td></tr>`;

                const { error } = await resend.emails.send({
                    from: 'Guardián POS <soporte@guardianpos.mx>',
                    to: [correoDestino],
                    subject: `${licenciaActualizada.client?.nombre_negocio || 'Cliente'} - ${titulo} (Guardián POS)`,
                    html: `
                      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1F2937; border: 1px solid #E5E7EB; border-radius: 10px;">
                        <h2 style="margin: 0 0 10px 0; color: #7C3AED;">Guardián POS — ${titulo}</h2>
                        <p style="font-size: 14px;">¡Hola <strong>${licenciaActualizada.client?.nombre_negocio || ''}</strong>! Tu licencia ha sido actualizada correctamente.</p>
                        <table style="width:100%; border-collapse:collapse; margin: 14px 0; font-size: 13px;">
                          <tr><td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;"><strong>Número de Cliente:</strong></td><td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;">${licenciaActualizada.client?.numero_cliente || 'N/A'}</td></tr>
                          <tr><td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;"><strong>Clave de Licencia:</strong></td><td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;font-family:monospace;">${licenciaActualizada.licenseKey}</td></tr>
                          <tr><td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;"><strong>Nueva Vigencia:</strong></td><td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;"><strong style="color:#059669;">${fechaVigencia}</strong></td></tr>
                          ${detalleExtra}
                        </table>
                         <!-- [CAMBIO] Instrucciones para restablecer el servicio en la tableta -->
                        <div style="background: #F5F3FF; border: 1px solid #DDD6FE; border-left: 4px solid #7C3AED; border-radius: 6px; padding: 12px 14px; margin: 14px 0; font-size: 13px; color: #1F2937; line-height: 1.5;">
                          <strong>¿Cómo restablecer tu acceso en la tableta?</strong>
                          <ol style="margin: 6px 0 0 18px; padding: 0;">
                            <li>Ve a tu tableta y oprime el botón <strong>Actualizar</strong> o <strong>Verificar pago</strong> para que tu licencia se restablezca de inmediato.</li>
                            <li>O bien, <strong>reinicia la aplicación</strong> por completo y el sistema ingresará en automático.</li>
                          </ol>
                        </div>
                        <p style="font-size: 13px; color: #4B5563;">Este correo fue enviado por cortesía de <strong>Guardián POS</strong>. ¡Gracias por seguir trabajando con nosotros!</p>
                      </div>
                    `
                });
                correoEnviado = !error;
            } catch (errCorreo) {
                console.error('>>> [CORREO LICENCIA ERROR]:', errCorreo);
            }
        }

        res.status(200).json({
            exito: true,
            mensaje: "Licencia actualizada y extendida correctamente.",
            correoEnviado,
            datos: licenciaActualizada
        });
    } catch (error) {
        res.status(500).json({
            exito: false,
            error: error.message
        });
    }
});

// RUTA: Activar licencia desde la tablet (Onboarding / Primer inicio)
router.post('/activar', async (req, res) => {
    const { licenseKey, identificador_unico } = req.body;

    try {
        if (!licenseKey) {
            return res.status(400).json({
                exito: false,
                error: "La clave de licencia es obligatoria."
            });
        }

        // 1. Buscar la licencia en la base de datos
        const licencia = await Licencia.findOne({ licenseKey });

        if (!licencia) {
            return res.status(404).json({
                exito: false,
                error: "La clave de licencia no existe en el sistema."
            });
        }

        // 2. Validar bloqueo manual por impago, suspensión o expiración en cualquier modalidad
        const estadosInactivos = ['suspendida', 'inactiva', 'vencida', 'prueba_vencida', 'licencia_vencida', 'stripe_vencida', 'cancelada_por_tiempo'];
        if (estadosInactivos.includes(licencia.estado)) {
            return res.status(403).json({
                exito: false,
                codigo_error: 'LICENCIA_INACTIVA',
                error: "Licencia suspendida o vencida. Por favor contacte a soporte."
            });
        }

        // 3. Validar si ya expiró por fecha
        if (licencia.fecha_expiracion && new Date() > new Date(licencia.fecha_expiracion)) {
            return res.status(403).json({
                exito: false,
                codigo_error: 'LICENCIA_EXPIRADA',
                error: "La licencia o periodo de prueba ha expirado. Por favor, renueve su plan."
            });
        }

        // 4. Vincular el dispositivo si aún no está asignado o validar que coincida
        if (!licencia.hardwareBinding.identificador_unico) {
            licencia.hardwareBinding.identificador_unico = identificador_unico || 'tablet_generica';
            licencia.hardwareBinding.tipo_dispositivo = 'android_tablet';
        } else if (identificador_unico && licencia.hardwareBinding.identificador_unico !== identificador_unico) {
            return res.status(403).json({
                exito: false,
                codigo_error: 'DISPOSITIVO_NO_AUTORIZADO',
                error: "Esta licencia ya se encuentra vinculada a otro dispositivo físico."
            });
        }

        // 5. Asegurar estado activo correspondiente según la pasarela si estaba pendiente
        if (licencia.estado === 'pendiente_pago') {
            if (licencia.metodo_pago.pasarela === 'transferencia_manual') {
                licencia.estado = 'licencia_activa';
            } else if (licencia.metodo_pago.pasarela === 'stripe') {
                licencia.estado = 'stripe_activa';
            } else {
                licencia.estado = 'prueba_activa';
            }
        }

        licencia.updatedAt = Date.now();
        await licencia.save();

        // 6. Responder con los datos críticos que la tablet necesita guardar localmente
        const tokenTerminal = firmarToken(
          {
              tipo: 'terminal',
              tenantId: String(licencia.client?.numero_cliente || '').trim().toLowerCase(),
              licenseKey: licencia.licenseKey,
              hardwareId: licencia.hardwareBinding?.identificador_unico || '',
          },
          60 * 60 * 24 * 30
        ); // [CAMBIO]

        res.status(200).json({
            exito: true,
            mensaje: "Licencia activada y vinculada correctamente.",
            token: tokenTerminal, // [CAMBIO]
            datos: {
                numero_cliente: licencia.client.numero_cliente,
                nombre_negocio: licencia.client.nombre_negocio,
                tipo_producto: licencia.tipo_producto,
                fecha_expiracion: licencia.fecha_expiracion,
                estado: licencia.estado,
                tieneUsuarios: licencia.usuarios && licencia.usuarios.length > 0
            }
        });

    } catch (error) {
        res.status(500).json({
            exito: false,
            error: error.message
        });
    }
});

// RUTA NUEVA: Validar estado en tiempo real (para PIN y Cierres de Caja - Impago / Expiración)
router.post('/validar-estado', async (req, res) => {
    const { licenseKey, identificador_unico } = req.body;

    try {
        if (!licenseKey) {
            return res.status(400).json({ exito: false, error: "Falta la clave de licencia." });
        }

        const licencia = await Licencia.findOne({ licenseKey });

        if (!licencia) {
            return res.status(404).json({ exito: false, error: "La licencia no existe en el sistema." });
        }

        // 1. Revisar bloqueo por impago o suspensión
        const estadosInactivos = ['suspendida', 'inactiva', 'vencida', 'prueba_vencida', 'licencia_vencida', 'stripe_vencida', 'cancelada_por_tiempo'];
        if (estadosInactivos.includes(licencia.estado)) {
            return res.status(403).json({
                exito: false,
                codigo_error: 'LICENCIA_INACTIVA',
                error: "Licencia suspendida o vencida. Por favor contacte a soporte."
            });
        }

        // 2. Revisar expiración
        if (licencia.fecha_expiracion && new Date() > new Date(licencia.fecha_expiracion)) {
            return res.status(403).json({
                exito: false,
                codigo_error: 'LICENCIA_EXPIRADA',
                error: "Su periodo de prueba o licencia ha expirado. Realice su pago para continuar."
            });
        }

        // 3. Revisar consistencia de hardware si se envía
        if (identificador_unico && licencia.hardwareBinding && licencia.hardwareBinding.identificador_unico) {
            if (licencia.hardwareBinding.identificador_unico !== identificador_unico) {
                return res.status(403).json({
                    exito: false,
                    codigo_error: 'DISPOSITIVO_NO_AUTORIZADO',
                    error: "Esta licencia está vinculada a otro dispositivo físico."
                });
            }
        }

        const tokenTerminal = firmarToken(
            {
                tipo: 'terminal',
                tenantId: String(licencia.client?.numero_cliente || '').trim().toLowerCase(),
                licenseKey: licencia.licenseKey,
                hardwareId: licencia.hardwareBinding?.identificador_unico || '',
            },
            60 * 60 * 24 * 30
        ); // [CAMBIO]

        res.status(200).json({
            exito: true,
            mensaje: "Licencia vigente y activa.",
            token: tokenTerminal, // [CAMBIO]
            datos: {
                numero_cliente: licencia.client.numero_cliente,
                fecha_expiracion: licencia.fecha_expiracion,
                estado: licencia.estado
            }
        });

    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// [CAMBIO] Lista únicamente los usuarios de una licencia sin exponer toda la colección
router.post('/usuarios/listar', async (req, res) => {
    try {
        const cleanKey = String(req.body?.licenseKey || '').trim().toUpperCase();
        if (!cleanKey) {
            return res.status(400).json({ exito: false, error: 'licenseKey es obligatorio.' });
        }
        const licencia = await Licencia.findOne({
            licenseKey: new RegExp(`^${cleanKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
        });
        if (!licencia) {
            return res.status(404).json({ exito: false, error: 'Licencia no encontrada.' });
        }
        return res.status(200).json({ exito: true, usuarios: licencia.usuarios || [] });
    } catch (error) {
        return res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Registrar un usuario (empleado/administrador) en una licencia específica
router.post('/usuarios/registrar', async (req, res) => {
    const { licenseKey, nombre, rol, pin } = req.body;

    try {
        const licencia = await Licencia.findOne({ licenseKey });

        if (!licencia) {
            return res.status(404).json({ exito: false, error: "Licencia no encontrada." });
        }

        licencia.usuarios.push({ nombre, rol, pin });
        licencia.updatedAt = Date.now();
        await licencia.save();

        res.status(201).json({
            exito: true,
            mensaje: "Usuario registrado correctamente en la nube.",
            usuarios: licencia.usuarios
        });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Validar login de usuario por PIN dentro de la licencia
router.post('/usuarios/login', async (req, res) => {
    const { licenseKey, pin } = req.body;

    try {
        const licencia = await Licencia.findOne({ licenseKey });

        if (!licencia) {
            return res.status(404).json({ exito: false, error: "Licencia no encontrada." });
        }

        const usuarioEncontrado = licencia.usuarios.find(u => u.pin === pin);

        if (!usuarioEncontrado) {
            return res.status(401).json({ exito: false, error: "PIN incorrecto o usuario no registrado." });
        }

        res.status(200).json({
            exito: true,
            mensaje: "Acceso concedido.",
            usuario: {
                nombre: usuarioEncontrado.nombre,
                rol: usuarioEncontrado.rol,
                numero_cliente: licencia.client.numero_cliente
            }
        });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// =========================================================================
// MÓDULOS NUEVOS: SOPORTE PARA EL CONFIGURACION PROVIDER DE FLUTTER
// =========================================================================

// RUTA: Obtener los datos generales de configuración del negocio por licenseKey
router.get('/configuracion/:licenseKey', async (req, res) => {
    try {
        const { licenseKey } = req.params;
        const licencia = await Licencia.findOne({ licenseKey });

        if (!licencia) {
            return res.status(404).json({ exito: false, error: "Licencia no encontrada." });
        }

        res.status(200).json({
            exito: true,
            datos: {
                nombre_negocio: licencia.client.nombre_negocio,
                direccion: licencia.client.facturacion?.razon_social || '', 
                telefono: licencia.client.telefono,
                correo: licencia.client.correo
            }
        });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Actualizar la configuración general del negocio
router.put('/configuracion/:licenseKey', async (req, res) => {
    try {
        const { licenseKey } = req.params;
        const { nombre_negocio, direccion, telefono, correo } = req.body;

        const licencia = await Licencia.findOne({ licenseKey });
        if (!licencia) {
            return res.status(404).json({ exito: false, error: "Licencia no encontrada." });
        }

        if (nombre_negocio) licencia.client.nombre_negocio = nombre_negocio;
        if (telefono) licencia.client.telefono = telefono;
        if (correo) licencia.client.correo = correo;
        
        licencia.updatedAt = Date.now();
        await licencia.save();

        res.status(200).json({ exito: true, mensaje: "Configuración actualizada correctamente." });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Guardar o actualizar un usuario de sucursal (Cajero / Administrador con PIN)
router.post('/usuarios/guardar', async (req, res) => {
    try {
        const { licenseKey, id, nombre, rol, pin } = req.body;

        const licencia = await Licencia.findOne({ licenseKey });
        if (!licencia) {
            return res.status(404).json({ exito: false, error: "Licencia no encontrada." });
        }

        if (id) {
            const usuarioIndex = licencia.usuarios.findIndex(u => u._id.toString() === id);
            if (usuarioIndex !== -1) {
                if (nombre) licencia.usuarios[usuarioIndex].nombre = nombre;
                if (rol) licencia.usuarios[usuarioIndex].rol = rol;
                if (pin) licencia.usuarios[usuarioIndex].pin = pin;
            } else {
                licencia.usuarios.push({ nombre, rol, pin });
            }
        } else {
            licencia.usuarios.push({ nombre, rol, pin });
        }

        licencia.updatedAt = Date.now();
        await licencia.save();

        res.status(200).json({ exito: true, mensaje: "Usuario guardado o actualizado correctamente." });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// =========================================================================
// MÓDULO WEB: AUTENTICACIÓN, ACTIVACIÓN Y CREACIÓN DE CONTRASEÑA
// =========================================================================

// RUTA: Iniciar sesión en el portal web con correo y contraseña web cifrada
router.post('/web/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ exito: false, error: 'Faltan datos obligatorios.' });
        }

        const licencia = await Licencia.findOne({ 'client.correo': email });

        if (!licencia || !licencia.passwordWeb) {
            return res.status(401).json({ exito: false, error: 'Credenciales incorrectas o cuenta no activada.' });
        }

        const passwordValido = await bcrypt.compare(password, licencia.passwordWeb);

        if (!passwordValido) {
            return res.status(401).json({ exito: false, error: 'Contraseña web incorrecta.' });
        }

        return res.status(200).json({
            exito: true,
            mensaje: '¡Bienvenido al panel!',
            datos: {
                numero_cliente: licencia.client.numero_cliente,
                nombre_negocio: licencia.client.nombre_negocio,
                correo: licencia.client.correo
            }
        });

    } catch (error) {
        console.error('Error en login web:', error);
        return res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Verificar datos (Licencia/Número de cliente y Correo) para primer acceso web
router.post('/web/verificar-activacion', async (req, res) => {
    try {
        const { licencia, email } = req.body;
        console.log("--> RECIBIDA PETICIÓN DE VERIFICACIÓN WEB:", req.body);
        if (!licencia || !email) {
            return res.status(400).json({ 
                exito: false, 
                error: 'Debe proporcionar la clave de licencia/número de cliente y el correo electrónico.' 
            });
        }

        const clienteLicencia = await Licencia.findOne({ 
            $or: [{ licenseKey: licencia }, { 'client.numero_cliente': licencia }],
            'client.correo': email 
        });

        if (!clienteLicencia) {
            return res.status(404).json({ 
                exito: false, 
                error: 'No se encontró ningún registro con esos datos. Verifique su licencia y correo.' 
            });
        }

        return res.status(200).json({ 
            exito: true, 
            mensaje: 'Datos verificados correctamente.', 
            idLicencia: clienteLicencia._id 
        });

    } catch (error) {
        console.error('Error al verificar activación web:', error);
        return res.status(500).json({ exito: false, error: error.message });
    }
});

// RUTA: Guardar la Contraseña Web por primera vez en el documento de la licencia
router.post('/web/crear-password', async (req, res) => {
    try {
        const { idLicencia, passwordWeb } = req.body;

        if (!idLicencia || !passwordWeb) {
            return res.status(400).json({ 
                exito: false, 
                error: 'Faltan datos obligatorios para crear la contraseña.' 
            });
        }

        const licencia = await Licencia.findById(idLicencia);
        if (!licencia) {
            return res.status(404).json({ exito: false, error: 'Registro de licencia no encontrado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(passwordWeb, salt);

        licencia.passwordWeb = hashedPassword;
        licencia.webActivada = true;
        licencia.updatedAt = Date.now();
        
        await licencia.save();

        return res.status(200).json({ 
            exito: true, 
            mensaje: '¡Contraseña web creada con éxito! Ya puede iniciar sesión en su panel.' 
        });

    } catch (error) {
        console.error('Error al guardar la contraseña web:', error);
        return res.status(500).json({ exito: false, error: error.message });
    }
});

// [CAMBIO] RUTA: Eliminar en cascada licencias trial vencidas y toda su información de prueba
router.delete('/trials/depurar', requerirAdmin, async (req, res) => { // [CAMBIO]
    try {
        const { ids, adminId } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ exito: false, error: 'No se seleccionaron licencias para eliminar.' });
        }

        if (adminId && adminId !== 'EMP-ADMIN') {
            const empleado = await Empleado.findOne({ usuarioId: String(adminId).trim() });
            if (!empleado || !empleado.permisos?.cortesia) {
                return res.status(403).json({ exito: false, error: 'No tienes permiso autorizado para depurar trials.' });
            }
        }

        const licenciasVencidas = await Licencia.find({
            _id: { $in: ids },
            estado: 'prueba_vencida'
        });

        let eliminadas = 0;
        for (const lic of licenciasVencidas) {
            const numCliente = lic.client?.numero_cliente ? String(lic.client.numero_cliente).trim() : '';
            const cleanTenantId = numCliente.toLowerCase();

            if (cleanTenantId) {
                const otraLicencia = await Licencia.findOne({
                    _id: { $nin: ids },
                    'client.numero_cliente': new RegExp(`^${cleanTenantId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
                });

                if (!otraLicencia) {
                    await Promise.all([
                        Producto.deleteMany({ tenantId: cleanTenantId }),
                        Movimiento.deleteMany({ tenantId: cleanTenantId }),
                        BilleteraTokens.deleteMany({ tenantId: cleanTenantId }),
                        HistorialTokens.deleteMany({ tenantId: cleanTenantId }),
                    ]);
                }
            }

            await Licencia.deleteOne({ _id: lic._id });
            eliminadas++;
        }

        return res.status(200).json({
            exito: true,
            eliminadas,
            mensaje: `Se eliminaron ${eliminadas} licencia(s) de prueba vencidas y sus datos asociados.`
        });
    } catch (error) {
        console.error('>>> [ERROR DEPURAR TRIALS]:', error);
        return res.status(500).json({ exito: false, error: error.message });
    }
});

module.exports = router;