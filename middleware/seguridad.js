const crypto = require('crypto');

// Secreto JWT: usa JWT_SECRET de Render o deriva uno estable desde MONGO_URI para no fallar si aún no se configura
function obtenerSecretoJwt() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 16) {
    return process.env.JWT_SECRET.trim();
  }
  const base = process.env.MONGO_URI || 'guardian_pos_fallback_secret_key';
  return crypto.createHash('sha256').update(`guardian_jwt_${base}`).digest('hex');
}

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let pad = str.replace(/-/g, '+').replace(/_/g, '/');
  while (pad.length % 4 !== 0) pad += '=';
  return Buffer.from(pad, 'base64').toString('utf8');
}

function firmarToken(payload, ttlSegundos = 60 * 60 * 12) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = base64UrlEncode(
    JSON.stringify({
      ...payload,
      iat: ahora,
      exp: ahora + ttlSegundos,
    })
  );
  const datos = `${header}.${cuerpo}`;
  const firma = base64UrlEncode(
    crypto.createHmac('sha256', obtenerSecretoJwt()).update(datos).digest()
  );
  return `${datos}.${firma}`;
}

function verificarToken(token) {
  if (!token || typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;

  const [header, cuerpo, firmaRecibida] = partes;
  const datos = `${header}.${cuerpo}`;
  const firmaEsperada = base64UrlEncode(
    crypto.createHmac('sha256', obtenerSecretoJwt()).update(datos).digest()
  );

  const bufRec = Buffer.from(firmaRecibida);
  const bufEsp = Buffer.from(firmaEsperada);
  if (bufRec.length !== bufEsp.length || !crypto.timingSafeEqual(bufRec, bufEsp)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(cuerpo));
    const ahora = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < ahora) return null;
    return payload;
  } catch {
    return null;
  }
}

function extraerBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

function requerirAdmin(req, res, next) {
  const token = extraerBearerToken(req);
  const payload = verificarToken(token);
  if (!payload || payload.tipo !== 'admin') {
    return res.status(401).json({
      exito: false,
      error: 'Sesión administrativa inválida o expirada. Inicia sesión nuevamente.',
    });
  }
  req.admin = payload;
  return next();
}

function requerirTerminal(req, res, next) {
  const token = extraerBearerToken(req);
  const payload = verificarToken(token);
  if (!payload || (payload.tipo !== 'terminal' && payload.tipo !== 'admin')) {
    return res.status(401).json({
      exito: false,
      error: 'Terminal no autorizada. Reinicia o valida la licencia.',
    });
  }

  if (payload.tipo === 'terminal') {
    const tenantToken = String(payload.tenantId || '').trim().toLowerCase();
    const tenantSolicitado = String(
      req.body?.tenantId || req.params?.tenantId || req.query?.tenantId || ''
    )
      .trim()
      .toLowerCase();

    if (tenantSolicitado && tenantToken && tenantSolicitado !== tenantToken) {
      return res.status(403).json({
        exito: false,
        error: 'No tienes autorización para operar sobre otra sucursal.',
      });
    }
  }

  req.terminal = payload;
  return next();
}

// Rate Limiter en memoria por IP (sin dependencias externas)
function crearRateLimiter({ ventanaMs = 60000, maxIntentos = 30, mensaje = 'Demasiados intentos. Espera un minuto.' } = {}) {
  const registros = new Map();

  setInterval(() => {
    const ahora = Date.now();
    for (const [clave, info] of registros.entries()) {
      if (ahora > info.expira) registros.delete(clave);
    }
  }, Math.max(ventanaMs, 60000)).unref();

  return (req, res, next) => {
    const ip = String(req.ip || req.headers['x-forwarded-for'] || 'desconocida').split(',')[0].trim();
    const ahora = Date.now();
    const actual = registros.get(ip);

    if (!actual || ahora > actual.expira) {
      registros.set(ip, { conteo: 1, expira: ahora + ventanaMs });
      return next();
    }

    actual.conteo += 1;
    if (actual.conteo > maxIntentos) {
      return res.status(429).json({ exito: false, error: mensaje });
    }
    return next();
  };
}

module.exports = {
  firmarToken,
  verificarToken,
  requerirAdmin,
  requerirTerminal,
  crearRateLimiter,
};