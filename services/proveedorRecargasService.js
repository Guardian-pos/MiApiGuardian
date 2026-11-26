/**
 * Servicio adaptador para el proveedor de Recargas y Servicios (Recargas Todo México).
 * Soporta modo SIMULADOR / MOCK (por defecto) y conexión real SOAP 1.2 con API Key.
 */

const PROVEEDOR_MODO_MOCK = process.env.RECARGAS_MODO_MOCK !== 'false'; // true por defecto
const RTM_ENDPOINT = process.env.RTM_ENDPOINT || 'https://recargastodomexico.com/api/index.php';
const RTM_TIMEOUT_MS = 90000; // [CAMBIO] Timeout obligatorio de 90 segundos según manual RTM

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// [CAMBIO] Helpers XML sin dependencias externas
function escapeXml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(valor) {
  return String(valor ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extraerTag(xml, tag) {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = String(xml || '').match(regex);
  return match ? match[1].trim() : '';
}

function obtenerCredencialesRtm() {
  const usuario = String(process.env.RTM_USUARIO || '').trim();
  const password = String(process.env.RTM_PASSWORD || '').trim();
  const apiKey = String(process.env.RTM_API_KEY || '').trim();

  if (!usuario || !password) {
    throw new Error('Faltan variables de entorno RTM_USUARIO o RTM_PASSWORD en Render.');
  }
  return { usuario, password, apiKey };
}

// [CAMBIO] Cliente SOAP 1.2 (sin WSDL) usando fetch nativo con timeout de 90s y parser tolerante a atributos/namespaces
async function llamarRtmSoap(method, innerXml) {
  const action = `${RTM_ENDPOINT}#${method}`;
  const envelope =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope" xmlns:ns1="${RTM_ENDPOINT}">\n` +
    `  <env:Body>\n` +
    `    <ns1:${method}>\n` +
    `      <xml><![CDATA[${innerXml}]]></xml>\n` +
    `    </ns1:${method}>\n` +
    `  </env:Body>\n` +
    `</env:Envelope>`;

  const response = await fetch(RTM_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
    },
    body: envelope,
    signal: AbortSignal.timeout(RTM_TIMEOUT_MS),
  });

  const rawText = await response.text();
  if (!response.ok) {
    console.error(`>>> [RTM HTTP ${response.status}]:`, rawText.slice(0, 600));
    throw new Error(`HTTP ${response.status} al conectar con Recargas Todo México.`);
  }

  // [CAMBIO] Soporta <return>, <return xsi:type="...">, <ns1:return> o <*Return>
  const match =
    rawText.match(/<(?:[a-zA-Z0-9_-]+:)?return(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?return>/i) ||
    rawText.match(/<(?:[a-zA-Z0-9_-]+:)?[a-zA-Z0-9_]*Return(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?[a-zA-Z0-9_]*Return>/i);

  if (match) {
    return unescapeXml(match[1]);
  }

  // [CAMBIO] Si llegó un SOAP Fault, extrae su descripción real
  const faultMatch =
    rawText.match(/<(?:[a-zA-Z0-9_-]+:)?faultstring(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?faultstring>/i) ||
    rawText.match(/<(?:[a-zA-Z0-9_-]+:)?Text(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?Text>/i);

  if (faultMatch) {
    throw new Error(`SOAP Fault RTM: ${unescapeXml(faultMatch[1]).trim()}`);
  }

  // [CAMBIO] Si la respuesta ya trajo directo <Resultado> sin envolver en <return>
  if (/<Resultado>/i.test(rawText)) {
    return unescapeXml(rawText);
  }

  console.error('>>> [RTM RAW SOAP SIN RETURN]:', rawText.slice(0, 800));
  throw new Error(`Respuesta SOAP inesperada: ${rawText.replace(/<[^>]+>/g, ' ').trim().slice(0, 180)}`);
}

// [CAMBIO] Parsea el XML de obtenerProductos separando precio real (monto) y código RTM (codigoMonto)
function parsearCatalogoXml(innerXml) {
  const carriers = [];
  const carrierRegex = /<Carrier\s+([^>]*)>([\s\S]*?)<\/Carrier>/gi;
  let cMatch;

  while ((cMatch = carrierRegex.exec(innerXml)) !== null) {
    const attrs = cMatch[1] || '';
    const body = cMatch[2] || '';
    const idMatch = attrs.match(/id="([^"]*)"/i);
    const nombreMatch = attrs.match(/nombre="([^"]*)"/i);

    const productos = [];
    const prodRegex = /<Producto(?:\s+tipo="([^"]*)")?>([\s\S]*?)<\/Producto>/gi;
    let pMatch;

    while ((pMatch = prodRegex.exec(body)) !== null) {
      const pBody = pMatch[2] || '';
      const nombre = extraerTag(pBody, 'Nombre');
      const rawMontoStr = extraerTag(pBody, 'Monto');
      const codigoMonto = rawMontoStr !== '' && !Number.isNaN(Number(rawMontoStr))
        ? Number(rawMontoStr)
        : null;
      // [CAMBIO] Códigos >= 10000 (ej. 100006 -> $100, 25006 -> $25, 10005 -> $10) representan paquetes especiales
      const montoReal = codigoMonto !== null
        ? (codigoMonto >= 10000 ? Math.floor(codigoMonto / 1000) : codigoMonto)
        : null;
      const neto = Number(extraerTag(pBody, 'Neto') || 0);

      if (nombre) {
        productos.push({
          tipo: (pMatch[1] || 'recarga').trim().toLowerCase(),
          nombre,
          monto: montoReal,
          codigoMonto,
          neto,
        });
      }
    }

    carriers.push({
      id: idMatch ? idMatch[1] : '',
      nombre: nombreMatch ? nombreMatch[1] : (idMatch ? idMatch[1] : 'CARRIER'),
      productos,
    });
  }

  return carriers;
}

// =========================================================================
// 1. OBTENER SALDO (Bolsa Recargas y Bolsa Servicios en RTM)
// =========================================================================
async function obtenerSaldo() {
  if (PROVEEDOR_MODO_MOCK) {
    return {
      exito: true,
      simulado: true,
      saldoRecargas: Number(process.env.SALDO_API_MOCK || 0),
      saldoServicios: Number(process.env.SALDO_API_SERVICIOS_MOCK || 0),
      mensaje: 'Saldo simulado',
    };
  }

  const { usuario, password, apiKey } = obtenerCredencialesRtm();
  const apiKeyTag = apiKey ? `<ApiKey>${escapeXml(apiKey)}</ApiKey>` : '';
  const inner =
    `<PDV>` +
    `<Tipo>1</Tipo>` +
    apiKeyTag +
    `<Usuario>${escapeXml(usuario)}</Usuario>` +
    `<Password>${escapeXml(password)}</Password>` +
    `</PDV>`;

  const xmlResp = await llamarRtmSoap('obtenerSaldo', inner);
  const errorRtm = extraerTag(xmlResp, 'Error');
  if (errorRtm) {
    return { exito: false, simulado: false, mensaje: errorRtm, saldoRecargas: 0, saldoServicios: 0 };
  }

  return {
    exito: true,
    simulado: false,
    saldoRecargas: Number(extraerTag(xmlResp, 'SaldoRecargas') || 0),
    saldoServicios: Number(extraerTag(xmlResp, 'SaldoServicios') || 0),
    mensaje: extraerTag(xmlResp, 'Exito') || 'Consulta exitosa',
  };
}

// =========================================================================
// 2. OBTENER PRODUCTOS (Catálogo dinámico: recargas, tarjetas, servicios, digitales, todos)
// =========================================================================
async function obtenerProductos({ categoria = 'todos', carrier = '' } = {}) {
  if (PROVEEDOR_MODO_MOCK) {
    return {
      exito: true,
      simulado: true,
      categoria,
      carriers: [
        {
          id: 'TELCEL',
          nombre: 'TELCEL',
          productos: [10, 20, 30, 50, 100, 150, 200, 300, 500].map((m) => ({
            tipo: 'recarga',
            nombre: `TELCEL $${m}`,
            monto: m,
            codigoMonto: m,
            neto: Number((m * 0.925).toFixed(2)),
          })),
        },
        {
          id: 'AT&T',
          nombre: 'AT&T',
          productos: [10, 20, 30, 50, 100, 150, 200, 300, 500].map((m) => ({
            tipo: 'recarga',
            nombre: `AT&T $${m}`,
            monto: m,
            codigoMonto: m,
            neto: Number((m * 0.925).toFixed(2)),
          })),
        },
        {
          id: 'MOVISTAR',
          nombre: 'MOVISTAR',
          productos: [10, 20, 30, 50, 100, 150, 200, 300, 500].map((m) => ({
            tipo: 'recarga',
            nombre: `MOVISTAR $${m}`,
            monto: m,
            codigoMonto: m,
            neto: Number((m * 0.925).toFixed(2)),
          })),
        },
        {
          id: 'SERVICIOS',
          nombre: 'SERVICIOS',
          productos: [
            { tipo: 'servicio', nombre: 'TELMEX', monto: null, codigoMonto: null, neto: 7 },
            { tipo: 'servicio', nombre: 'CFE', monto: null, codigoMonto: null, neto: 7 },
            { tipo: 'servicio', nombre: 'MEGACABLE', monto: null, codigoMonto: null, neto: 7 },
            { tipo: 'servicio', nombre: 'TOTAL PLAY', monto: null, codigoMonto: null, neto: 7 },
            { tipo: 'servicio', nombre: 'IZZI', monto: null, codigoMonto: null, neto: 7 },
            { tipo: 'servicio', nombre: 'SKY', monto: null, codigoMonto: null, neto: 7 },
            { tipo: 'servicio', nombre: 'DISH', monto: null, codigoMonto: null, neto: 7 },
          ],
        },
      ],
    };
  }

  const { usuario, password, apiKey } = obtenerCredencialesRtm();
  const apiKeyTag = apiKey ? `<ApiKey>${escapeXml(apiKey)}</ApiKey>` : '';
  const carrierTag = carrier ? `<Carrier>${escapeXml(carrier)}</Carrier>` : '';
  const inner =
    `<Productos>` +
    `<Tipo>1</Tipo>` +
    apiKeyTag +
    `<Usuario>${escapeXml(usuario)}</Usuario>` +
    `<Password>${escapeXml(password)}</Password>` +
    `<Categoria>${escapeXml(categoria)}</Categoria>` +
    carrierTag +
    `</Productos>`;

  const xmlResp = await llamarRtmSoap('obtenerProductos', inner);
  const errorRtm = extraerTag(xmlResp, 'Error');
  if (errorRtm) {
    return { exito: false, simulado: false, mensaje: errorRtm, carriers: [] };
  }

  return {
    exito: true,
    simulado: false,
    categoria: extraerTag(xmlResp, 'Categoria') || categoria,
    carriers: parsearCatalogoXml(xmlResp),
  };
}

// =========================================================================
// 3. REALIZAR RECARGA
// =========================================================================
async function ejecutarRecarga({
  folioReferencia,
  compania,
  numeroTelefono,
  monto,
  codigoMonto = null, // [CAMBIO] Código exacto de RTM para paquetes especiales (ej. 100006)
  simularModo = 'OK', // 'OK' | 'ERROR' | 'TIMEOUT' (solo aplica en modo mock)
}) {
  if (PROVEEDOR_MODO_MOCK) {
    await esperar(400);

    if (simularModo === 'TIMEOUT') {
      return {
        exito: false,
        simulado: true,
        codigo: 'TIMEOUT',
        mensaje: 'Tiempo de espera agotado al conectar con el proveedor (simulado).',
        autorizacion: '',
      };
    }

    if (simularModo === 'ERROR') {
      return {
        exito: false,
        simulado: true,
        codigo: 'ERR_PROVEEDOR',
        mensaje: 'Número inválido o servicio temporalmente fuera de línea (simulado).',
        autorizacion: '',
      };
    }

    return {
      exito: true,
      simulado: true,
      codigo: '00',
      mensaje: `Recarga ${compania} de $${monto} aplicada correctamente (simulado).`,
      autorizacion: `SIM-${String(Date.now()).slice(-6)}`,
    };
  }

  const { usuario, password, apiKey } = obtenerCredencialesRtm();
  const apiKeyTag = apiKey ? `<ApiKey>${escapeXml(apiKey)}</ApiKey>` : '';
  // [CAMBIO] Usa codigoMonto cuando se trata de paquete especial (ej. 100006 para Sin Límite $100)
  const montoXml = Math.round(Number(codigoMonto || monto));

  const inner =
    `<Recarga>` +
    `<Tipo>1</Tipo>` +
    apiKeyTag +
    `<Usuario>${escapeXml(usuario)}</Usuario>` +
    `<Password>${escapeXml(password)}</Password>` +
    `<Carrier>${escapeXml(compania)}</Carrier>` +
    `<Monto>${montoXml}</Monto>` +
    `<Phone>${escapeXml(numeroTelefono)}</Phone>` +
    `</Recarga>`;

  const xmlResp = await llamarRtmSoap('realizarRecarga', inner);
  const errorRtm = extraerTag(xmlResp, 'Error');
  if (errorRtm) {
    return {
      exito: false,
      simulado: false,
      codigo: 'ERR_RTM',
      mensaje: errorRtm,
      autorizacion: '',
    };
  }

  return {
    exito: true,
    simulado: false,
    codigo: '00',
    mensaje: extraerTag(xmlResp, 'Exito') || 'Recarga realizada con éxito',
    autorizacion: extraerTag(xmlResp, 'Autorizacion'),
    ventaId: extraerTag(xmlResp, 'Venta'),
    nuevoSaldo: Number(extraerTag(xmlResp, 'NuevoSaldo') || 0),
  };
}

// =========================================================================
// 4. REALIZAR SERVICIO (Servicios y Tarjetas Digitales)
// =========================================================================
async function ejecutarPagoServicio({
  folioReferencia,
  nombreServicio,
  referenciaServicio,
  montoRecibo,
  telefonoCliente = '',
  emailCliente = '',
  simularModo = 'OK', // 'OK' | 'ERROR' | 'TIMEOUT'
}) {
  if (PROVEEDOR_MODO_MOCK) {
    await esperar(500);

    if (simularModo === 'TIMEOUT') {
      return {
        exito: false,
        simulado: true,
        codigo: 'TIMEOUT',
        mensaje: 'Timeout al procesar pago de servicio con el proveedor (simulado).',
        autorizacion: '',
      };
    }

    if (simularModo === 'ERROR') {
      return {
        exito: false,
        simulado: true,
        codigo: 'ERR_REFERENCIA',
        mensaje: 'Referencia de recibo rechazada o vencida (simulado).',
        autorizacion: '',
      };
    }

    return {
      exito: true,
      simulado: true,
      codigo: '00',
      mensaje: `Pago de servicio ${nombreServicio} por $${montoRecibo} aplicado (simulado).`,
      autorizacion: `SIMS-${String(Date.now()).slice(-6)}`,
      codigoPin: '',
    };
  }

  const { usuario, password, apiKey } = obtenerCredencialesRtm();
  const apiKeyTag = apiKey ? `<ApiKey>${escapeXml(apiKey)}</ApiKey>` : '';
  const phone10 = String(telefonoCliente || referenciaServicio || '').replace(/\D/g, '').slice(0, 10);
  const emailFinal = String(emailCliente || process.env.RTM_EMAIL_FALLBACK || 'soporte@guardianpos.mx').trim();
  const montoStr = Number(montoRecibo).toFixed(2);

  const inner =
    `<Servicio>` +
    `<Tipo>1</Tipo>` +
    apiKeyTag +
    `<Usuario>${escapeXml(usuario)}</Usuario>` +
    `<Password>${escapeXml(password)}</Password>` +
    `<Carrier>${escapeXml(nombreServicio)}</Carrier>` +
    `<Monto>${montoStr}</Monto>` +
    `<Phone>${escapeXml(phone10)}</Phone>` +
    `<Email>${escapeXml(emailFinal)}</Email>` +
    `</Servicio>`;

  const xmlResp = await llamarRtmSoap('realizarServicio', inner);
  const errorRtm = extraerTag(xmlResp, 'Error');
  if (errorRtm) {
    return {
      exito: false,
      simulado: false,
      codigo: 'ERR_RTM',
      mensaje: errorRtm,
      autorizacion: '',
      codigoPin: '',
    };
  }

  return {
    exito: true,
    simulado: false,
    codigo: '00',
    mensaje: extraerTag(xmlResp, 'Exito') || 'Servicio pagado con éxito',
    autorizacion: extraerTag(xmlResp, 'Autorizacion'),
    ventaId: extraerTag(xmlResp, 'Venta'),
    codigoPin: extraerTag(xmlResp, 'Codigo'),
    nuevoSaldo: Number(extraerTag(xmlResp, 'NuevoSaldo') || 0),
  };
}

module.exports = {
  obtenerSaldo,
  obtenerProductos,
  ejecutarRecarga,
  ejecutarPagoServicio,
};