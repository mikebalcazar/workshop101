/* workshop101 — el panel del administrador de una empresa cliente.
 *
 * Quien entra es el dueño o la administración de su empresa (o el superadmin
 * de la suite, que ve todas). Dos pantallas sobre rutas que la API ya tiene
 * desde el contrato 0.6.0: la gente (rol y apps por persona, alta, baja) y la
 * bitácora de cambios de la empresa.
 *
 * Todo pasa por `/s101/*`, que el Worker reenvía a `suite101-api` desde este
 * mismo origen (decisión D1). El Worker pone `X-App: workshop101`; aquí no se
 * manda.
 *
 * Regla de la casa: cambiar un rol o una app hace PATCH y se repinta con lo
 * que la API devuelve, nunca con lo que se cree. Los candados los pone la API
 * (nadie se toca a sí mismo, sólo un dueño toca dueños, el último dueño no se
 * baja); aquí sólo se deshabilita lo que la API va a rechazar, para no
 * ofrecer botones que no sirven. */

const API = '/s101';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Las seis apps de una empresa, con la llave que usa `orgs.apps` en la API. */
export const APPS = [
  ['dash', 'dash101'], ['quell', 'quell101'], ['peek', 'peek101'],
  ['cotizador', 'quote101'], ['roster', 'roster101'], ['nest', 'nest101'],
];

const ROLES = { owner: 'dueño', admin: 'administración', socio: 'socio', staff: 'oficina' };

/** Los errores de la API, con palabras de quien administra. */
const ERRORES = {
  codigo_invalido: 'Ese código no es. Revisa el correo y vuelve a intentar.',
  demasiados_intentos: 'Demasiados intentos. Espera un momento y vuelve a intentar.',
  sin_permiso: 'Esa cuenta no administra aquí.',
  sin_sesion: 'Tu sesión terminó. Vuelve a entrar.',
  org_desconocida: 'Esa empresa ya no existe.',
  org_inactiva: 'La empresa está suspendida. Avísale a Mike.',
  datos_invalidos: 'Revisa lo que escribiste.',
  correo_no_configurado: 'El envío de códigos no está disponible ahora. Intenta más tarde.',
  sin_respuesta: 'La API no contestó. Vuelve a intentar.',
  ultimo_owner: 'Es el último dueño de la empresa: no se puede bajar ni cambiar de rol. Nombra a otro dueño primero.',
  no_encontrado: 'Esa persona ya no está en la empresa.',
  google_no_configurado: 'Entrar con Google todavía no está prendido. Entra con tu correo.',
  origen_no_permitido: 'Esta dirección no está dada de alta para entrar con Google. Entra con tu correo.',
  entrada_invalida: 'El boleto de Google ya no sirve. Vuelve a intentar.',
};
const MOTIVOS = {
  a_ti_mismo: 'A ti mismo no te puedes cambiar ni quitar desde aquí.',
  solo_un_dueno_nombra_duenos: 'Sólo un dueño puede nombrar a otro dueño.',
  solo_un_dueno_toca_duenos: 'Sólo un dueño puede cambiar o quitar a otro dueño.',
  solo_administra: 'Esa cuenta no administra la empresa.',
};

class ErrorApi extends Error {
  constructor(error, estado, detalle) {
    super(MOTIVOS[detalle?.motivo] ?? ERRORES[error] ?? `Algo no salió bien (${error}). Vuelve a intentar.`);
    this.error = error; this.estado = estado; this.detalle = detalle;
  }
}

async function pedir(ruta, opciones = {}) {
  const r = await fetch(`${API}${ruta}`, {
    method: opciones.method ?? 'GET',
    headers: opciones.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
    credentials: 'include',
  });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch { /* no vino JSON */ }
  if (!r.ok || !cuerpo?.ok) throw new ErrorApi(cuerpo?.error ?? 'sin_respuesta', r.status, cuerpo?.detalle);
  return cuerpo.data;
}

function cuando(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const z = { timeZone: 'America/Mexico_City' };
  return d.toLocaleDateString('es-MX', { ...z, day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es-MX', { ...z, hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Cómo se lee un renglón de la bitácora de la empresa. */
const CAMPOS = { creada: 'Se creó la empresa', nombre: 'Nombre', plan: 'Plan', moneda: 'Moneda', activa: 'Activa', miembro: 'Gente', 'miembro.rol': 'Rol', 'miembro.apps': 'Apps' };
function campoLegible(campo) {
  if (campo.startsWith('apps.')) { const k = campo.slice(5); const app = APPS.find(([a]) => a === k); return `App ${app ? app[1] : k}`; }
  return CAMPOS[campo] || campo;
}
const valorLegible = (v) => (v === null || v === undefined || v === '' ? '—' : v === 'true' ? 'prendida' : v === 'false' ? 'apagada' : v);

function filasBitacora(filas) {
  if (!filas.length) return '<tr><td colspan="5" class="nota">Sin cambios apuntados todavía.</td></tr>';
  return filas.map((f) => `<tr>
    <td class="fecha">${esc(cuando(f.cuando))}</td>
    <td class="mono">${esc(f.quien)}</td>
    <td>${esc(campoLegible(f.campo))}</td>
    <td class="antes">${esc(valorLegible(f.antes))}</td>
    <td class="despues">${esc(valorLegible(f.despues))}</td>
  </tr>`).join('');
}

/* ─────────────── estado ─────────────── */

let YO = null;          // lo que dijo /yo
let MIAS = [];          // las empresas que administro: [{id, nombre, rol}]
let ORG = null;         // la empresa abierta: {id, nombre, apps, moneda}
let MI_ROL = null;      // 'owner' | 'admin' | 'super'
let GENTE = [];         // lo último que contestó GET /admin/orgs/:o/miembros
let porQuitar = null;
let correo = '';
const VISTAS = ['v-correo', 'v-clave', 'v-codigo', 'v-nueva', 'v-nomanda', 'v-cargando', 'v-gente', 'v-cambios'];
function mostrar(cual) {
  for (const v of VISTAS) $(v).hidden = v !== cual;
  for (const b of document.querySelectorAll('#menu [data-ir]')) b.classList.toggle('activo', `v-${b.dataset.ir}` === cual);
  window.scrollTo(0, 0);
}

function aviso(id, texto, tono = 'mal') {
  const el = $(id);
  el.className = `aviso ${tono}`;
  el.textContent = texto;
  el.hidden = !texto;
}

/* ─────────────── entrada ─────────────── */

function pintarClave() {
  $('clave-p').textContent = `La de tu cuenta, ${correo}.`;
  $('clave').value = '';
  $('err-clave').textContent = '';
  $('err-clave').classList.remove('bien');
  $('clave').focus();
}

function pintarCodigo() {
  $('codigo-p').textContent = `Te lo mandamos a ${correo}. Vence en 10 minutos.`;
  $('codigo').value = '';
  $('err-codigo').textContent = '';
  $('err-codigo').classList.remove('bien');
  $('codigo').focus();
}

function pintarNueva(primera) {
  $('nueva-t').textContent = primera ? 'Ponle una contraseña' : 'Tu contraseña nueva';
  $('nueva-p').textContent = primera
    ? 'Con ella entras de ahora en adelante, aquí y en las demás apps de la suite.'
    : 'Tecléala dos veces; la segunda, de memoria.';
  $('nueva').value = ''; $('nueva2').value = '';
  $('err-nueva').textContent = '';
  $('nueva').focus();
}

$('f-correo').onsubmit = async (ev) => {
  ev.preventDefault();
  const c = $('correo').value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(c)) { $('err-correo').textContent = 'Escribe un correo válido.'; return; }
  correo = c;
  $('err-correo').textContent = '';
  /* Ya no se pide un código aquí: se pasa a la contraseña. Y NO se le pregunta
   * a la API si esta persona tiene una, porque eso volvería esta pantalla un
   * directorio de quién tiene cuenta. Lo que no coincide se dice al intentar
   * entrar, con el mismo mensaje para un correo que no existe y para una
   * contraseña equivocada. */
  mostrar('v-clave');
  pintarClave();
};

// En staging la API devuelve `codigo_prueba`; la prueba lo lee desde fuera.
// Aquí no se enseña ni se guarda.
const pedirCodigo = () => pedir('/auth/codigo', { method: 'POST', body: { correo } });

$('f-clave').onsubmit = async (ev) => {
  ev.preventDefault();
  // La contraseña NO se recorta: un espacio al principio o al final es parte
  // de ella —la suite rechaza esas al ponerlas, no al usarlas— y recortarla
  // aquí haría que una buena no entrara y nadie sabría por qué.
  const v = $('clave').value;
  if (!v) { $('err-clave').textContent = 'Escribe tu contraseña.'; return; }
  const b = $('b-clave'); b.disabled = true; b.textContent = 'Entrando…';
  $('err-clave').textContent = '';
  try {
    await pedir('/auth/entrar', { method: 'POST', body: { correo, clave: v } });
    await entrar();
  } catch (e) {
    /* `sin_permiso` es el correo que no tiene cuenta y `clave_invalida` la
     * contraseña equivocada. Se dicen IGUAL a propósito: distinguirlos le
     * diría a cualquiera qué correos tienen cuenta aquí. */
    $('err-clave').textContent = e.error === 'sin_permiso' || e.error === 'clave_invalida'
      ? 'Ese correo y esa contraseña no coinciden.'
      : e.message;
    $('clave').value = '';
    $('clave').focus();
  } finally { b.disabled = false; b.textContent = 'Entrar'; }
};

/* «Olvidé mi contraseña», que es la misma puerta para quien nunca tuvo una. */
$('olvide').onclick = async () => {
  const b = $('olvide'); b.disabled = true; b.textContent = 'Mandando…';
  $('err-clave').textContent = '';
  try {
    await pedirCodigo();
    mostrar('v-codigo');
    pintarCodigo();
  } catch (e) { $('err-clave').textContent = e.message; }
  finally { b.disabled = false; b.textContent = 'Olvidé mi contraseña'; }
};

$('f-codigo').onsubmit = async (ev) => {
  ev.preventDefault();
  const v = $('codigo').value.trim();
  if (!/^\d{6}$/.test(v)) { $('err-codigo').textContent = 'El código son 6 dígitos.'; return; }
  const b = $('b-codigo'); b.disabled = true; b.textContent = 'Entrando…';
  $('err-codigo').textContent = '';
  try {
    await pedir('/auth/entrar', { method: 'POST', body: { correo, codigo: v } });
    await entrar();
  } catch (e) {
    let msg = e.message;
    const quedan = e.detalle?.intentos_restantes;
    if (e.error === 'codigo_invalido' && typeof quedan === 'number') {
      msg = quedan > 0 ? `Ese código no es. Te quedan ${quedan} ${quedan === 1 ? 'intento' : 'intentos'}.` : 'Ese código no es y se acabaron los intentos. Pide uno nuevo.';
    }
    $('err-codigo').textContent = msg;
    $('codigo').value = '';
    $('codigo').focus();
  } finally { b.disabled = false; b.textContent = 'Continuar'; }
};

$('f-nueva').onsubmit = async (ev) => {
  ev.preventDefault();
  const a = $('nueva').value, c = $('nueva2').value;
  if (a.length < 10) { $('err-nueva').textContent = 'La contraseña necesita al menos 10 caracteres.'; return; }
  if (a !== c) {
    // No se dice cuál falló ni se deja la primera puesta: si no coincidieron,
    // una de las dos está mal y no hay forma de saber cuál.
    $('err-nueva').textContent = 'No coincidieron. Vamos otra vez, desde el principio.';
    $('nueva').value = ''; $('nueva2').value = ''; $('nueva').focus();
    return;
  }
  const b = $('b-nueva'); b.disabled = true; b.textContent = 'Guardando…';
  $('err-nueva').textContent = '';
  try {
    await pedir('/auth/clave', { method: 'POST', body: { clave: a } });
    await entrar();
  } catch (e) {
    // La suite dice con palabras por qué una contraseña no pasa. Se enseña tal
    // cual: es más útil que «contraseña inválida».
    $('err-nueva').textContent = e.detalle?.porque || e.message;
    $('nueva').value = ''; $('nueva2').value = ''; $('nueva').focus();
  } finally { b.disabled = false; b.textContent = 'Guardar y entrar'; }
};

/* ─────────────── entrar con Google ───────────────
 * La API manda al navegador a Google y Google devuelve a la API; ella abre la
 * sesión y regresa aquí con `?entrada=<boleto de un solo uso>`, que el
 * arranque canjea por la cookie en este origen (ver abajo). Antes de saltar
 * se pregunta sin seguir el salto: si Google no está prendido en la API
 * contesta 501 y se dice aquí, no en una pestaña con un JSON. */
const urlGoogle = () => `${API}/auth/google?volver_a=${encodeURIComponent(location.origin + '/')}`;

$('b-google').onclick = async () => {
  const b = $('b-google'); b.disabled = true; b.textContent = 'Abriendo Google…';
  $('err-correo').textContent = '';
  try {
    const r = await fetch(urlGoogle(), { redirect: 'manual', credentials: 'include' });
    if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) { location.href = urlGoogle(); return; }
    let cuerpo = null;
    try { cuerpo = await r.json(); } catch { /* no vino JSON */ }
    throw new ErrorApi(cuerpo?.error ?? 'sin_respuesta', r.status, cuerpo?.detalle);
  } catch (e) {
    $('err-correo').textContent = e.message;
    b.disabled = false; b.textContent = 'Entrar con Google';
  }
};


$('reenviar').onclick = async () => {
  const b = $('reenviar'); b.disabled = true;
  try {
    await pedirCodigo();
    $('err-codigo').classList.add('bien');
    $('err-codigo').textContent = 'Te mandamos otro código.';
  } catch (e) { $('err-codigo').classList.remove('bien'); $('err-codigo').textContent = e.message; }
  finally { b.disabled = false; }
};

function alCorreo() {
  for (const e of ['err-correo', 'err-clave', 'err-codigo', 'err-nueva']) {
    $(e).textContent = ''; $(e).classList.remove('bien');
  }
  $('clave').value = ''; $('codigo').value = '';
  $('nueva').value = ''; $('nueva2').value = '';
  mostrar('v-correo');
  $('correo').focus();
}
$('otro-correo').onclick = alCorreo;
$('otro-correo-2').onclick = alCorreo;

async function salir() {
  try { await pedir('/auth/salir', { method: 'POST' }); } catch { /* la sesión ya no estaba */ }
  YO = null; MIAS = []; ORG = null; MI_ROL = null; GENTE = [];
  $('quien').hidden = true;
  $('menu').hidden = true;
  $('empresa-sel').hidden = true;
  mostrar('v-correo');
}
$('salir').onclick = salir;
$('nomanda-salir').onclick = salir;

/* ─────────────── entrar: sólo quien administra una empresa ───────────────
 * /yo trae las empresas del usuario con su rol; el superadmin las trae todas
 * como dueño. Se administra con `owner` o `admin`; con otra cosa no hay nada
 * que enseñar. Con una sola empresa se abre directo; con varias, el selector
 * de la barra. */

async function entrar() {
  mostrar('v-cargando');
  try {
    YO = await pedir('/yo');
  } catch (e) {
    $('err-clave').textContent = e.message;
    mostrar(correo ? 'v-clave' : 'v-correo');
    return;
  }

  /* Entró con un código y no tiene contraseña NI cuenta de Google ligada: no
   * tiene por dónde volver mañana, porque el código es de un solo uso y de
   * diez minutos. Se le pide antes de enseñarle nada.
   *
   * Con Google no se le pide, ni al entrar con él ni después: Google ya es
   * una forma de entrar. `tiene_google` llegó con el contrato 0.17.2, porque
   * sin él a quien tenía Google ligado se le pedía una contraseña cada vez
   * que entraba con un código, sin necesitarla (le pasó al dueño de la suite
   * el 19-sep). Una API vieja no lo manda: entonces se comporta como antes. */
  if (!YO.tiene_clave && !YO.tiene_google && YO.entro_con === 'codigo') {
    mostrar('v-nueva');
    pintarNueva(true);
    return;
  }
  MIAS = (YO.orgs || []).filter((o) => o.rol === 'owner' || o.rol === 'admin').map((o) => ({ id: o.id, nombre: o.nombre, rol: YO.superadmin ? 'super' : o.rol }));
  if (!MIAS.length) {
    $('nomanda-correo').textContent = YO.usuario?.correo ?? correo;
    mostrar('v-nomanda');
    return;
  }
  $('quien-n').textContent = YO.usuario.correo;
  $('quien').hidden = false;
  $('menu').hidden = false;
  const sel = $('empresa');
  sel.innerHTML = MIAS.map((o) => `<option value="${esc(o.id)}">${esc(o.nombre)}</option>`).join('');
  $('empresa-sel').hidden = MIAS.length < 2;
  const recordada = MIAS.find((o) => o.id === localStorage.getItem('workshop101.empresa'));
  await abrirEmpresa((recordada ?? MIAS[0]).id);
}

$('empresa').onchange = () => abrirEmpresa($('empresa').value);

async function abrirEmpresa(id) {
  const mia = MIAS.find((o) => o.id === id);
  if (!mia) return;
  try { localStorage.setItem('workshop101.empresa', id); } catch { /* sin almacenamiento */ }
  $('empresa').value = id;
  MI_ROL = mia.rol;
  mostrar('v-cargando');
  try {
    ORG = await pedir(`/orgs/${encodeURIComponent(id)}`);
  } catch (e) {
    ORG = { id, nombre: mia.nombre, apps: {} };
    aviso('g-aviso', e.message);
  }
  await irAGente();
}

/* ─────────────── gente ─────────────── */

const appsPrendidas = () => APPS.filter(([k]) => ORG?.apps?.[k] === true);
const puedoTocarDuenos = () => MI_ROL === 'owner' || MI_ROL === 'super';

async function irAGente() {
  mostrar('v-gente');
  $('g-id').textContent = `empresa · ${ORG.id}`;
  $('g-nombre').textContent = ORG.nombre;
  $('g-sub').textContent = MI_ROL === 'super' ? 'Como superadmin de la suite ves esta empresa como su dueño.' : `Entraste como ${ROLES[MI_ROL] ?? MI_ROL}.`;
  aviso('g-aviso', '');
  pintarAppsDelAlta();
  $('p-rol').innerHTML = (puedoTocarDuenos() ? ['owner', 'admin', 'socio', 'staff'] : ['admin', 'socio', 'staff'])
    .map((r) => `<option value="${r}"${r === 'socio' ? ' selected' : ''}>${ROLES[r]}</option>`).join('');
  await cargarGente();
}

function pintarAppsDelAlta() {
  const prendidas = appsPrendidas();
  $('p-apps').innerHTML = '<legend>Apps a las que entra</legend>' + (prendidas.length
    ? `<div class="apps-fila">${prendidas.map(([k, n]) => `<label><input type="checkbox" data-app="${k}" checked> ${n}</label>`).join('')}</div>`
    : '<p class="nota">La empresa no tiene ninguna app prendida todavía; eso se prende desde la suite.</p>');
}

async function cargarGente() {
  $('g-filas').innerHTML = '<tr><td colspan="6" class="nota">Cargando…</td></tr>';
  try {
    const d = await pedir(`/admin/orgs/${encodeURIComponent(ORG.id)}/miembros`);
    GENTE = d.filas.slice().sort((a, b) => ordenRol(a.rol) - ordenRol(b.rol) || a.correo.localeCompare(b.correo));
    pintarGente();
  } catch (e) {
    $('g-filas').innerHTML = '';
    aviso('g-aviso', e.message);
  }
}
const ordenRol = (r) => ({ owner: 0, admin: 1, socio: 2, staff: 3 }[r] ?? 9);

/** ¿Esta fila la puedo tocar? La API lo decide; aquí sólo se deja de ofrecer
 *  lo que va a rechazar: mi propia fila, y un dueño si no soy dueño. */
function candado(m) {
  if (m.usuario_id === YO.usuario.id) return 'a_ti_mismo';
  if (m.rol === 'owner' && !puedoTocarDuenos()) return 'solo_un_dueno_toca_duenos';
  return null;
}

function pintarGente() {
  const prendidas = appsPrendidas();
  $('g-th-apps').textContent = prendidas.length ? 'Apps' : 'Apps (ninguna prendida)';
  if (!GENTE.length) { $('g-filas').innerHTML = '<tr><td colspan="6" class="nota">Nadie todavía. Agrega a alguien abajo.</td></tr>'; return; }
  $('g-filas').innerHTML = GENTE.map((m) => {
    const cerrada = candado(m);
    const soyYo = m.usuario_id === YO.usuario.id;
    const todas = !m.apps || m.apps.length === 0;
    const roles = (puedoTocarDuenos() ? ['owner', 'admin', 'socio', 'staff'] : ['admin', 'socio', 'staff']);
    if (!roles.includes(m.rol)) roles.unshift(m.rol);
    return `<tr data-uid="${esc(m.usuario_id)}"${cerrada ? ' class="candado"' : ''}>
      <td class="mono">${esc(m.correo)}${soyYo ? '<span class="tu">(tú)</span>' : ''}</td>
      <td>${esc(m.nombre ?? '')}</td>
      <td><select class="rol" data-uid="${esc(m.usuario_id)}"${cerrada ? ' disabled' : ''}>${roles.map((r) => `<option value="${r}"${r === m.rol ? ' selected' : ''}>${ROLES[r] ?? r}</option>`).join('')}</select></td>
      <td><div class="apps-fila">${prendidas.map(([k, n]) => `<label><input type="checkbox" data-uid="${esc(m.usuario_id)}" data-app="${k}"${todas || m.apps.includes(k) ? ' checked' : ''}${cerrada ? ' disabled' : ''}> ${n}</label>`).join('')}${!prendidas.length ? '<span class="nota">—</span>' : ''}</div></td>
      <td class="fecha">${m.ultima_entrada ? esc(cuando(m.ultima_entrada)) : 'nadie aún'}</td>
      <td>${cerrada ? '' : `<button class="btn suave chico" data-quitar="${esc(m.usuario_id)}" data-correo="${esc(m.correo)}">Quitar</button>`}</td>
    </tr>`;
  }).join('');
  for (const sel of $('g-filas').querySelectorAll('select.rol')) sel.onchange = () => cambiarRol(sel);
  for (const caja of $('g-filas').querySelectorAll('input[data-app]')) caja.onchange = () => cambiarApps(caja.dataset.uid);
  for (const b of $('g-filas').querySelectorAll('[data-quitar]')) b.onclick = () => pedirConfirmacion(b.dataset.quitar, b.dataset.correo);
}

function reemplaza(uid, cambios) {
  GENTE = GENTE.map((m) => (m.usuario_id === uid ? { ...m, ...cambios } : m));
  pintarGente();
}

async function cambiarRol(sel) {
  const uid = sel.dataset.uid;
  const antes = GENTE.find((m) => m.usuario_id === uid)?.rol;
  sel.disabled = true;
  aviso('g-aviso', '');
  try {
    const d = await pedir(`/admin/orgs/${encodeURIComponent(ORG.id)}/miembros/${encodeURIComponent(uid)}`, { method: 'PATCH', body: { rol: sel.value } });
    reemplaza(uid, { rol: d.rol, apps: d.apps });
    aviso('g-aviso', `${d.correo ?? uid} ahora es ${ROLES[d.rol] ?? d.rol}.`, 'bien');
    cargarBitacora().catch(() => {});
  } catch (e) {
    aviso('g-aviso', e.message);
    reemplaza(uid, { rol: antes });
  }
}

/** Las cajas de una fila → la lista que se manda. Todas palomeadas = `[]`
 *  (todas las de la empresa, también las que se prendan después). */
function listaDe(uid) {
  const cajas = [...$('g-filas').querySelectorAll(`input[data-app][data-uid="${CSS.escape(uid)}"]`)];
  const marcadas = cajas.filter((c) => c.checked).map((c) => c.dataset.app);
  return marcadas.length === cajas.length ? [] : marcadas;
}

async function cambiarApps(uid) {
  const antes = GENTE.find((m) => m.usuario_id === uid)?.apps ?? [];
  for (const c of $('g-filas').querySelectorAll(`input[data-app][data-uid="${CSS.escape(uid)}"]`)) c.disabled = true;
  aviso('g-aviso', '');
  try {
    const d = await pedir(`/admin/orgs/${encodeURIComponent(ORG.id)}/miembros/${encodeURIComponent(uid)}`, { method: 'PATCH', body: { apps: listaDe(uid) } });
    reemplaza(uid, { rol: d.rol, apps: d.apps });
    const dicho = d.apps.length ? d.apps.map((k) => (APPS.find(([a]) => a === k) ?? [k, k])[1]).join(', ') : 'todas las apps de la empresa';
    aviso('g-aviso', `${d.correo ?? uid} entra a ${dicho}.`, 'bien');
    cargarBitacora().catch(() => {});
  } catch (e) {
    aviso('g-aviso', e.message);
    reemplaza(uid, { apps: antes });
  }
}

$('g-refrescar').onclick = () => cargarGente();

$('f-gente').onsubmit = async (ev) => {
  ev.preventDefault();
  const c = $('p-correo').value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(c)) { $('err-gente').textContent = 'Escribe un correo válido.'; return; }
  $('err-gente').textContent = '';
  const cajas = [...$('p-apps').querySelectorAll('input[data-app]')];
  const marcadas = cajas.filter((x) => x.checked).map((x) => x.dataset.app);
  const apps = marcadas.length === cajas.length ? [] : marcadas;
  const b = $('b-gente'); b.disabled = true; b.textContent = 'Agregando…';
  try {
    const d = await pedir(`/admin/orgs/${encodeURIComponent(ORG.id)}/miembros`, { method: 'POST', body: { correo: c, nombre: $('p-nombre').value.trim() || undefined, rol: $('p-rol').value, apps } });
    aviso('g-aviso', `${d.correo} ya entra a ${ORG.nombre} como ${ROLES[d.rol] ?? d.rol}. Le llega un código a ese correo la primera vez que entre.`, 'bien');
    $('p-correo').value = ''; $('p-nombre').value = '';
    for (const x of cajas) x.checked = true;
    await Promise.all([cargarGente(), cargarBitacora().catch(() => {})]);
  } catch (e) {
    $('err-gente').textContent = e.message;
  } finally { b.disabled = false; b.textContent = 'Agregar'; }
};

/* ─────────────── quitar a alguien: se escribe su correo ─────────────── */

function pedirConfirmacion(usuario_id, correoDe) {
  porQuitar = { usuario_id, correo: correoDe };
  $('q-empresa').textContent = ORG?.nombre ?? '';
  $('q-correo').textContent = correoDe;
  $('q-escrito').value = '';
  $('q-quitar').disabled = true;
  $('velo').hidden = false;
  $('q-escrito').focus();
}
$('q-escrito').oninput = () => { $('q-quitar').disabled = $('q-escrito').value.trim().toLowerCase() !== (porQuitar?.correo ?? '#'); };
$('q-cancelar').onclick = () => { $('velo').hidden = true; porQuitar = null; };
$('q-quitar').onclick = async () => {
  if (!porQuitar) return;
  const b = $('q-quitar'); b.disabled = true; b.textContent = 'Quitando…';
  try {
    await pedir(`/admin/orgs/${encodeURIComponent(ORG.id)}/miembros/${encodeURIComponent(porQuitar.usuario_id)}`, { method: 'DELETE' });
    $('velo').hidden = true;
    aviso('g-aviso', `${porQuitar.correo} ya no entra a ${ORG.nombre}.`, 'bien');
    porQuitar = null;
    await Promise.all([cargarGente(), cargarBitacora().catch(() => {})]);
  } catch (e) {
    aviso('g-aviso', e.message);
    $('velo').hidden = true;
  } finally { b.textContent = 'Quitar'; }
};

/* ─────────────── cambios ─────────────── */

let BITACORA = [];

async function cargarBitacora() {
  const d = await pedir(`/admin/orgs/${encodeURIComponent(ORG.id)}/bitacora`);
  BITACORA = d.filas;
  $('c-filas').innerHTML = filasBitacora(BITACORA);
}

async function irACambios() {
  mostrar('v-cambios');
  $('c-id').textContent = `${ORG.nombre} · ${ORG.id}`;
  aviso('c-aviso', '');
  $('c-filas').innerHTML = '<tr><td colspan="5" class="nota">Cargando…</td></tr>';
  try { await cargarBitacora(); } catch (e) { $('c-filas').innerHTML = ''; aviso('c-aviso', e.message); }
}

for (const b of document.querySelectorAll('#menu [data-ir]')) {
  b.onclick = () => (b.dataset.ir === 'gente' ? irAGente() : irACambios());
}

/* ─────────────── arranque ───────────────
 * Si la cookie todavía vive, se entra directo. Si venció, se pide el correo
 * sin enseñar ningún error: no falló nada, sólo pasó el tiempo. */

(async () => {
  // Google regresa con `?entrada=<boleto>`: se canjea por la cookie de este
  // origen y se quita de la barra, para que un recargar no lo repita.
  const u = new URL(location.href);
  const entrada = u.searchParams.get('entrada');
  if (entrada) {
    u.searchParams.delete('entrada');
    history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    try {
      await pedir('/auth/canje', { method: 'POST', body: { entrada } });
    } catch (e) {
      mostrar('v-correo');
      $('err-correo').textContent = e.message;
      return;
    }
  }
  try {
    await pedir('/yo');
    await entrar();
  } catch {
    /* La cookie no vive: se pide el correo, pero SÓLO si la persona no se
     * adelantó. Con red lenta, /yo contesta después de que ya tecleó su correo
     * y está en la contraseña, y regresarla a la primera pantalla es un rebote
     * que nadie entiende: el botón «Olvidé mi contraseña» desaparecía debajo
     * del dedo. Medido en peek101 el 18-sep-2026 desde el sandbox (/yo tarda
     * ~700 ms ahí); en el runner contesta antes de que nadie teclee. */
    if (!correo) mostrar('v-correo');
  }
})();
