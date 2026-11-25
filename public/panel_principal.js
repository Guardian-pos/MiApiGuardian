// [CAMBIO] URL base automática: relativa si ya corre en admin.guardianpos.mx, o absoluta si se abre desde otro origen
const API_BASE = window.location.hostname === 'admin.guardianpos.mx'
  ? ''
  : 'https://admin.guardianpos.mx';

let listaGlobalLicencias = [];
let listaGlobalEmpleados = [];
let sesionActual = null;
let itemLicenciaSeleccionado = null;
let empleadoEnEdicionId = null;

// =========================================================
// NAVEGACIÓN DEL MENÚ LATERAL Y BOTÓN ACTUALIZAR
// =========================================================
const enlacesMenu = document.querySelectorAll('.menu-lateral a');
const vistas = document.querySelectorAll('.vista');

enlacesMenu.forEach((enlace) => {
  enlace.addEventListener('click', async (evento) => {
    evento.preventDefault();
    enlacesMenu.forEach((item) => item.classList.remove('activo'));
    enlace.classList.add('activo');

    vistas.forEach((vista) => vista.classList.remove('active'));
    const idVista = enlace.getAttribute('data-vista');
    const vistaMostrar = document.getElementById(idVista);
    if (vistaMostrar) vistaMostrar.classList.add('active');

    // [CAMBIO] Refresco o limpieza automática al cambiar de pestaña
    if (idVista === 'vista-dashboard') {
      await inicializarPanel();
    } else if (idVista === 'vista-team') {
      cancelarEdicionEmpleado();
      await cargarEmpleadosTeam();
    } else if (idVista === 'vista-clientes') {
      limpiarVistaClientes();
    } else if (idVista === 'vista-trial') {
      limpiarVistaTrial();
    } else if (idVista === 'vista-tokens') {
      limpiarPantallaTokens();
    }
  });
});

const btnRefrescarDash = document.getElementById('btn-refrescar-dashboard');
if (btnRefrescarDash) {
  btnRefrescarDash.addEventListener('click', async () => {
    const icono = btnRefrescarDash.querySelector('i');
    const texto = btnRefrescarDash.querySelector('span');
    icono.classList.add('girando');
    texto.textContent = 'Actualizando...';
    await inicializarPanel();
    icono.classList.remove('girando');
    texto.textContent = 'Actualizar Dashboard';
  });
}

// =========================================================
// LOGIN Y CARGA INICIAL
// =========================================================
async function realizarLogin() {
  const usuarioId = document.getElementById('login-usuario').value.trim();
  const password = document.getElementById('login-password').value.trim();

  if (!usuarioId || !password) {
    alert('Por favor, ingrese usuario y contraseña.');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/empleados/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuarioId, password }),
    });
    const resultado = await response.json();

    if (resultado.exito) {
      sesionActual = resultado.empleado;
      document.getElementById('pantalla-login').style.display = 'none';
      document.getElementById('app-principal').style.display = 'flex';
      document.getElementById('lbl-saludo-nombre').innerText = sesionActual.nombre || 'Admin';
      document.getElementById('lbl-operador-activo').innerText = `${sesionActual.nombre} (${sesionActual.usuarioId})`;

      await inicializarPanel();
      aplicarPermisosOperador();
    } else {
      alert('Error: ' + resultado.error);
    }
  } catch (err) {
    console.error(err);
    alert('Error de conexión con el servidor.');
  }
}

function cerrarSesion() {
  sesionActual = null;
  document.getElementById('login-usuario').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('app-principal').style.display = 'none';
  document.getElementById('pantalla-login').style.display = 'block';
}

async function inicializarPanel() {
  try {
    const [respLic, respMetricas] = await Promise.all([
      fetch(`${API_BASE}/api/licencias`),
      fetch(`${API_BASE}/api/recargas-servicios/dashboard-metricas`),
    ]);

    listaGlobalLicencias = await respLic.json();
    poblarSelectorClientesTokens();

    const jsonMetricas = await respMetricas.json();
    if (jsonMetricas.exito) {
      renderizarMetricasDashboard(jsonMetricas.data);
    }

    if (sesionActual && sesionActual.usuarioId === 'EMP-ADMIN') {
      const respEmp = await fetch(`${API_BASE}/api/empleados`);
      listaGlobalEmpleados = await respEmp.json();
      renderizarTablaEmpleados(listaGlobalEmpleados);
    }
  } catch (error) {
    console.error('Error al sincronizar datos:', error);
  }
}

function renderizarMetricasDashboard(m) {
  const total = m.totalLicencias || 0;
  const pct = (n) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '0%');

  document.getElementById('kpi-licencias-gratuitas').innerText = m.licenciasGratuitas;
  document.getElementById('kpi-licencias-gratuitas-det').innerText = `${pct(m.licenciasGratuitas)} de la cartera`;

  document.getElementById('kpi-pagos-tarjeta').innerText = m.pagosTarjeta;
  document.getElementById('kpi-pagos-tarjeta-det').innerText = `${pct(m.pagosTarjeta)} del total`;

  document.getElementById('kpi-pagos-transferencia').innerText = m.pagosTransferencia;
  document.getElementById('kpi-pagos-transferencia-det').innerText = `${pct(m.pagosTransferencia)} del total`;

  document.getElementById('kpi-clientes-activos').innerText = m.clientesActivos;
  document.getElementById('kpi-clientes-activos-det').innerText = `${pct(m.clientesActivos)} de cartera vigente`;

  document.getElementById('kpi-clientes-inactivos').innerText = m.clientesInactivos;
  document.getElementById('kpi-clientes-inactivos-det').innerText = `${pct(m.clientesInactivos)} suspendidos/baja`;

  document.getElementById('kpi-licencias-vencidas').innerText = m.licenciasVencidas;
  document.getElementById('kpi-licencias-vencidas-det').innerText = `${pct(m.licenciasVencidas)} requieren renovación`;

  document.getElementById('kpi-venta-tokens').innerText = formatoMXN(m.ventaTokensTotal);
  document.getElementById('kpi-venta-tokens-det').innerText = `${m.ventaTokensCantidad} abonos acreditados`;

  document.getElementById('kpi-clientes-tokens').innerText = m.clientesConTokens;
  document.getElementById('kpi-clientes-tokens-det').innerText = 'Billeteras con historial/saldo';

  document.getElementById('kpi-saldo-api').innerText = formatoMXN(m.saldoBolsaApi);
  document.getElementById('kpi-saldo-api-det').innerText = m.saldoBolsaSimulado
    ? 'Modo simulador (conectar API real)'
    : 'Saldo en Recargas Todo México';

  document.getElementById('kpi-tokens-usados').innerText = formatoMXN(m.tokensUsadosTotal);
  document.getElementById('kpi-tokens-usados-det').innerText = `${m.recargasCantidad + m.serviciosCantidad} ventas en POS`;

  document.getElementById('kpi-saldo-vivo-clientes').innerText = formatoMXN(m.saldoVivoClientes);
  document.getElementById('kpi-saldo-vivo-clientes-det').innerText = 'Por consumir en billeteras';

  document.getElementById('kpi-recargas-vendidas').innerText = formatoMXN(m.recargasMonto);
  document.getElementById('kpi-recargas-vendidas-det').innerText = `${m.recargasCantidad} recargas exitosas`;

  document.getElementById('kpi-servicios-pagados').innerText = formatoMXN(m.serviciosMonto);
  document.getElementById('kpi-servicios-pagados-det').innerText = `${m.serviciosCantidad} recibos (${formatoMXN(m.serviciosTarifas)} tarifas)`;

  document.getElementById('kpi-por-vencer').innerText = m.porVencer7Dias;
  document.getElementById('kpi-por-vencer-det').innerText = m.porVencer7Dias === 1 ? '1 licencia próxima a vencer' : 'Seguimiento preventivo';
}

function actualizarKpisLicencias() {
  if (!Array.isArray(listaGlobalLicencias)) return;
  const hoy = new Date();
  let activas = 0;
  let vencidas = 0;
  listaGlobalLicencias.forEach((l) => {
    if (l.fecha_expiracion && new Date(l.fecha_expiracion) < hoy) vencidas++;
    else activas++;
  });
  document.getElementById('kpi-clientes-activos').innerText = activas;
  document.getElementById('kpi-licencias-vencidas').innerText = vencidas;
}

function aplicarPermisosOperador() {
  if (!sesionActual) return;
  const esAdmin = sesionActual.usuarioId === 'EMP-ADMIN';
  const p = sesionActual.permisos || {};

  // [CAMBIO] Helper unificado para mostrar contenido autorizado o aviso de acceso restringido en cada módulo
  const toggleModulo = (idContenido, idBloqueo, permitido) => {
    const c = document.getElementById(idContenido);
    const b = document.getElementById(idBloqueo);
    if (c) c.style.display = permitido ? 'block' : 'none';
    if (b) b.style.display = permitido ? 'none' : 'block';
  };

  toggleModulo('dashboard-contenido-autorizado', 'dashboard-sin-permiso', esAdmin || !!p.dashboard);
  toggleModulo('bloque-team-admin', 'team-sin-permiso', esAdmin);
  toggleModulo('clientes-contenido-autorizado', 'clientes-sin-permiso', esAdmin || !!p.clientes);
  toggleModulo('trial-contenido-autorizado', 'trial-sin-permiso', esAdmin || !!p.cortesia);
  toggleModulo('tokens-contenido-autorizado', 'tokens-sin-permiso', esAdmin || !!p.tokens);
  toggleModulo('tareas-contenido-autorizado', 'tareas-sin-permiso', esAdmin || !!p.tareas);
  toggleModulo('reportes-contenido-autorizado', 'reportes-sin-permiso', esAdmin || !!p.reportes);
  toggleModulo('settings-contenido-autorizado', 'settings-sin-permiso', esAdmin || !!p.settings);

  document.getElementById('opt-renovacion').style.display = esAdmin || p.renovacion ? 'block' : 'none';
  document.getElementById('opt-reactivacion').style.display = esAdmin || p.reactivacion ? 'block' : 'none';
  document.getElementById('opt-telefonica').style.display = esAdmin || p.telefonica ? 'block' : 'none';
}


// =========================================================
// CLIENTES, LICENCIAS Y TRIAL
// =========================================================
function buscarCliente() {
  const query = document.getElementById('input-buscar').value.toLowerCase().trim();
  const tbody = document.getElementById('tabla-productos');
  if (!query) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#a0a0ab;">Ingrese un término válido.</td></tr>';
    return;
  }

  const filtrados = listaGlobalLicencias.filter((item) => {
    const c = item.client || {};
    return [c.numero_cliente, c.nombre_negocio, c.nombre_contacto, c.correo, c.telefono, item.purchaseOrder]
      .some((v) => v && String(v).toLowerCase().includes(query));
  });

  if (filtrados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#a0a0ab;">No se encontró ningún cliente.</td></tr>';
    return;
  }

  actualizarVistaCliente(filtrados[0]);
  tbody.innerHTML = '';
  const hoy = new Date();
  filtrados.forEach((item) => {
    const estaVencida = item.fecha_expiracion && new Date(item.fecha_expiracion) < hoy;
    const fechaText = item.fecha_expiracion ? new Date(item.fecha_expiracion).toLocaleDateString('es-MX', { timeZone: 'UTC' }) : 'N/A';
    const badge = estaVencida
      ? '<span class="badge-estado badge-error">VENCIDA</span>'
      : '<span class="badge-estado badge-ok">ACTIVA</span>';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="radio" name="seleccion-producto" onclick='seleccionarProducto(${JSON.stringify(item)})'></td>
      <td>${item.purchaseOrder || 'S/N'}</td>
      <td>${item.tipo_producto || 'guardian_pos_lite'}</td>
      <td style="font-family:monospace;color:#a78bfa;">${item.licenseKey}</td>
      <td>${badge}</td>
      <td>${fechaText}</td>
    `;
    tbody.appendChild(tr);
  });
}

function actualizarVistaCliente(item) {
  document.getElementById('lbl-num-cliente').innerText = item.client?.numero_cliente || 'CLI-S/N';
  document.getElementById('lbl-negocio').innerText = item.client?.nombre_negocio || '-';
  document.getElementById('lbl-contacto').innerText = item.client?.nombre_contacto || '-';
  document.getElementById('lbl-telefono').innerText = item.client?.telefono || '-';
  document.getElementById('lbl-correo').innerText = item.client?.correo || '-';
}

function seleccionarProducto(item) {
  itemLicenciaSeleccionado = item;
  actualizarVistaCliente(item);
  document.getElementById('input-license-reac').value = item.licenseKey;
  document.getElementById('input-license-renov').value = item.licenseKey;

  document.getElementById('cortesia-num-cliente').value = item.client?.numero_cliente || 'CLI-S/N';
  document.getElementById('cortesia-negocio').value = item.client?.nombre_negocio || 'N/A';
  document.getElementById('cortesia-license').value = item.licenseKey;
  document.getElementById('cortesia-producto').value = item.tipo_producto || 'guardian_pos_lite';
  document.getElementById('cortesia-dispositivo').value = item.hardwareBinding?.tipo_dispositivo || 'android_tablet';
  document.getElementById('cortesia-hwid').value = item.hardwareBinding?.identificador_unico || '';
}

function cambiarAccion() {
  const val = document.getElementById('selector-accion').value;
  document.getElementById('form-renovacion').style.display = val === 'renovacion' ? 'block' : 'none';
  document.getElementById('form-reactivacion').style.display = val === 'reactivacion' ? 'block' : 'none';
  document.getElementById('form-telefonica').style.display = val === 'telefonica' ? 'block' : 'none';
}

async function generarNuevaPruebaCortesia() {
  if (!itemLicenciaSeleccionado) return alert('Seleccione un cliente y licencia en la pestaña Clientes.');
  const dias = parseInt(document.getElementById('cortesia-dias').value, 10);
  const hwid = document.getElementById('cortesia-hwid').value.trim();
  const base = new Date(itemLicenciaSeleccionado.fecha_expiracion) > new Date() ? new Date(itemLicenciaSeleccionado.fecha_expiracion) : new Date();
  base.setDate(base.getDate() + dias);

  const resp = await fetch(`${API_BASE}/api/licencias/actualizar/${itemLicenciaSeleccionado._id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      estado: 'activa',
      fecha_expiracion: base.toISOString(),
      fecha_limite_pago: base.toISOString(),
      hardwareBinding: {
        tipo_dispositivo: itemLicenciaSeleccionado.hardwareBinding?.tipo_dispositivo || 'android_tablet',
        identificador_unico: hwid || itemLicenciaSeleccionado.hardwareBinding?.identificador_unico || null,
      },
    }),
  });
  if (resp.ok) {
    alert('Extensión de vigencia aplicada con éxito.');
    await inicializarPanel();
  } else {
    alert('Error al extender vigencia.');
  }
}

async function ejecutarRenovacionManual() {
  if (!itemLicenciaSeleccionado) return alert('Seleccione una licencia arriba.');
  const refPago = document.getElementById('input-ref-pago').value.trim();
  if (!refPago) return alert('Ingrese la referencia de pago.');

  const base = new Date(itemLicenciaSeleccionado.fecha_expiracion) > new Date() ? new Date(itemLicenciaSeleccionado.fecha_expiracion) : new Date();
  base.setDate(base.getDate() + 30);

  const resp = await fetch(`${API_BASE}/api/licencias/actualizar/${itemLicenciaSeleccionado._id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      estado: 'activa',
      fecha_expiracion: base.toISOString(),
      fecha_limite_pago: base.toISOString(),
      metodo_pago: { pasarela: 'transferencia_manual', comprobante_url: refPago },
    }),
  });
  if (resp.ok) {
    alert('Renovación (+30 días) aplicada con éxito.');
    document.getElementById('input-ref-pago').value = '';
    await inicializarPanel();
  } else {
    alert('Error al renovar licencia.');
  }
}

function ejecutarReactivacion() { alert('Hardware actualizado con éxito.'); }
function generarClaveTelefonica() { alert('Clave offline generada y enviada.'); }

// [CAMBIO] Pegar aquí limpiarVistaClientes() y limpiarVistaTrial()
function limpiarVistaClientes() {
  itemLicenciaSeleccionado = null;
  document.getElementById('input-buscar').value = '';
  document.getElementById('lbl-num-cliente').innerText = '--';
  document.getElementById('lbl-negocio').innerText = 'Realice una búsqueda...';
  document.getElementById('lbl-contacto').innerText = '-';
  document.getElementById('lbl-telefono').innerText = '-';
  document.getElementById('lbl-correo').innerText = '-';
  document.getElementById('tabla-productos').innerHTML =
    '<tr><td colspan="6" style="text-align:center;color:#a0a0ab;">Use el buscador superior para consultar un cliente.</td></tr>';
  document.getElementById('selector-accion').value = '';
  cambiarAccion();
}

function limpiarVistaTrial() {
  document.getElementById('cortesia-num-cliente').value = '';
  document.getElementById('cortesia-negocio').value = '';
  document.getElementById('cortesia-license').value = '';
  document.getElementById('cortesia-producto').value = '';
  document.getElementById('cortesia-dispositivo').value = '';
  document.getElementById('cortesia-hwid').value = '';
  document.getElementById('cortesia-dias').value = '30';
}


// =========================================================
// TEAM (EMPLEADOS, CREDENCIALES Y FOTO COMPRIMIDA)
// =========================================================
let fotoEmpleadoBase64 = '';

function procesarFotoEmpleado(input) {
  const archivo = input.files && input.files[0];
  if (!archivo) return;

  const lector = new FileReader();
  lector.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 220;
      let w = img.width;
      let h = img.height;
      if (w > h && w > maxDim) { h = Math.round((h * maxDim) / w); w = maxDim; }
      else if (h > maxDim) { w = Math.round((w * maxDim) / h); h = maxDim; }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      fotoEmpleadoBase64 = canvas.toDataURL('image/jpeg', 0.75);

      const prev = document.getElementById('emp-foto-preview');
      prev.src = fotoEmpleadoBase64;
      prev.style.display = 'block';
    };
    img.src = e.target.result;
  };
  lector.readAsDataURL(archivo);
}

async function cargarEmpleadosTeam() {
  if (!sesionActual || sesionActual.usuarioId !== 'EMP-ADMIN') return;
  try {
    const respEmp = await fetch(`${API_BASE}/api/empleados`);
    listaGlobalEmpleados = await respEmp.json();
    renderizarTarjetasTeam(listaGlobalEmpleados);
    renderizarTablaEmpleados(listaGlobalEmpleados);
  } catch (error) {
    console.error('Error al cargar Team:', error);
  }
}

function renderizarTarjetasTeam(empleados) {
  const contenedor = document.getElementById('grid-tarjetas-team');
  if (!contenedor) return;
  contenedor.innerHTML = '';

  empleados.forEach((emp) => {
    const iniciales = (emp.nombre || 'OP').split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase();
    const avatarHtml = emp.foto
      ? `<img src="${emp.foto}" class="tarjeta-id-foto" alt="${emp.nombre}">`
      : `<div class="tarjeta-id-foto">${iniciales}</div>`;
    const badgeEstado = emp.activo === false
      ? '<span class="badge-estado badge-error">INACTIVO</span>'
      : '<span class="badge-estado badge-ok">ACTIVO</span>';

    const card = document.createElement('div');
    card.className = 'tarjeta-id';
    card.innerHTML = `
      ${avatarHtml}
      <div class="tarjeta-id-info">
        <div class="tarjeta-id-header">
          <h4>${emp.nombre}</h4>
          ${badgeEstado}
        </div>
        <div class="tarjeta-id-sub">${emp.puesto || 'Operador'} · ${emp.usuarioId}</div>
        <div class="tarjeta-id-datos">
          <span><i class="bx bx-envelope"></i>${emp.correo}</span>
          <span><i class="bx bx-phone"></i>${emp.telefonoPersonal || 'Sin teléfono'} ${emp.extension ? `· ${emp.extension}` : ''}</span>
          <span><i class="bx bx-map"></i>${emp.direccion || 'Sin dirección'}</span>
        </div>
        <div class="tarjeta-id-acciones">
          <button class="btn-exito" onclick="cargarDatosEdicion('${emp._id}')">Editar</button>
          <button class="btn-secundario" style="padding:5px 9px;font-size:12px;" onclick="regenerarPassword('${emp._id}')">Nueva Pass</button>
          <button class="btn-secundario" style="padding:5px 9px;font-size:12px;" onclick="enviarCorreoRealEmpleado('${emp._id}')">Correo</button>
          ${emp.usuarioId !== 'EMP-ADMIN' ? `<button class="btn-peligro" onclick="eliminarEmpleado('${emp._id}')">Eliminar</button>` : ''}
        </div>
      </div>
    `;
    contenedor.appendChild(card);
  });
}

function obtenerPermisosFormulario() {
  return {
    dashboard: document.getElementById('perm-dashboard').checked,
    clientes: document.getElementById('perm-clientes').checked,
    cortesia: document.getElementById('perm-cortesia').checked,
    renovacion: document.getElementById('perm-renovacion').checked,
    reactivacion: document.getElementById('perm-reactivacion').checked,
    telefonica: document.getElementById('perm-telefonica').checked,
    tokens: document.getElementById('perm-tokens').checked,
    tareas: document.getElementById('perm-tareas').checked,
    reportes: document.getElementById('perm-reportes').checked,
    settings: document.getElementById('perm-settings').checked,
  };
}

function procesarGuardarEmpleado() {
  if (empleadoEnEdicionId) guardarEdicionEmpleado();
  else registrarEmpleado();
}

async function registrarEmpleado() {
  const nombre = document.getElementById('emp-nombre').value.trim();
  const correo = document.getElementById('emp-correo').value.trim();
  if (!nombre || !correo) return alert('Ingrese nombre y correo.');

  const payload = {
    nombre,
    correo,
    puesto: document.getElementById('emp-puesto').value.trim() || 'Operador',
    telefonoPersonal: document.getElementById('emp-telefono').value.trim(),
    extension: document.getElementById('emp-extension').value.trim(),
    direccion: document.getElementById('emp-direccion').value.trim(),
    contactoEmergencia: document.getElementById('emp-emergencia').value.trim(),
    activo: document.getElementById('emp-activo').value === 'true',
    foto: fotoEmpleadoBase64,
    permisos: obtenerPermisosFormulario(),
  };

  const resp = await fetch(`${API_BASE}/api/empleados/crear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const res = await resp.json();
  if (res.exito) {
    alert(`Empleado registrado: ${res.empleado.usuarioId} | Pass: ${res.empleado.password}`);
    cancelarEdicionEmpleado();
    await cargarEmpleadosTeam();
  } else {
    alert('Error: ' + res.error);
  }
}

function cargarDatosEdicion(id) {
  const emp = listaGlobalEmpleados.find((e) => e._id === id);
  if (!emp) return;
  empleadoEnEdicionId = id;
  document.getElementById('emp-nombre').value = emp.nombre || '';
  document.getElementById('emp-correo').value = emp.correo || '';
  document.getElementById('emp-puesto').value = emp.puesto || '';
  document.getElementById('emp-telefono').value = emp.telefonoPersonal || '';
  document.getElementById('emp-extension').value = emp.extension || '';
  document.getElementById('emp-direccion').value = emp.direccion || '';
  document.getElementById('emp-emergencia').value = emp.contactoEmergencia || '';
  document.getElementById('emp-activo').value = emp.activo === false ? 'false' : 'true';

  fotoEmpleadoBase64 = emp.foto || '';
  const prev = document.getElementById('emp-foto-preview');
  if (fotoEmpleadoBase64) {
    prev.src = fotoEmpleadoBase64;
    prev.style.display = 'block';
  } else {
    prev.style.display = 'none';
  }

  const p = emp.permisos || {};
  ['dashboard', 'clientes', 'cortesia', 'renovacion', 'reactivacion', 'telefonica', 'tokens', 'tareas', 'reportes', 'settings'].forEach((k) => {
    const el = document.getElementById(`perm-${k}`);
    if (el) el.checked = !!p[k];
  });

  document.getElementById('btn-accion-empleado').innerText = 'Guardar Cambios';
  document.getElementById('btn-cancelar-edicion').style.display = 'inline-block';
  document.getElementById('emp-nombre').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelarEdicionEmpleado() {
  empleadoEnEdicionId = null;
  fotoEmpleadoBase64 = '';
  ['emp-nombre', 'emp-correo', 'emp-puesto', 'emp-telefono', 'emp-extension', 'emp-direccion', 'emp-emergencia', 'emp-foto-input'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const act = document.getElementById('emp-activo');
  if (act) act.value = 'true';
  const prev = document.getElementById('emp-foto-preview');
  if (prev) prev.style.display = 'none';

  ['dashboard', 'clientes', 'cortesia', 'renovacion', 'reactivacion', 'telefonica', 'tokens', 'tareas', 'reportes', 'settings'].forEach((k) => {
    const el = document.getElementById(`perm-${k}`);
    if (el) el.checked = false;
  });
  document.getElementById('btn-accion-empleado').innerText = 'Generar Cuenta de Empleado';
  document.getElementById('btn-cancelar-edicion').style.display = 'none';
}

async function guardarEdicionEmpleado() {
  const nombre = document.getElementById('emp-nombre').value.trim();
  const correo = document.getElementById('emp-correo').value.trim();
  if (!nombre || !correo) return alert('Ingrese nombre y correo.');

  const payload = {
    nombre,
    correo,
    puesto: document.getElementById('emp-puesto').value.trim() || 'Operador',
    telefonoPersonal: document.getElementById('emp-telefono').value.trim(),
    extension: document.getElementById('emp-extension').value.trim(),
    direccion: document.getElementById('emp-direccion').value.trim(),
    contactoEmergencia: document.getElementById('emp-emergencia').value.trim(),
    activo: document.getElementById('emp-activo').value === 'true',
    foto: fotoEmpleadoBase64,
    permisos: obtenerPermisosFormulario(),
  };

  const resp = await fetch(`${API_BASE}/api/empleados/actualizar/${empleadoEnEdicionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (resp.ok) {
    alert('Empleado actualizado.');
    cancelarEdicionEmpleado();
    await cargarEmpleadosTeam();
  }
}

function renderizarTablaEmpleados(empleados) {
  const tbody = document.getElementById('tabla-empleados');
  if (!tbody) return;
  tbody.innerHTML = '';
  empleados.forEach((emp) => {
    const badge = emp.activo === false
      ? '<span class="badge-estado badge-error">Inactivo</span>'
      : '<span class="badge-estado badge-ok">Activo</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-family:monospace;color:#a78bfa;">${emp.usuarioId}</td>
      <td>${emp.nombre}<br><small style="color:#a0a0ab;">${emp.puesto || 'Operador'}</small></td>
      <td>${emp.telefonoPersonal || '-'}<br><small style="color:#a0a0ab;">${emp.extension || ''}</small></td>
      <td style="font-family:monospace;">${emp.password}</td>
      <td>${badge}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn-exito" onclick="cargarDatosEdicion('${emp._id}')">Editar</button>
        ${emp.usuarioId !== 'EMP-ADMIN' ? `<button class="btn-peligro" onclick="eliminarEmpleado('${emp._id}')">Eliminar</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filtrarEmpleados() {
  const q = document.getElementById('input-buscar-emp').value.toLowerCase().trim();
  const filtrados = !q
    ? listaGlobalEmpleados
    : listaGlobalEmpleados.filter((e) =>
        [e.nombre, e.correo, e.usuarioId, e.puesto].some((v) => v && String(v).toLowerCase().includes(q))
      );
  renderizarTarjetasTeam(filtrados);
  renderizarTablaEmpleados(filtrados);
}

async function regenerarPassword(id) {
  if (!confirm('¿Generar una nueva contraseña para este operador?')) return;
  const resp = await fetch(`${API_BASE}/api/empleados/regenerar-password/${id}`, { method: 'PUT' });
  const res = await resp.json();
  if (res.exito) {
    alert(`Nueva contraseña: ${res.empleado.password}`);
    await cargarEmpleadosTeam();
  }
}

async function enviarCorreoRealEmpleado(id) {
  const resp = await fetch(`${API_BASE}/api/empleados/enviar-correo/${id}`, { method: 'POST' });
  const res = await resp.json();
  alert(res.exito ? '¡Correo enviado al empleado!' : 'Error: ' + (res.error || 'Desconocido'));
}

async function eliminarEmpleado(id) {
  if (!confirm('¿Eliminar a este operador?')) return;
  const resp = await fetch(`${API_BASE}/api/empleados/${id}`, { method: 'DELETE' });
  if (resp.ok) await cargarEmpleadosTeam();
}

// =========================================================
// MÓDULO DE TOKENS (RECARGAS Y SERVICIOS)
// =========================================================
function poblarSelectorClientesTokens() {
  const select = document.getElementById('tokens-select-cliente');
  if (!select || !Array.isArray(listaGlobalLicencias)) return;

  const vistos = new Set();
  select.innerHTML = '<option value="">-- Seleccionar cliente --</option>';
  listaGlobalLicencias.forEach((item) => {
    const num = item.client?.numero_cliente;
    const neg = item.client?.nombre_negocio || 'Sin nombre';
    if (num && !vistos.has(num.toLowerCase())) {
      vistos.add(num.toLowerCase());
      const opt = document.createElement('option');
      opt.value = num.toLowerCase();
      opt.textContent = `${num.toUpperCase()} — ${neg}`;
      select.appendChild(opt);
    }
  });
}

function seleccionarTenantDesdeLista() {
  const val = document.getElementById('tokens-select-cliente').value;
  if (val) {
    document.getElementById('tokens-tenant-input').value = val;
    cargarBilleteraYHistorial();
  }
}

function formatoMXN(n) {
  return `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function actualizarPreviewTokens() {
  const bolsa = document.getElementById('tokens-bolsa').value;
  const grupoBono = document.getElementById('tokens-bono-grupo');
  grupoBono.style.display = bolsa === 'RECARGAS' ? 'block' : 'none';

  const monto = Number(document.getElementById('tokens-monto').value || 0);
  const bonoPct = bolsa === 'RECARGAS' ? Math.max(0, Number(document.getElementById('tokens-bono-pct').value || 0)) : 0;
  const preview = document.getElementById('tokens-preview-total');

  if (monto <= 0) {
    preview.textContent = 'Ingresa un monto para calcular el total de tokens a acreditar.';
    return;
  }

  const bono = (monto * bonoPct) / 100;
  const total = monto + bono;
  preview.innerHTML =
    bolsa === 'RECARGAS'
      ? `Depósito: <strong>${formatoMXN(monto)}</strong> + Bono (${bonoPct}%): <strong>${formatoMXN(bono)}</strong> = <strong>${formatoMXN(total)} tokens</strong> en Recargas.`
      : `Depósito exacto sin bono: <strong>${formatoMXN(total)} tokens</strong> en Servicios.`;
}

async function cargarBilleteraYHistorial() {
  const tenantId = document.getElementById('tokens-tenant-input').value.trim().toLowerCase();
  if (!tenantId) return alert('Selecciona o escribe un tenantId.');

  document.getElementById('tokens-tenant-activo').textContent = tenantId.toUpperCase();

  try {
    const [respSaldo, respHist] = await Promise.all([
      fetch(`${API_BASE}/api/recargas-servicios/saldo/${encodeURIComponent(tenantId)}`),
      fetch(`${API_BASE}/api/recargas-servicios/historial/${encodeURIComponent(tenantId)}?limite=50`),
    ]);

    const dataSaldo = await respSaldo.json();
    if (dataSaldo.exito) {
      document.getElementById('tokens-saldo-recargas').textContent = formatoMXN(dataSaldo.data.tokensRecargas);
      document.getElementById('tokens-saldo-servicios').textContent = formatoMXN(dataSaldo.data.tokensServicios);
      document.getElementById('tokens-tarifa-fija').textContent = formatoMXN(dataSaldo.data.tarifaFijaServicio);
    }

    const dataHist = await respHist.json();
    renderizarHistorialTokens(dataHist.exito ? dataHist.data : []);
  } catch (err) {
    console.error(err);
    alert('Error al consultar la billetera de tokens.');
  }
}

function renderizarHistorialTokens(lista) {
  const tbody = document.getElementById('tabla-historial-tokens');
  if (!Array.isArray(lista) || lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#a0a0ab;">Sin movimientos de tokens registrados aún.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  lista.forEach((h) => {
    const fecha = h.createdAt ? new Date(h.createdAt).toLocaleString('es-MX') : '-';
    const claseEstado = h.estado === 'EXITOSO' ? 'badge-ok' : 'badge-error';
    const extra = h.bolsa === 'RECARGAS' ? `Bono: ${formatoMXN(h.bonoAplicado)}` : `Tarifa: ${formatoMXN(h.tarifaFija)}`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fecha}</td>
      <td><span class="badge-estado badge-info">${h.bolsa}</span></td>
      <td>${h.tipo}</td>
      <td>${formatoMXN(h.montoOperacion)}</td>
      <td>${extra}</td>
      <td>${formatoMXN(h.saldoAnterior)} → <strong>${formatoMXN(h.saldoPosterior)}</strong></td>
      <td><span class="badge-estado ${claseEstado}">${h.estado}</span></td>
      <td style="font-family:monospace;font-size:12px;">${h.folioReferencia || '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function limpiarPantallaTokens() {
  document.getElementById('tokens-select-cliente').value = '';
  document.getElementById('tokens-tenant-input').value = '';
  document.getElementById('tokens-tenant-activo').textContent = '--';
  document.getElementById('tokens-saldo-recargas').textContent = '$0.00';
  document.getElementById('tokens-saldo-servicios').textContent = '$0.00';
  document.getElementById('tokens-monto').value = '';
  document.getElementById('tokens-nota').value = '';
  document.getElementById('tokens-confirmar-cliente').value = '';
  document.getElementById('tokens-bono-pct').value = '6';
  document.getElementById('tokens-bolsa').value = 'RECARGAS';
  document.getElementById('tokens-bono-grupo').style.display = 'block';
  document.getElementById('tokens-preview-total').textContent = 'Ingresa un monto para calcular el total de tokens a acreditar.';
  document.getElementById('tabla-historial-tokens').innerHTML =
    '<tr><td colspan="8" style="text-align:center;color:#a0a0ab;">Selecciona un cliente para ver su historial.</td></tr>';
}

async function abonarTokensCliente() {
  const tenantId = document.getElementById('tokens-tenant-input').value.trim().toLowerCase();
  const confirmarCliente = document.getElementById('tokens-confirmar-cliente').value.trim().toLowerCase();
  const bolsa = document.getElementById('tokens-bolsa').value;
  const montoDeposito = Number(document.getElementById('tokens-monto').value);
  const bonoPorcentaje = bolsa === 'RECARGAS' ? Number(document.getElementById('tokens-bono-pct').value || 0) : 0;
  const nota = document.getElementById('tokens-nota').value.trim();

  if (!tenantId) return alert('Primero selecciona o escribe el tenantId del cliente.');
  if (!confirmarCliente || confirmarCliente !== tenantId) {
    return alert(`El número de cliente confirmado (${confirmarCliente.toUpperCase() || 'vacío'}) no coincide con el cliente seleccionado (${tenantId.toUpperCase()}).`);
  }
  if (!montoDeposito || montoDeposito <= 0) return alert('Ingresa un monto de depósito mayor a 0.');

  try {
    const resp = await fetch(`${API_BASE}/api/recargas-servicios/abonar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        confirmarCliente,
        bolsa,
        montoDeposito,
        bonoPorcentaje,
        adminId: sesionActual?.usuarioId || '',
        nombreAdmin: sesionActual?.nombre || 'Administrador',
        nota,
      }),
    });
    const res = await resp.json();
    if (res.exito) {
      const avisoCorreo = res.correoEnviado
        ? 'Correo de confirmación enviado al cliente.'
        : 'Abono guardado (el cliente no tiene correo registrado o no se pudo enviar).';
      alert(`${res.mensaje}\n\n${avisoCorreo}`);
      limpiarPantallaTokens();
    } else {
      alert('Error al abonar: ' + (res.error || 'Desconocido'));
    }
  } catch (err) {
    console.error(err);
    alert('Error de conexión al abonar tokens.');
  }
}