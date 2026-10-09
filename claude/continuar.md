# workshop101 · para el chat que siga

- **Qué es:** el panel del administrador de una empresa cliente (dueño o
  administración): su gente, roles y apps por persona. Molde de master101.
- **Contrato de la API:** 0.6.0 (`suite101-api` #45). Rutas que usa: `/yo`,
  `GET /orgs/:o` (con `X-App: workshop101`, que la API trata como panel de
  control y sólo abre a owner/admin/superadmin), `GET/POST
  /admin/orgs/:o/miembros`, `PATCH/DELETE /admin/orgs/:o/miembros/:uid`,
  `GET /admin/orgs/:o/bitacora`.
- **Cómo se prueba:** `node pruebas/servidor.mjs --falso` + `node
  pruebas/panel.spec.mjs`. La API de mentiras copia los candados de
  `admin.ts`/`orgs.ts` del 0.6.0; si cambia el contrato, cambia también ahí.
- **Lo que no está:** invitaciones por correo (la tabla `invitaciones` de la
  API existe pero nadie la usa; hoy el alta es directa y la persona recibe su
  código al entrar), permisos finos dentro de cada app (el rol es por
  empresa), y la lista de apps por persona en `/yo` para que cada app pinte
  sólo lo suyo (la puerta ya la aplica).

## 8-oct-2026 · el look de cost101

Mike, 8-oct: «todas las plataformas (…) con el diseño look and feel de
cost101 pero siguiendo los parámetros de tipografía y de logo de dash y
quell». En `public/estilo.css`: en pantalla siempre oscuro (degradado azul,
vidrio, botones redondos, menú activo y selector de empresa en píldora,
diálogo de vidrio); al imprimir vuelven los claros y la barra no sale. La
caja del logotipo de la empresa se queda blanca a propósito: ese logo va en
documentos de papel. Tipografía igual (Cifras + Raleway locales, títulos en
600; Sansation ya no se declara). Logo oficial `public/workshop101-claro.svg`
en la barra (28 px) y en la entrada (36 px). Probado: dominio, entrada,
atrás, versión y panel.spec contra el banco (79 de 79), y capturas a
1440×900 y 390×844 sin desborde de página ni texto oscuro sobre oscuro.

**8-oct (noche), patron101 persona por persona.** Encargo del chat que
construyó patron101. Llave `investor` en `APPS` («patron101 (inversionistas)»);
sale sólo si la empresa la tiene prendida. Mike decidió con botones que la
casilla sale SÓLO en dueño y administración (`SOLO_QUIEN_DIRIGE` +
`appsParaRol`): la API no deja manejarla a socio ni a oficina
(rutas/inversion.ts), y uno de ellos que preste entra como inversionista sin
depender de esta casilla. El alta repinta las casillas al cambiar el rol. El
banco falso trae `investor` prendida en demo, como staging (migración 0025).

**9-oct, bill101 se da persona por persona.** Encargo del chat que construyó
bill101 (encargo-bill101.md, trabajo 3). La lista de apps gana «bill101
(facturas e impuestos)», llave `bill`; sale sólo en la empresa que la tiene
prendida, como cost101. NO va en `SOLO_QUIEN_DIRIGE`: en
`suite101-api/src/rutas/fiscal.ts` leer es `puedeLeer` (no cliente, no
inversionista, ve dinero; todo miembro ve dinero) y lo que cambia la cuenta
de los impuestos lo cuida `administra` (owner/admin o contador) ruta por
ruta. Así que se ofrece también a socio y oficina. La empresa `demo` del
banco falso y la que crea panel.spec en staging nacen con `bill: true`
(lección de #18).
