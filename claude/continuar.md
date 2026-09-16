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
