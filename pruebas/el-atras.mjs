/* El «atrás» del navegador en el tablero del taller.
 *
 * Mike, 22-sep-2026: «en todas las apps, cuando picas el botón de back en el
 * navegador te saca hasta la página anterior (…). Queremos que cuando picas
 * back te regrese a la función anterior».
 *
 * Esta app es chica: dos secciones al mismo nivel —gente y cambios— y un
 * velo, el de «quitar a alguien». Lo que se sufría aquí era el velo: con la
 * confirmación abierta, «atrás» se llevaba la app entera en vez de cerrarla.
 *
 * POR QUÉ SE MIDE CON UN HISTORIAL DE MENTIRAS
 *
 * Lo delicado no es el navegador: es la CUENTA de entradas. Un `pushState`
 * de más obliga a picar atrás dos veces; uno de menos saca de la app. Las
 * dos se ven igual de bien en la pantalla y sólo se notan al caminar el
 * recorrido, así que se camina contando.
 *
 *   node pruebas/el-atras.mjs
 */

import { readFileSync } from 'node:fs';

let fallas = 0, revisadas = 0;
const rev = (ok, texto, extra = '') => {
  revisadas++; if (!ok) fallas++;
  console.log(`  ${ok ? 'ok   ' : 'FALLA'} ${texto}${extra ? '  →  ' + extra : ''}`);
};

function navegadorFalso() {
  const pila = [{ estado: null }];
  let i = 0;
  const oyentes = [];
  const history = {
    get state() { return pila[i].estado; },
    pushState(estado) { pila.splice(i + 1); pila.push({ estado }); i = pila.length - 1; },
    replaceState(estado) { pila[i] = { estado }; },
    back() { if (i > 0) { i--; oyentes.slice().forEach((f) => f()); } },
  };
  return {
    history,
    addEventListener: (qué, f) => { if (qué === 'popstate') oyentes.push(f); },
    // Retroceder NO acorta la pila —la entrada de adelante sigue ahí, como en
    // un navegador de verdad, para poder dar «adelante»—, así que para saber
    // si volvimos al mismo sitio hay que mirar la POSICIÓN, no el largo.
    posicion: () => i,
    largo: () => pila.length,
  };
}

const g = navegadorFalso();
globalThis.history = g.history;
globalThis.window = { addEventListener: g.addEventListener };
const { irA, sellar, abrirEncima, alNavegar } = await import('../public/navegar.js');

const HONDURA = { seccion: 1 };
let pantalla = '', veloAbierto = false;
alNavegar((donde) => { pantalla = donde === 'cambios' ? 'cambios' : 'gente'; });

console.log('· entrar a una empresa no apila');
sellar(HONDURA.seccion, 'gente');
pantalla = 'gente';
rev(g.posicion() === 0 && g.largo() === 1, 'entrar deja el historial como estaba', `${g.largo()} entradas`);
/* Cambiar de empresa desde el selector tampoco: es la misma pantalla con
 * otros datos, no un lugar nuevo. */
sellar(HONDURA.seccion, 'gente');
rev(g.largo() === 1, 'y cambiar de empresa tampoco escribe una entrada', `${g.largo()} entradas`);

console.log('· alternar entre gente y cambios no llena el historial');
const antes = g.posicion();
irA(HONDURA.seccion, 'cambios');
rev(pantalla === 'cambios', 'se llega a cambios');
irA(HONDURA.seccion, 'gente');
irA(HONDURA.seccion, 'cambios');
rev(g.posicion() === antes, 'y picarle tres veces al menú no deja tres escalones', `${g.posicion()} vs ${antes}`);

console.log('· el velo de «quitar a alguien»: atrás lo cierra, no saca de la app');
irA(HONDURA.seccion, 'gente');
const bajoElVelo = g.posicion();
veloAbierto = true;
let cerrar = abrirEncima(() => { veloAbierto = false; });
rev(g.posicion() === bajoElVelo + 1, 'abrirlo deja una entrada', `${g.posicion()} vs ${bajoElVelo}`);
g.history.back();
rev(!veloAbierto, 'atrás cierra el velo');
rev(pantalla === 'gente', 'y la pantalla de abajo se queda como estaba', `quedó en ${pantalla}`);
rev(g.posicion() === bajoElVelo, 'consumiendo la entrada del velo', `${g.posicion()} vs ${bajoElVelo}`);

console.log('· «Cancelar» del velo hace exactamente lo mismo que atrás');
/* Si el botón nada más lo escondiera, el siguiente «atrás» reabriría la
 * confirmación que la persona acaba de cancelar. */
veloAbierto = true;
cerrar = abrirEncima(() => { veloAbierto = false; });
const conVelo = g.posicion();
cerrar();
rev(!veloAbierto, 'el botón cierra el velo');
rev(g.posicion() === conVelo - 1, 'retrocediendo, no apilando', `${g.posicion()} vs ${conVelo}`);
rev(pantalla === 'gente', 'y sin cambiar la pantalla de abajo');

console.log('· cerrarlo dos veces no retrocede de más');
/* Quitar a alguien cierra el velo por la rama del éxito; si además se picara
 * «Cancelar», dos `history.back()` sacarían de la app. */
cerrar();
rev(g.posicion() === conVelo - 1, 'el segundo cierre no hace nada', `${g.posicion()} vs ${conVelo - 1}`);

console.log('· la pantalla está cableada a esto');
const app = readFileSync('public/app.js', 'utf8');
rev(/import \{[^}]*\} from '\.\/navegar\.js'/.test(app), 'la app usa el módulo');
rev(/alNavegar\(pintarLugar\)/.test(app), 'y el «atrás» del navegador está enganchado');
rev(/cerrarVelo = abrirEncima\(/.test(app), 'el velo se abre encima del historial');
rev(!/\$\('q-cancelar'\)\.onclick = \(\) => \{ \$\('velo'\)\.hidden = true;/.test(app),
    'y «Cancelar» ya no lo esconde por su cuenta');
rev(/sellar\(HONDURA\.seccion, 'gente'\)/.test(app), 'entrar a una empresa sella en vez de apilar');
rev(/if \(!ORG\) return undefined;/.test(app), 'y sin empresa abierta el «atrás» no intenta repintar nada');

console.log('· las pantallas de entrada NO entran al historial');
rev(!/irA\([^)]*'v-(codigo|clave|correo|nueva)'/.test(app), 'ni el código ni la contraseña apilan');

console.log(`\n${revisadas} revisadas · ${fallas} fallas`);
process.exit(fallas ? 1 : 0);
