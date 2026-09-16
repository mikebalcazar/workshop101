# workshop101

El panel del **administrador de una empresa cliente** de la suite 101: su
gente, con qué rol entra cada quien y a qué apps. Es el eslabón entre
nosotros (master101, el panel de la suite) y los usuarios finales de cada
app: el dueño o la administración de la empresa decide quién entra a qué.

Es un Worker de Cloudflare que sirve un HTML y le habla a `suite101-api` por
dentro (service binding, `/s101/*`, `X-App: workshop101`). Mismo molde que
master101, sin framework.

| | |
|---|---|
| Staging | `workshop101-staging.mike-929.workers.dev` → `suite101-api-staging` (org `demo` y las de prueba) |
| Producción | `workshop101.mike-929.workers.dev` → `suite101-api` (`forespot`) |

## Quién entra

Quien sea **dueño** o **administración** de al menos una empresa (`/s101/yo`
trae sus empresas con su rol). El superadmin de la suite entra también y ve
toda empresa como su dueño. Con una sola empresa se abre directo; con varias,
hay un selector en la barra. Un socio, alguien de oficina o un cliente del
portal entra a la suite pero aquí ve «esta cuenta no administra ninguna
empresa».

Se entra con correo y código, con PIN, o con Google (cuando Mike prenda las
llaves en la API).

## Las pantallas

1. **Gente.** Una fila por persona: correo, nombre, rol (un selector), las
   apps que la empresa tiene prendidas (una casilla por app), última entrada y
   «Quitar». Cambiar el rol o palomear una app hace `PATCH
   /admin/orgs/:o/miembros/:uid` y repinta con lo que la API contesta. Todas
   las apps palomeadas se manda como lista vacía: la persona entra a todas las
   de la empresa, también a las que se prendan después. Abajo, **agregar a
   alguien** por correo, rol y apps (`POST …/miembros`). Quitar pide escribir
   el correo tal cual (`DELETE …/miembros/:uid`).
2. **Cambios.** La bitácora de la empresa (`GET /admin/orgs/:o/bitacora`):
   altas y bajas, cambios de rol y de apps, y lo que la suite prendió o apagó.
   La escribe la API sola.

Los candados los pone la API (contrato 0.6.0) y la pantalla sólo deja de
ofrecer lo que la API va a rechazar: la propia fila no se toca; sólo un dueño
nombra, cambia o quita a un dueño; el último dueño no se baja ni se degrada;
`apps` sólo con llaves que la empresa tenga. Y la puerta de cada app aplica la
lista: quien sólo tiene dash101 recibe `403 app_no_permitida` en quell101.

## Cómo se prueba

```
npm ci
node pruebas/servidor.mjs --falso      # banco de pruebas con una API de mentiras, en :8791
node pruebas/panel.spec.mjs            # Playwright, 390×844 y 1440, contra el banco
```

En el banco falso, en la empresa `demo`: `duena@ejemplo.mx` (dueña),
`admi@ejemplo.mx` (administración), `socia@ejemplo.mx` (socia, sólo dash101),
`oficina@ejemplo.mx` (oficina, quell101 y peek101) y `cliente@ejemplo.mx`
(cliente del portal, no administra). El código lo devuelve `/auth/codigo`.

Contra staging (lo hace el flujo de publicación):

```
BASE=https://workshop101-staging.mike-929.workers.dev \
API_ORIGEN=https://suite101-api-staging.mike-929.workers.dev \
CORREO_SUPERADMIN=… CORREO_CONTROL=… node pruebas/panel.spec.mjs
```

Entra como superadmin, crea una empresa de prueba por la API, maneja su
gente desde la pantalla y la borra al final. `scripts/medir.mjs` mide lo
publicado (cáscara, versión, enlace a la API que toca, `X-App` puesto por el
Worker, la gente y la bitácora de `demo`, la cuenta de control con 403, y
la puerta de Google).

## Cómo se publica

`.github/workflows/publicar.yml`, en cada push a `main`: staging → medición →
navegador contra staging → producción → medición. Lo medido vuelve como
comentario del commit. Secretos del repositorio: `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` (los mismos que master101). Variables:
`CORREO_SUPERADMIN`, `CORREO_CONTROL`.
