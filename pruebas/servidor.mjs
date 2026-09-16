/* El Worker, pero en esta máquina, para poder probar con un navegador.
 *
 * `wrangler dev` no sirve aquí: el *service binding* a `suite101-api` sólo
 * existe dentro de Cloudflare. Así que este guion hace lo MISMO que
 * `worker/index.js` —servir `public/` y reenviar `/s101/*` poniendo
 * `X-App: workshop101`— pero por HTTP contra la API de STAGING.
 *
 * Y tiene un segundo modo, `--falso`, para donde staging no se alcanza (el
 * chat que escribe el código no llega a *.workers.dev): una API de mentiras,
 * en memoria, con las mismas rutas y los mismos códigos de error que
 * `suite101-api/src/rutas/admin.ts`, `auth.ts` y `orgs.ts` (contrato 0.6.0). Sirve para medir
 * la PANTALLA; que el Worker de verdad y la API de verdad se entiendan lo mide
 * `scripts/medir.mjs` desde el corredor, contra lo publicado. Las dos
 * mediciones hacen falta.
 *
 *   node pruebas/servidor.mjs [puerto]           contra staging
 *   node pruebas/servidor.mjs --falso [puerto]   con la API de mentiras
 *
 * En el modo falso, en la empresa `demo`: `duena@ejemplo.mx` es dueña,
 * `admi@ejemplo.mx` administración, `socia@ejemplo.mx` socia con sólo dash101,
 * `oficina@ejemplo.mx` de oficina, y `cliente@ejemplo.mx` es un cliente del
 * portal que no administra nada. El código de prueba siempre es el que
 * devuelve /auth/codigo.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLICO = fileURLToPath(new URL('../public/', import.meta.url));
const API = process.env.API_ORIGEN || 'https://suite101-api-staging.mike-929.workers.dev';
const args = process.argv.slice(2);
const FALSO = args.includes('--falso');
const PUERTO = Number(args.find((a) => /^\d+$/.test(a)) || process.env.PUERTO || 8791);

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
};

/* ─────────────── la API de mentiras ─────────────── */

export function apiFalsa() {
  const usuarios = new Map([
    ['u-duena', { id: 'u-duena', correo: 'duena@ejemplo.mx', nombre: 'Dueña', creado_at: '2026-09-01T00:00:00Z' }],
    ['u-admi', { id: 'u-admi', correo: 'admi@ejemplo.mx', nombre: 'Admi', creado_at: '2026-09-01T00:00:00Z' }],
    ['u-socia', { id: 'u-socia', correo: 'socia@ejemplo.mx', nombre: 'Socia', creado_at: '2026-09-01T00:00:00Z' }],
    ['u-oficina', { id: 'u-oficina', correo: 'oficina@ejemplo.mx', nombre: 'Oficina', creado_at: '2026-09-01T00:00:00Z' }],
    ['u-cliente', { id: 'u-cliente', correo: 'cliente@ejemplo.mx', nombre: 'Familia Ramírez', creado_at: '2026-09-01T00:00:00Z' }],
  ]);
  const orgs = new Map([
    ['demo', { id: 'demo', nombre: 'Demo', plan: 'prueba', apps: { dash: true, quell: true, peek: true, cotizador: true, roster: false, nest: false }, moneda: 'MXN', activa: true, creado_at: '2026-09-01T00:00:00Z' }],
  ]);
  const miembros = new Map([['demo', [
    { org_id: 'demo', usuario_id: 'u-duena', rol: 'owner', apps: [], negocios: [] },
    { org_id: 'demo', usuario_id: 'u-admi', rol: 'admin', apps: [], negocios: [] },
    { org_id: 'demo', usuario_id: 'u-socia', rol: 'socio', apps: ['dash'], negocios: [] },
    { org_id: 'demo', usuario_id: 'u-oficina', rol: 'staff', apps: ['quell', 'peek'], negocios: [] },
  ]]]);
  const sesiones = new Map();   // cookie → usuario_id
  const codigos = new Map();    // correo → codigo
  const accesos = new Map([['u-cliente', { org_id: 'demo', tipo: 'cliente', ref_id: 'c1' }]]);
  const LLAVE = { dash101: 'dash', quell101: 'quell', peek101: 'peek', cotizador101: 'cotizador', roster101: 'roster', nest101: 'nest' };
  const PANELES = new Set(['master101', 'workshop101', 'suite101']);
  const supers = new Set();
  const boletos = new Map();   // boleto de Google → cookie de sesión, un solo uso
  const bitacora = [];         // la escribe la API sola
  let nb = 0;
  const apunta = (quien, org_id, campo, antes, despues) => bitacora.unshift({ id: ++nb, cuando: new Date().toISOString(), quien, org_id, campo, antes: antes ?? null, despues: despues ?? null });
  const entradas = new Map([['u-duena', '2026-09-15T20:00:00Z'], ['u-admi', '2026-09-14T15:30:00Z']]);   // usuario_id → última sesión (ISO)
  apunta('mike@forespot.com', 'demo', 'creada', null, 'Demo · dash, quell, peek, cotizador');
  apunta('duena@ejemplo.mx', 'demo', 'miembro', null, 'socia@ejemplo.mx (socio)');
  let n = 0;

  const ok = (data, estado = 200, cabeceras = {}) => ({ estado, cuerpo: { ok: true, data }, cabeceras });
  const err = (error, estado, detalle) => ({ estado, cuerpo: { ok: false, error, ...(detalle ? { detalle } : {}) }, cabeceras: {} });
  const porCorreo = (c) => [...usuarios.values()].find((u) => u.correo === c);
  const miembroDe = (org_id, uid) => (miembros.get(org_id) || []).find((x) => x.usuario_id === uid) || null;
  const cuentaOwners = (org_id) => (miembros.get(org_id) || []).filter((x) => x.rol === 'owner').length;

  return async function atender(metodo, ruta, cabeceras, cuerpo) {
    const galleta = (cabeceras.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith('s101='))?.slice(5);
    const uid = galleta ? sesiones.get(galleta) : null;
    const app = cabeceras['x-app'] || '';
    const url = new URL(ruta, 'http://x');
    const p = url.pathname.replace(/\/$/, '') || '/';

    if (p === '/salud') return ok({ servicio: 'suite101-api', version: 'falsa', contrato: '0.6.0', entorno: 'prueba', d1: `si (${orgs.size} orgs)`, at: new Date().toISOString() });
    if (p === '/') return ok({ servicio: 'suite101-api', que_es: 'de mentiras' });

    if (p === '/auth/codigo' && metodo === 'POST') {
      const correo = String(cuerpo.correo || '').toLowerCase();
      if (!porCorreo(correo)) return ok({ enviado: false, mensaje: 'Si ese correo tiene acceso, le llega un código.' });
      const codigo = String(100000 + Math.floor(Math.random() * 900000));
      codigos.set(correo, codigo);
      return ok({ enviado: false, vence_en_segundos: 600, codigo_prueba: codigo });
    }
    if (p === '/auth/entrar' && metodo === 'POST') {
      const correo = String(cuerpo.correo || '').toLowerCase();
      const u = porCorreo(correo);
      if (!u) return err('sin_permiso', 403);
      if (cuerpo.codigo !== undefined) {
        if (codigos.get(correo) !== String(cuerpo.codigo)) return err('codigo_invalido', 401, { intentos_restantes: 4 });
        codigos.delete(correo);
      } else if (cuerpo.pin !== undefined) {
        if (String(cuerpo.pin) !== '246810') return err('pin_invalido', 401);
      } else return err('datos_invalidos', 400, { falta: 'codigo o pin' });
      const c = `ses-${++n}-${Math.random().toString(36).slice(2)}`;
      sesiones.set(c, u.id);
      entradas.set(u.id, new Date().toISOString());
      return ok({ usuario: u, vive_segundos: 3600 }, 200, { 'Set-Cookie': `s101=${c}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=3600` });
    }
    // Google de mentiras: entra la dueña y se regresa a `volver_a` con el
    // boleto, que es lo que la app tiene que saber canjear. Con
    // GOOGLE_FALSO=apagado se imita la API sin llaves.
    if (p === '/auth/google' && metodo === 'GET') {
      const volver_a = url.searchParams.get('volver_a') || '/';
      if (process.env.GOOGLE_FALSO === 'apagado') return err('google_no_configurado', 501);
      const u = porCorreo('duena@ejemplo.mx');
      const c = `ses-${++n}-${Math.random().toString(36).slice(2)}`;
      sesiones.set(c, u.id);
      entradas.set(u.id, new Date().toISOString());
      const boleto = `boleto-${Math.random().toString(36).slice(2)}`;
      boletos.set(boleto, c);
      const destino = new URL(volver_a, 'http://127.0.0.1');
      destino.searchParams.set('entrada', boleto);
      return { estado: 302, cuerpo: { ok: true, data: { a: destino.toString() } }, cabeceras: { Location: destino.toString() } };
    }
    if (p === '/auth/canje' && metodo === 'POST') {
      const c = boletos.get(String(cuerpo.entrada || ''));
      if (!c) return err('entrada_invalida', 401);
      boletos.delete(String(cuerpo.entrada));
      const u = usuarios.get(sesiones.get(c));
      return ok({ usuario: u, vive_segundos: 3600 }, 200, { 'Set-Cookie': `s101=${c}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=3600` });
    }
    if (p === '/auth/salir' && metodo === 'POST') { if (galleta) sesiones.delete(galleta); return ok({ cerrada: true }, 200, { 'Set-Cookie': 's101=; Path=/; Max-Age=0' }); }

    if (!uid) return err('sin_sesion', 401);
    const yo = usuarios.get(uid);
    const superadmin = supers.has(uid);

    if (p === '/yo') {
      const mias = [];
      for (const [org_id, lista] of miembros) {
        const m = lista.find((x) => x.usuario_id === uid);
        if (m) mias.push({ id: org_id, nombre: orgs.get(org_id).nombre, rol: m.rol, apps: m.apps, negocios: m.negocios });
      }
      return ok({ usuario: yo, superadmin, orgs: mias, acceso: accesos.get(uid) ?? null });
    }

    // /orgs/:o/... — la puerta, como orgs.ts en 0.6.0
    let m = p.match(/^\/orgs\/([^/]+)(\/.*)?$/);
    if (m) {
      if (!app) return err('sin_app', 400);
      if (!LLAVE[app] && !PANELES.has(app)) return err('app_desconocida', 400);
      const o = orgs.get(m[1]);
      if (!o) return err('org_desconocida', 404);
      if (!o.activa) return err('org_inactiva', 403);
      const esPanel = PANELES.has(app);
      if (!esPanel && o.apps[LLAVE[app]] !== true) return err('app_inactiva', 403, { app });
      const mm = miembroDe(o.id, uid);
      if (!mm && !superadmin) return err('sin_permiso', 403, { org: o.id });
      if (mm && !esPanel && mm.apps.length > 0 && !mm.apps.includes(LLAVE[app])) return err('app_no_permitida', 403, { app, permitidas: mm.apps });
      if (app === 'workshop101' && !(superadmin || (mm && (mm.rol === 'owner' || mm.rol === 'admin')))) return err('sin_permiso', 403, { motivo: 'solo_administra', org: o.id });
      if (!m[2] || m[2] === '/') return ok({ id: o.id, nombre: o.nombre, apps: o.apps, moneda: o.moneda });
      return ok({ org: o.id, ruta: m[2] });
    }

    if (!p.startsWith('/admin')) return err('no_encontrado', 404);

    // Quién manda en la empresa: superadmin, o dueño/administración de ella.
    const mando = (org_id) => (superadmin ? 'super' : (miembroDe(org_id, uid)?.rol ?? null));
    const administra = (x) => x === 'super' || x === 'owner' || x === 'admin';
    const nombraDuenos = (x) => x === 'super' || x === 'owner';
    const appsLimpias = (apps, o) => {
      if (apps === undefined) return { ok: true, apps: [] };
      if (!Array.isArray(apps)) return { ok: false, detalle: { apps: 'lista de llaves de app' } };
      const raras = apps.filter((a) => !(a in o.apps));
      if (raras.length) return { ok: false, detalle: { apps_desconocidas: raras, validas: Object.keys(o.apps) } };
      return { ok: true, apps: [...new Set(apps)] };
    };

    m = p.match(/^\/admin\/orgs\/([^/]+)\/bitacora$/);
    if (m && metodo === 'GET') {
      if (!orgs.has(m[1])) return err('org_desconocida', 404);
      if (!administra(mando(m[1]))) return err('sin_permiso', 403);
      const filas = bitacora.filter((b) => b.org_id === m[1]).slice(0, 200);
      return ok({ total: filas.length, filas });
    }
    m = p.match(/^\/admin\/orgs\/([^/]+)\/miembros$/);
    if (m && metodo === 'GET') {
      if (!orgs.has(m[1])) return err('org_desconocida', 404);
      if (!administra(mando(m[1]))) return err('sin_permiso', 403);
      const filas = (miembros.get(m[1]) || []).map((x) => ({ ...x, correo: usuarios.get(x.usuario_id).correo, nombre: usuarios.get(x.usuario_id).nombre, ultima_entrada: entradas.get(x.usuario_id) ?? null }));
      return ok({ total: filas.length, filas });
    }
    if (m && metodo === 'POST') {
      const o = orgs.get(m[1]);
      if (!o) return err('org_desconocida', 404);
      const md = mando(m[1]);
      if (!administra(md)) return err('sin_permiso', 403);
      const correo = String(cuerpo.correo || '').trim().toLowerCase();
      if (!correo) return err('datos_invalidos', 400, { falta: 'correo' });
      if (!['owner', 'admin', 'socio', 'staff'].includes(cuerpo.rol)) return err('datos_invalidos', 400, { rol: ['owner', 'admin', 'socio', 'staff'] });
      if (correo === yo.correo) return err('sin_permiso', 403, { motivo: 'a_ti_mismo' });
      if (cuerpo.rol === 'owner' && !nombraDuenos(md)) return err('sin_permiso', 403, { motivo: 'solo_un_dueno_nombra_duenos' });
      const apps = appsLimpias(cuerpo.apps, o);
      if (!apps.ok) return err('datos_invalidos', 400, apps.detalle);
      let u = porCorreo(correo);
      if (!u) { u = { id: `u-${++n}`, correo, nombre: cuerpo.nombre ?? null, creado_at: new Date().toISOString() }; usuarios.set(u.id, u); }
      const lista = miembros.get(m[1]);
      const ya = lista.find((x) => x.usuario_id === u.id);
      if (ya?.rol === 'owner' && !nombraDuenos(md)) return err('sin_permiso', 403, { motivo: 'solo_un_dueno_toca_duenos' });
      if (ya?.rol === 'owner' && cuerpo.rol !== 'owner' && cuentaOwners(m[1]) <= 1) return err('ultimo_owner', 409);
      apunta(yo.correo, m[1], 'miembro', ya ? `${correo} (${ya.rol})` : null, `${correo} (${cuerpo.rol})`);
      if (ya) { ya.rol = cuerpo.rol; ya.apps = apps.apps; } else lista.push({ org_id: m[1], usuario_id: u.id, rol: cuerpo.rol, apps: apps.apps, negocios: cuerpo.negocios || [] });
      return ok({ usuario_id: u.id, correo, rol: cuerpo.rol, apps: apps.apps }, ya ? 200 : 201);
    }
    m = p.match(/^\/admin\/orgs\/([^/]+)\/miembros\/([^/]+)$/);
    if (m && (metodo === 'PATCH' || metodo === 'DELETE')) {
      const o = orgs.get(m[1]);
      if (!o) return err('org_desconocida', 404);
      const md = mando(m[1]);
      if (!administra(md)) return err('sin_permiso', 403);
      const lista = miembros.get(m[1]) || [];
      const previo = lista.find((x) => x.usuario_id === m[2]);
      if (!previo) return err('no_encontrado', 404, { miembro: m[2] });
      if (m[2] === uid) return err('sin_permiso', 403, { motivo: 'a_ti_mismo' });
      const correoDe = usuarios.get(m[2]).correo;
      if (metodo === 'DELETE') {
        if (previo.rol === 'owner' && !nombraDuenos(md)) return err('sin_permiso', 403, { motivo: 'solo_un_dueno_toca_duenos' });
        if (previo.rol === 'owner' && cuentaOwners(m[1]) <= 1) return err('ultimo_owner', 409);
        miembros.set(m[1], lista.filter((x) => x.usuario_id !== m[2]));
        apunta(yo.correo, m[1], 'miembro', `${correoDe} (${previo.rol})`, null);
        return ok({ quitado: true });
      }
      if (cuerpo.rol === undefined && cuerpo.apps === undefined) return err('datos_invalidos', 400, { falta: 'rol o apps' });
      if (cuerpo.rol !== undefined && !['owner', 'admin', 'socio', 'staff'].includes(cuerpo.rol)) return err('datos_invalidos', 400);
      const rol = cuerpo.rol ?? previo.rol;
      if ((previo.rol === 'owner' || rol === 'owner') && !nombraDuenos(md)) return err('sin_permiso', 403, { motivo: 'solo_un_dueno_toca_duenos' });
      if (previo.rol === 'owner' && rol !== 'owner' && cuentaOwners(m[1]) <= 1) return err('ultimo_owner', 409);
      const apps = cuerpo.apps === undefined ? { ok: true, apps: previo.apps } : appsLimpias(cuerpo.apps, o);
      if (!apps.ok) return err('datos_invalidos', 400, apps.detalle);
      const dicho = (l) => (l.length ? l.join(', ') : 'todas');
      if (rol !== previo.rol) apunta(yo.correo, m[1], 'miembro.rol', `${correoDe} (${previo.rol})`, `${correoDe} (${rol})`);
      if (JSON.stringify(apps.apps) !== JSON.stringify(previo.apps)) apunta(yo.correo, m[1], 'miembro.apps', `${correoDe}: ${dicho(previo.apps)}`, `${correoDe}: ${dicho(apps.apps)}`);
      previo.rol = rol; previo.apps = apps.apps;
      return ok({ usuario_id: m[2], correo: correoDe, rol, apps: apps.apps });
    }
    if (!superadmin) return err('sin_permiso', 403);
    return err('no_encontrado', 404);
  };
}

/* ─────────────── el servidor ─────────────── */

const atender = FALSO ? apiFalsa() : null;

const servidor = createServer(async (pet, res) => {
  const u = new URL(pet.url, `http://127.0.0.1:${PUERTO}`);

  // Sólo en el modo falso: una puerta a la API de mentiras SIN sobrescribir
  // X-App, para que la prueba pueda pegarle como peek101 o dash101 y ver el
  // 403 app_inactiva / org_inactiva. Contra staging esa puerta es la API misma.
  if (FALSO && u.pathname.startsWith('/api-directa/')) {
    const ruta = u.pathname.slice('/api-directa'.length) + u.search;
    const trozos = [];
    for await (const t of pet) trozos.push(t);
    let cuerpo = {};
    try { cuerpo = trozos.length ? JSON.parse(Buffer.concat(trozos).toString('utf8')) : {}; } catch { cuerpo = {}; }
    const r = await atender(pet.method, ruta, pet.headers, cuerpo);
    res.writeHead(r.estado, { ...r.cabeceras, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r.cuerpo));
    return;
  }

  if (u.pathname === '/s101' || u.pathname.startsWith('/s101/')) {
    const ruta = (u.pathname.slice('/s101'.length) || '/') + u.search;
    const trozos = [];
    for await (const t of pet) trozos.push(t);
    const crudo = Buffer.concat(trozos);

    if (FALSO) {
      let cuerpo = {};
      try { cuerpo = crudo.length ? JSON.parse(crudo.toString('utf8')) : {}; } catch { cuerpo = {}; }
      // El Worker de verdad sobrescribe X-App: aquí se hace lo mismo.
      const r = await atender(pet.method, ruta, { ...pet.headers, 'x-app': 'workshop101' }, cuerpo);
      const salida = { ...r.cabeceras };
      if (salida['Set-Cookie']) salida['Set-Cookie'] = salida['Set-Cookie'].replace(/;\s*Secure/gi, '').replace(/SameSite=None/gi, 'SameSite=Lax');
      if (r.html) { res.writeHead(r.estado, { ...salida, 'Content-Type': 'text/html; charset=utf-8' }); res.end(r.html); return; }
      res.writeHead(r.estado, { ...salida, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.cuerpo));
      return;
    }

    const destino = new URL(API);
    destino.pathname = ruta.split('?')[0];
    destino.search = u.search;
    const cabeceras = { 'X-App': 'workshop101' };
    if (pet.headers.cookie) cabeceras.Cookie = pet.headers.cookie;
    if (pet.headers['content-type']) cabeceras['Content-Type'] = pet.headers['content-type'];
    const r = await fetch(destino, { method: pet.method, headers: cabeceras, body: crudo.length ? crudo : undefined, redirect: 'manual' });
    const cuerpo = Buffer.from(await r.arrayBuffer());
    const salida = { 'Content-Type': r.headers.get('content-type') ?? 'application/json' };
    // La galleta de la API dice `Secure`, y en http://127.0.0.1 el navegador
    // la tiraría. Se le quita SÓLO aquí, en el banco de pruebas.
    const puesta = r.headers.get('set-cookie');
    if (puesta) salida['Set-Cookie'] = puesta.replace(/;\s*Secure/gi, '').replace(/SameSite=None/gi, 'SameSite=Lax');
    res.writeHead(r.status, salida);
    res.end(cuerpo);
    return;
  }

  const limpia = normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, '');
  const archivo = join(PUBLICO, limpia === '/' ? 'index.html' : limpia);
  try {
    const datos = await readFile(archivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
    res.end(datos);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('no está');
  }
});

servidor.listen(PUERTO, '127.0.0.1', () => {
  console.log(`workshop101 en http://127.0.0.1:${PUERTO}  →  ${FALSO ? 'API de mentiras, en memoria' : API}`);
});
