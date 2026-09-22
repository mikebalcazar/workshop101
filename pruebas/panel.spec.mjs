/* workshop101 manejado con un navegador de verdad.
 *
 * Contra el banco falso (`node pruebas/servidor.mjs --falso`) se recorre todo:
 * la dueña entra, ve a su gente con rol y apps, cambia un rol y unas apps, da
 * de alta a alguien, quita a alguien escribiendo su correo, lee la bitácora;
 * la administración no puede tocar a la dueña; una socia y un cliente no
 * administran; y Google de mentiras regresa con el boleto.
 *
 * Contra staging (BASE=…) se entra como superadmin, se crea una empresa de
 * prueba por la API, se maneja su gente desde la pantalla y se borra al final.
 * Nunca contra producción: ahí está forespot.
 *
 *   node pruebas/panel.spec.mjs
 *   BASE=https://workshop101-staging.mike-929.workers.dev \
 *   API_ORIGEN=https://suite101-api-staging.mike-929.workers.dev node pruebas/panel.spec.mjs
 */

import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'http://127.0.0.1:8791').replace(/\/$/, '');
/* La contraseña que esta prueba le pone a la cuenta de staging si todavía no
 * tiene. Lleva el número de la corrida para que dos corridas a la vez no se
 * peleen. Nunca se usa contra producción: este archivo corre contra staging. */
const CLAVE = `panel-${process.env.GITHUB_RUN_ID || Date.now()}-alud`;
const CONTRA_STAGING = Boolean(process.env.BASE);
// Contra el banco falso, la API de mentiras es una puerta del mismo servidor;
// contra staging, la API misma (hace falta para crear y borrar la empresa de prueba).
const API_DIRECTA = (process.env.API_ORIGEN || `${BASE}/api-directa`).replace(/\/$/, '');
const SUPER = process.env.CORREO_SUPERADMIN || 'mike@forespot.com';
const CONTROL = process.env.CORREO_CONTROL || 'familia.ramirez@ejemplo.mx';
const EJECUTABLE = process.env.CHROMIUM || undefined;
const hhmm = new Date().toISOString().slice(11, 16).replace(':', '');
const ORG = `prueba-${hhmm}-${Math.random().toString(36).slice(2, 6)}`;

let fallas = 0, revisadas = 0;
const rev = (ok, texto, extra = '') => {
  revisadas++; if (!ok) fallas++;
  console.log(`  ${ok ? 'ok   ' : 'FALLA'} ${texto}${extra ? '  →  ' + extra : ''}`);
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Una petición JSON a la API (directa), con cookie opcional. */
async function json(url, { method = 'GET', body, cabeceras = {} } = {}) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-App': 'workshop101', ...cabeceras }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch { /* sin JSON */ }
  return { estado: r.status, cuerpo, puesta: r.headers.get('set-cookie') || '' };
}

/** Un código de prueba para `correo`, esperando si la API pide esperar. */
async function codigoPara(correo) {
  for (let i = 0; i < 4; i++) {
    const r = await json(`${BASE}/s101/auth/codigo`, { method: 'POST', body: { correo } });
    if (r.cuerpo?.data?.codigo_prueba) return r.cuerpo.data.codigo_prueba;
    if (r.cuerpo?.error === 'demasiados_intentos') {
      const s = (r.cuerpo.detalle?.espera_segundos ?? 45) + 2;
      console.log(`  (la API pide esperar ${s} s para otro código de ${correo})`);
      await dormir(s * 1000);
      continue;
    }
    throw new Error(`la API no devolvió codigo_prueba para ${correo} (${r.estado} ${r.cuerpo?.error ?? ''}): esto no es staging`);
  }
  throw new Error('no hubo código');
}

async function galletaDe(correo) {
  const codigo = await codigoPara(correo);
  const r = await json(`${BASE}/s101/auth/entrar`, { method: 'POST', body: { correo, codigo } });
  if (r.estado !== 200) throw new Error(`entrar como ${correo}: ${r.estado} ${r.cuerpo?.error ?? ''}`);
  return r.puesta.split(';')[0];
}

async function entrarEnPantalla(pagina, correo) {
  await pagina.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#v-correo:not([hidden])', { timeout: 15000 });
  /* DESDE EL 16-SEP-2026 la pantalla entra con Google o con contraseña, y el
   * código quedó como recuperación. Esta prueba entra por ahí —«Olvidé mi
   * contraseña»— porque es lo único que puede hacer sola: no sabe la contraseña
   * de nadie, y el código sí lo puede leer de la respuesta en staging.
   *
   * El código se lee de la respuesta que pidió LA PROPIA INTERFAZ, no de una
   * petición aparte: pedir otro invalidaría éste. */
  await pagina.fill('#correo', correo);
  await pagina.click('#b-correo');
  await pagina.waitForSelector('#v-clave:not([hidden])', { timeout: 15000 });

  let codigo = null;
  for (let i = 0; i < 4 && !codigo; i++) {
    const espera = pagina.waitForResponse((r) => r.url().endsWith('/s101/auth/codigo'), { timeout: 20000 });
    await pagina.click('#olvide');
    const cuerpo = await (await espera).json().catch(() => null);
    codigo = cuerpo?.data?.codigo_prueba ?? null;
    if (!codigo) {
      const s = (cuerpo?.detalle?.espera_segundos ?? 45) + 2;
      console.log(`  (la API pide esperar ${s} s para otro código)`);
      await dormir(s * 1000);
    }
  }
  if (!codigo) throw new Error('la interfaz no consiguió un código de prueba');
  await pagina.waitForSelector('#v-codigo:not([hidden])', { timeout: 15000 });
  await pagina.fill('#codigo', codigo);
  await pagina.click('#b-codigo');

  /* El código vive por correo y el último pedido pisa al anterior. Dos apps
   * de la suite publicándose a la vez recorren staging con LA MISMA cuenta de
   * superadmin, así que una le puede tumbar el código a la otra y aquí se ve
   * como una pantalla que no avanza (pasó el 19-sep: master101 y workshop101
   * se publicaron en el mismo minuto). Si el código no sirvió, se pide otro y
   * se intenta una vez más, en vez de dar por rota la pantalla. */
  const rebotado = await pagina.waitForFunction(
    () => !document.getElementById('v-codigo').hidden && document.getElementById('err-codigo').textContent.trim().length > 0,
    null, { timeout: 8000 },
  ).then(() => true, () => false);
  if (rebotado) {
    console.log(`  (el código no sirvió: ${await pagina.textContent('#err-codigo')} — se pide otro)`);
    await dormir(47000);
    const espera = pagina.waitForResponse((r) => r.url().endsWith('/s101/auth/codigo'), { timeout: 20000 });
    await pagina.click('#reenviar');
    const otro = (await (await espera).json().catch(() => null))?.data?.codigo_prueba;
    if (!otro) throw new Error('la interfaz no consiguió un segundo código de prueba');
    await pagina.fill('#codigo', otro);
    await pagina.click('#b-codigo');
  }

  /* Y aquí caben las dos salidas, según si esa cuenta ya tenía contraseña:
   *   sin contraseña → la pantalla la pide antes de dejar pasar
   *   con contraseña → pasa directo
   * Se esperan las dos en vez de suponer una. Suponer cuál es haría que la
   * prueba fallara o no según el estado que dejó la corrida anterior, que es
   * la clase de falla que manda a buscar donde no está. */
  const pideClave = await pagina.waitForSelector('#v-nueva:not([hidden])', { timeout: 8000 }).then(() => true, () => false);
  if (pideClave) {
    await pagina.fill('#nueva', CLAVE);
    await pagina.fill('#nueva2', CLAVE);
    await pagina.click('#b-nueva');
  }
}

async function contexto(navegador, ancho, alto) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto }, locale: 'es-MX' });
  const pagina = await ctx.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(String(e)));
  pagina.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errores.push(m.text()); });
  const terceros = [];
  pagina.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(BASE).origin) terceros.push(u.host); });
  return { ctx, pagina, errores, terceros };
}

const sinScroll = async (pagina, donde) => {
  const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  rev(sobra <= 1, `sin scroll horizontal en ${donde}`, `sobran ${sobra} px`);
};

const fila = (pagina, correo) => pagina.locator('#g-filas tr', { hasText: correo }).first();
const esperaAviso = (pagina, id, patron) => pagina.waitForFunction(([i, p]) => new RegExp(p).test(document.getElementById(i).textContent), [id, patron], { timeout: 15000 });

/* ─────────────── el recorrido, en un celular ───────────────
 * Quién entra: contra el banco, la dueña de `demo`; contra staging, el
 * superadmin, que ve la empresa de prueba recién creada como su dueño. */

let galletaSuper = '';

async function recorrido(navegador) {
  console.log(`\n== celular (390 × 844) ==  ${BASE}`);
  const { ctx, pagina, errores, terceros } = await contexto(navegador, 390, 844);

  const quien = CONTRA_STAGING ? SUPER : 'duena@ejemplo.mx';
  const org = CONTRA_STAGING ? ORG : 'demo';
  if (CONTRA_STAGING) {
    galletaSuper = await galletaDe(SUPER);
    const nueva = await json(`${API_DIRECTA}/admin/orgs`, { method: 'POST', body: { id: ORG, nombre: `Prueba ${hhmm}`, apps: { dash: true, quell: true, peek: true, cotizador: false, roster: false, nest: false } }, cabeceras: { Cookie: galletaSuper } });
    rev(nueva.estado === 201, `se crea la empresa de prueba ${ORG} por la API`, `${nueva.estado} ${nueva.cuerpo?.error ?? ''}`);
    for (const [correo, rol, apps] of [['admi-prueba@ejemplo.mx', 'admin', []], ['socia-prueba@ejemplo.mx', 'socio', ['dash']], ['oficina-prueba@ejemplo.mx', 'staff', ['quell', 'peek']]]) {
      const r = await json(`${API_DIRECTA}/admin/orgs/${ORG}/miembros`, { method: 'POST', body: { correo, rol, apps, nombre: correo.split('@')[0] }, cabeceras: { Cookie: galletaSuper } });
      rev(r.estado === 201, `la API da de alta a ${correo} (${rol})`, `${r.estado}`);
    }
  }

  await entrarEnPantalla(pagina, quien);
  await pagina.waitForSelector('#v-gente:not([hidden])', { timeout: 20000 });
  rev(true, `${quien} entra y ve la gente de su empresa`);
  if (CONTRA_STAGING) {
    // El superadmin ve todas las empresas: se elige la de prueba en la barra.
    rev(await pagina.isVisible('#empresa-sel'), 'el superadmin tiene el selector de empresa en la barra');
    await pagina.selectOption('#empresa', ORG);
    await pagina.waitForFunction((o) => document.getElementById('g-id').textContent.includes(o), org, { timeout: 15000 });
  } else {
    rev(await pagina.isHidden('#empresa-sel'), 'con una sola empresa no hay selector');
  }
  await pagina.waitForSelector('#g-filas td.mono', { timeout: 15000 });
  rev((await pagina.locator('#g-nombre').innerText()).length > 0, 'la pantalla dice de qué empresa es', await pagina.locator('#g-nombre').innerText());

  const correoAdmi = CONTRA_STAGING ? 'admi-prueba@ejemplo.mx' : 'admi@ejemplo.mx';
  const correoSocia = CONTRA_STAGING ? 'socia-prueba@ejemplo.mx' : 'socia@ejemplo.mx';
  const correoOficina = CONTRA_STAGING ? 'oficina-prueba@ejemplo.mx' : 'oficina@ejemplo.mx';
  const filas = await pagina.locator('#g-filas tr[data-uid]').count();
  rev(filas === (CONTRA_STAGING ? 3 : 5), `la tabla trae a la gente de la empresa`, `${filas} filas`);

  // La socia sólo tiene dash101 palomeada; la administración, todas.
  const cajasSocia = fila(pagina, correoSocia).locator('input[data-app]');
  const marcadasSocia = await cajasSocia.evaluateAll((l) => l.filter((c) => c.checked).map((c) => c.dataset.app));
  rev(JSON.stringify(marcadasSocia) === '["dash"]', 'la socia sólo tiene dash101 palomeada', JSON.stringify(marcadasSocia));
  const marcadasAdmi = await fila(pagina, correoAdmi).locator('input[data-app]').evaluateAll((l) => l.filter((c) => c.checked).length + '/' + l.length);
  rev(/^(\d+)\/\1$/.test(marcadasAdmi), 'la administración tiene todas las apps palomeadas (lista vacía = todas)', marcadasAdmi);
  rev(await fila(pagina, correoSocia).locator('td.fecha').innerText() === 'nadie aún' || CONTRA_STAGING === false, 'última entrada: «nadie aún» para quien no ha entrado');

  if (!CONTRA_STAGING) {
    // Mi propia fila está cerrada: sin selector activo, sin cajas, sin «Quitar».
    const mia = fila(pagina, 'duena@ejemplo.mx');
    rev((await mia.locator('.tu').count()) === 1, 'mi fila dice «(tú)»');
    rev(await mia.locator('select.rol').isDisabled(), 'y no me puedo cambiar el rol');
    rev((await mia.locator('[data-quitar]').count()) === 0, 'ni quitarme');
  }

  // Cambiar apps de la socia: palomear quell101 → PATCH y se repinta con lo que la API contesta.
  await fila(pagina, correoSocia).locator('input[data-app="quell"]').check();
  await esperaAviso(pagina, 'g-aviso', 'entra a');
  const aviso1 = await pagina.locator('#g-aviso').innerText();
  rev(/dash101, quell101/.test(aviso1), 'palomear quell101 a la socia hace PATCH y la API contesta la lista nueva', aviso1);
  const despues = await fila(pagina, correoSocia).locator('input[data-app]').evaluateAll((l) => l.filter((c) => c.checked).map((c) => c.dataset.app));
  rev(JSON.stringify(despues) === '["dash","quell"]', 'la fila se repintó con dash101 y quell101', JSON.stringify(despues));

  /* EL CASO DE FER (21-sep-2026). Hasta ese día esto no se podía ni
   * configurar: pedir una compra exigía la llave de dash101, así que quien
   * administra no tenía manera de dejar pedir a alguien sin abrirle el
   * tablero del dinero. Lo que se revisa aquí es que la casilla exista, que
   * se pueda palomear sola, y —sobre todo— que palomearla NO prenda `dash`. */
  if (!CONTRA_STAGING) {
    const cajasFer = fila(pagina, 'fer@ejemplo.mx').locator('input[data-app]');
    const deFer = await cajasFer.evaluateAll((l) => l.filter((c) => c.checked).map((c) => c.dataset.app));
    rev(JSON.stringify(deFer) === '["supply","quell"]' || JSON.stringify(deFer) === '["quell","supply"]',
        'quien pide compras puede tenerlo SIN el tablero del dinero', JSON.stringify(deFer));
    rev(!deFer.includes('dash'), 'y pedir compras no arrastra a dash101');

    // Y al revés: la socia tiene dash101 y no pide compras.
    const deSocia = await fila(pagina, correoSocia).locator('input[data-app]')
      .evaluateAll((l) => l.filter((c) => c.checked).map((c) => c.dataset.app));
    rev(!deSocia.includes('supply'), 'ni dash101 arrastra a pedir compras', JSON.stringify(deSocia));

    /* Prenderle a la socia «pedir compras» es una casilla, y sólo esa cambia.
     * Y se apaga al terminar: el banco falso guarda el estado entre los
     * recorridos de esta misma corrida, así que una prueba que deja el
     * mundo movido hace fallar a la siguiente por algo que no es su culpa
     * —que es justo lo que pasó al escribir esto—. */
    await fila(pagina, correoSocia).locator('input[data-app="supply"]').check();
    await esperaAviso(pagina, 'g-aviso', 'entra a');
    const tras = await fila(pagina, correoSocia).locator('input[data-app]')
      .evaluateAll((l) => l.filter((c) => c.checked).map((c) => c.dataset.app));
    rev(tras.includes('supply') && tras.includes('dash') && tras.includes('quell') && tras.length === 3,
        'y prenderla no toca ninguna otra', JSON.stringify(tras));
    await fila(pagina, correoSocia).locator('input[data-app="supply"]').uncheck();
    await esperaAviso(pagina, 'g-aviso', 'entra a');
  }

  // Cambiar rol: oficina → socio.
  await fila(pagina, correoOficina).locator('select.rol').selectOption('socio');
  await esperaAviso(pagina, 'g-aviso', 'ahora es socio');
  rev(true, 'cambiar el rol de oficina a socio hace PATCH y se dice');
  rev(await fila(pagina, correoOficina).locator('select.rol').inputValue() === 'socio', 'y el selector queda en socio');

  // Alta: alguien nuevo de oficina, sólo con peek101.
  await pagina.fill('#p-correo', 'nueva@ejemplo.mx');
  await pagina.fill('#p-nombre', 'Nueva');
  await pagina.selectOption('#p-rol', 'staff');
  for (const caja of await pagina.locator('#p-apps input[data-app]').all()) {
    if ((await caja.getAttribute('data-app')) !== 'peek') await caja.uncheck();
  }
  await pagina.click('#b-gente');
  await esperaAviso(pagina, 'g-aviso', 'nueva@ejemplo.mx ya entra');
  await pagina.waitForSelector('#g-filas tr[data-uid]:has-text("nueva@ejemplo.mx")', { timeout: 15000 });
  const appsNueva = await fila(pagina, 'nueva@ejemplo.mx').locator('input[data-app]').evaluateAll((l) => l.filter((c) => c.checked).map((c) => c.dataset.app));
  rev(JSON.stringify(appsNueva) === '["peek"]', 'la persona nueva quedó de oficina con sólo peek101', JSON.stringify(appsNueva));
  rev(await fila(pagina, 'nueva@ejemplo.mx').locator('select.rol').inputValue() === 'staff', 'y con rol oficina');

  // Un correo mal escrito no sale a la API.
  await pagina.fill('#p-correo', 'sin-arroba');
  await pagina.click('#b-gente');
  rev(/correo válido/.test(await pagina.locator('#err-gente').innerText()), 'un correo mal escrito se detiene en la pantalla');
  await pagina.fill('#p-correo', '');

  // Quitar: el botón abre el diálogo, y sólo con el correo escrito tal cual se habilita.
  await fila(pagina, 'nueva@ejemplo.mx').locator('[data-quitar]').click();
  await pagina.waitForSelector('#velo:not([hidden])');

  /* ── el «atrás» del navegador (Mike, 22-sep-2026) ──
   * En el escritorio esto se mide contando entradas del historial
   * (`pruebas/el-atras.mjs`); aquí se mide en un navegador de verdad, que es
   * donde se sufría: con la confirmación abierta, «atrás» se llevaba la app
   * entera en vez de cerrarla. */
  await pagina.goBack();
  /* `state: 'hidden'` se cumple igual si el elemento ya no existe, así que lo
   * que de verdad mide esto es la revisada de abajo: que la pantalla de gente
   * SIGA PUESTA. Con el código de antes, «atrás» se llevaba la página
   * completa y no quedaba ni velo ni pantalla. */
  await pagina.waitForSelector('#velo', { state: 'hidden', timeout: 10000 });
  rev(!(await pagina.locator('#v-gente').isHidden()), 'con el velo abierto, «atrás» lo cierra y deja la app donde estaba');
  /* Y no lo resucita: dar «adelante» vuelve a la misma pantalla, no a la
   * confirmación que ya se cerró. */
  await pagina.goForward();
  await pagina.waitForTimeout(300);
  rev(await pagina.locator('#velo').isHidden(), 'y «adelante» no reabre la confirmación');
  rev(!(await pagina.locator('#v-gente').isHidden()), 'la pantalla de gente sigue puesta');

  await fila(pagina, 'nueva@ejemplo.mx').locator('[data-quitar]').click();
  await pagina.waitForSelector('#velo:not([hidden])');
  rev(await pagina.locator('#q-quitar').isDisabled(), 'el diálogo de quitar arranca con el botón apagado');
  await pagina.fill('#q-escrito', 'nueva@ejemplo.m');
  rev(await pagina.locator('#q-quitar').isDisabled(), 'con el correo incompleto sigue apagado');
  await pagina.fill('#q-escrito', 'nueva@ejemplo.mx');
  rev(!(await pagina.locator('#q-quitar').isDisabled()), 'con el correo tal cual se prende');
  await pagina.click('#q-quitar');
  await esperaAviso(pagina, 'g-aviso', 'ya no entra');
  await pagina.waitForFunction(() => !document.querySelector('#g-filas tr[data-uid]')?.closest('tbody')?.innerText.includes('nueva@ejemplo.mx'), null, { timeout: 15000 });
  rev((await pagina.locator('#g-filas tr[data-uid]:has-text("nueva@ejemplo.mx")').count()) === 0, 'la persona quitada ya no está en la tabla');

  // La bitácora de la empresa trae lo que acaba de pasar.
  await pagina.click('#menu [data-ir="cambios"]');
  await pagina.waitForSelector('#v-cambios:not([hidden])');
  await pagina.waitForSelector('#c-filas td.mono', { timeout: 15000 });
  const bit = await pagina.locator('#c-filas').innerText();
  rev(/Apps/.test(bit) && /dash101|dash/.test(bit), 'la bitácora apunta el cambio de apps de la socia');
  rev(/Rol/.test(bit), 'y el cambio de rol');
  rev(/Gente/.test(bit) && /nueva@ejemplo.mx/.test(bit), 'y el alta y la baja de la persona nueva');
  rev(new RegExp(quien).test(bit), 'con el correo de quien lo hizo');
  await sinScroll(pagina, 'la bitácora');

  await pagina.click('#menu [data-ir="gente"]');
  await pagina.waitForSelector('#v-gente:not([hidden])');
  await sinScroll(pagina, 'la gente en un celular');
  rev(terceros.length === 0, 'cero peticiones a terceros', [...new Set(terceros)].join(', '));
  rev(errores.length === 0, 'cero errores de JavaScript', errores.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ─────────────── la administración: ve, pero no toca a la dueña ─────────────── */

async function administracion(navegador) {
  if (CONTRA_STAGING) return;   // contra el banco basta: los candados de la API los mide humo.mjs en staging
  console.log(`\n== la administración (390 × 844) ==`);
  const { ctx, pagina, errores } = await contexto(navegador, 390, 844);
  await entrarEnPantalla(pagina, 'admi@ejemplo.mx');
  await pagina.waitForSelector('#v-gente:not([hidden])', { timeout: 20000 });
  await pagina.waitForSelector('#g-filas td.mono', { timeout: 15000 });
  rev(/administración/.test(await pagina.locator('#g-sub').innerText()), 'la pantalla dice que entró como administración');
  const duena = fila(pagina, 'duena@ejemplo.mx');
  rev(await duena.locator('select.rol').isDisabled(), 'la fila de la dueña está cerrada para la administración');
  rev((await duena.locator('[data-quitar]').count()) === 0, 'y sin botón de quitar');
  const opciones = await pagina.locator('#p-rol option').evaluateAll((l) => l.map((o) => o.value));
  rev(!opciones.includes('owner'), 'la administración no puede nombrar dueños: el alta no ofrece «dueño»', opciones.join(', '));
  // Pero sí puede acotar a la socia.
  await fila(pagina, 'socia@ejemplo.mx').locator('input[data-app="quell"]').uncheck();
  await esperaAviso(pagina, 'g-aviso', 'entra a dash101');
  rev(true, 'la administración sí cambia las apps de una socia');
  rev(errores.length === 0, 'cero errores de JavaScript', errores.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ─────────────── quien no administra ─────────────── */

async function control(navegador) {
  console.log(`\n== quien no administra (390 × 844) ==`);
  const { ctx, pagina, errores } = await contexto(navegador, 390, 844);
  const correo = CONTRA_STAGING ? CONTROL : 'socia@ejemplo.mx';
  await entrarEnPantalla(pagina, correo);
  await pagina.waitForSelector('#v-nomanda:not([hidden])', { timeout: 20000 });
  rev(true, `${correo} entra bien pero ve «esta cuenta no administra ninguna empresa»`);
  rev((await pagina.locator('#nomanda-correo').innerText()) === correo, 'y la pantalla dice cuál cuenta es');
  rev(await pagina.isHidden('#v-gente'), 'la tabla de gente no se enseña');
  rev(await pagina.isHidden('#menu'), 'ni el menú');
  if (!CONTRA_STAGING) {
    // A mano, la API también le cierra la puerta del panel y la de la gente.
    const g = await galletaDe('socia@ejemplo.mx');
    const panel = await json(`${API_DIRECTA}/orgs/demo`, { cabeceras: { Cookie: g } });
    rev(panel.estado === 403 && panel.cuerpo?.detalle?.motivo === 'solo_administra', 'y aunque pida /orgs/demo como workshop101 a mano, la API dice solo_administra', `${panel.estado} ${panel.cuerpo?.detalle?.motivo ?? panel.cuerpo?.error}`);
    const gente = await json(`${API_DIRECTA}/admin/orgs/demo/miembros`, { cabeceras: { Cookie: g } });
    rev(gente.estado === 403, 'y /admin/orgs/demo/miembros le contesta 403', `${gente.estado}`);
  }
  await pagina.click('#nomanda-salir');
  await pagina.waitForSelector('#v-correo:not([hidden])', { timeout: 10000 });
  rev(true, 'salir regresa al correo');
  await sinScroll(pagina, 'la pantalla de control');
  rev(errores.length === 0, 'cero errores de JavaScript', errores.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ─────────────── en escritorio, la tabla completa ─────────────── */

async function escritorio(navegador) {
  console.log(`\n== computadora (1440 × 900) ==`);
  const { ctx, pagina, errores } = await contexto(navegador, 1440, 900);
  await entrarEnPantalla(pagina, CONTRA_STAGING ? SUPER : 'duena@ejemplo.mx');
  await pagina.waitForSelector('#v-gente:not([hidden])', { timeout: 20000 });
  if (CONTRA_STAGING) { await pagina.selectOption('#empresa', ORG); await pagina.waitForFunction((o) => document.getElementById('g-id').textContent.includes(o), ORG, { timeout: 15000 }); }
  await pagina.waitForSelector('#g-filas td.mono', { timeout: 15000 });
  rev((await pagina.locator('#g-tabla thead th').count()) === 6, 'seis columnas: correo, nombre, rol, apps, última entrada y acciones');
  /* Cuáles son sale de la pantalla misma, no de un número escrito aquí: el
   * 21-sep agregar `supply` rompió esta línea sin que nada estuviera mal, y
   * el siguiente que agregue una app se llevaría el mismo susto.
   *
   * La referencia es la fila de la administración: tiene la lista vacía, o
   * sea «todas las de la empresa», así que sus casillas SON las prendidas.
   * Comparar el alta contra ella es comparar dos lugares de la pantalla que
   * tienen que decir lo mismo. */
  const ofrecidas = await pagina.locator('#p-apps input[data-app]').evaluateAll((l) => l.map((c) => c.dataset.app).sort());
  const enLaFila = await fila(pagina, CONTRA_STAGING ? 'admi-prueba@ejemplo.mx' : 'admi@ejemplo.mx').locator('input[data-app]').evaluateAll((l) => l.map((c) => c.dataset.app).sort());
  rev(ofrecidas.length > 0 && JSON.stringify(ofrecidas) === JSON.stringify(enLaFila),
      'el alta ofrece exactamente las apps que la empresa tiene prendidas',
      `${JSON.stringify(ofrecidas)} vs ${JSON.stringify(enLaFila)}`);
  await sinScroll(pagina, 'la tabla en escritorio');
  rev(errores.length === 0, 'cero errores de JavaScript', errores.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ─────────────── entrar con Google ─────────────── */

async function google(navegador) {
  console.log(`\n== entrar con Google (390 × 844) ==`);
  const { ctx, pagina, errores } = await contexto(navegador, 390, 844);
  if (CONTRA_STAGING) {
    await pagina.route('**/s101/auth/google**', (r) => r.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'google_no_configurado' }) }));
  }
  await pagina.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#v-correo:not([hidden])', { timeout: 15000 });
  rev(await pagina.isVisible('#b-google'), 'el botón «Entrar con Google» está en la pantalla del correo');
  await pagina.click('#b-google');
  if (CONTRA_STAGING) {
    await pagina.waitForFunction(() => document.getElementById('err-correo').textContent.trim() !== '', null, { timeout: 10000 });
    const aviso = (await pagina.locator('#err-correo').innerText()).trim();
    rev(/todavía no está prendido/.test(aviso), 'sin llaves de Google la pantalla lo dice con palabras', aviso);
    rev(!/501|google_no_configurado/.test(aviso), 'y sin códigos de programador');
  } else {
    await pagina.waitForSelector('#v-gente:not([hidden])', { timeout: 20000 });
    rev(true, 'Google (de mentiras) regresó con el boleto, se canjeó y la dueña quedó dentro');
    rev(!new URL(pagina.url()).searchParams.has('entrada'), 'el boleto se quitó de la barra de direcciones');
  }
  await pagina.goto(`${BASE}/?entrada=boleto-inventado`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#v-correo:not([hidden])', { timeout: 15000 });
  await pagina.waitForFunction(() => document.getElementById('err-correo').textContent.trim() !== '', null, { timeout: 15000 });
  rev(/ya no sirve/.test(await pagina.locator('#err-correo').innerText()), 'un boleto inventado no entra y se dice con palabras');
  rev(!new URL(pagina.url()).searchParams.has('entrada'), 'y también se quita de la barra');
  rev(errores.length === 0, 'cero errores de JavaScript', errores.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ─────────────── ─────────────── */

/** Con red lenta, /yo contesta después de que la persona ya tecleó su correo.
 *  La pantalla NO debe regresarla a la primera vista cuando por fin llega el
 *  401. Pasó de verdad en peek101 el 18-sep-2026 (desde el sandbox, donde /yo
 *  tarda ~700 ms): el botón «Olvidé mi contraseña» desaparecía debajo del
 *  dedo. Aquí la demora se fabrica, para que se mida igual en cualquier red. */
async function yoLento(navegador) {
  console.log(`\n== /yo tarda en contestar ==  ${BASE}`);
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-MX' });
  const pagina = await ctx.newPage();
  await pagina.route('**/s101/yo', async (ruta) => { await dormir(2500); await ruta.continue(); });
  await pagina.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#v-correo:not([hidden])', { timeout: 15000 });
  await pagina.fill('#correo', SUPER);
  await pagina.click('#b-correo');
  await pagina.waitForSelector('#v-clave:not([hidden])', { timeout: 15000 });
  await dormir(3500); // para cuando ya llegó el 401 tardío
  rev(await pagina.isVisible('#v-clave') && await pagina.isVisible('#olvide'),
    'el 401 tardío de /yo no regresa a la persona a la pantalla del correo');
  await ctx.close();
}

const navegador = await chromium.launch(EJECUTABLE ? { executablePath: EJECUTABLE } : {});
try {
  await recorrido(navegador);
  await administracion(navegador);
  await escritorio(navegador);
  await control(navegador);
  await google(navegador);
  await yoLento(navegador);
} catch (e) {
  fallas++;
  console.log(`  FALLA la prueba tronó: ${e?.stack || e}`);
} finally {
  await navegador.close();
  if (CONTRA_STAGING && galletaSuper) {
    // Lo que se creó, se borra: DELETE /admin/orgs/:o sólo existe fuera de producción.
    const borrada = await json(`${API_DIRECTA}/admin/orgs/${ORG}`, { method: 'DELETE', cabeceras: { Cookie: galletaSuper } }).catch(() => ({ estado: 0 }));
    console.log(`\n  ${borrada.estado === 200 ? 'ok   ' : 'AVISO'} la empresa de prueba ${ORG} ${borrada.estado === 200 ? 'se borró' : 'NO se pudo borrar (' + borrada.estado + ')'}`);
  }
}

console.log(`\n${revisadas} revisadas · ${fallas} fallas`);
process.exit(fallas === 0 ? 0 : 1);
