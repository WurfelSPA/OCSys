# Acceso restringido por Empresa/Proyecto — diseño

Fecha: 2026-10-01

## Contexto

El complejo de empresas entra en remodelación y todas las OC/Facturas de esa
obra se van a manejar desde OCFast. Eso implica dar acceso a usuarios
externos a la obra (ej. `mae@gestionobras.cl`, vinculado a "Remodelación El
Cortijo") que **no deben ver** las OC de otras empresas/proyectos — a
diferencia de los usuarios `@patagonica.cl`, que siguen viendo todo sin
restricción, como hoy.

## Alcance

**Incluido:**
- Un nuevo campo "PROYECTO" en Administración → Nuevo/Editar Usuario, para
  vincular al usuario a una empresa completa o a un proyecto puntual dentro
  de una empresa (o dejarlo "sin restricción", el comportamiento actual).
- Esa vinculación filtra, del lado del servidor (no solo visual): Órdenes,
  Nueva OC, Dashboard, Reportes y Rendición de Gastos.
- En Nueva OC, si el usuario tiene un proyecto puntual asignado, el campo
  "Proyecto" aparece fijo y bloqueado con ese valor.
- Si el usuario está restringido (empresa o proyecto), se le oculta el
  selector de empresa del encabezado y el botón "Administración".

**Explícitamente fuera de alcance (confirmado con el usuario):**
- Proveedores: catálogo compartido, se sigue viendo completo sin filtrar.
- El menú "Proyectos" (bitácora de seguimiento/WhatsApp, agregada
  recientemente): sigue libre para cualquier usuario, no tiene relación con
  este cambio.
- Rendición de Gastos no tiene columna "proyecto" en la base de datos — un
  usuario atado a un proyecto puntual (no a toda una empresa) ve ahí la
  rendición de **toda su empresa**, no solo la de su proyecto (limitación
  conocida y aceptada, documentada acá para que no sea sorpresa).

## Modelo de datos

Dos columnas nuevas en `usuarios`, ambas nullable:
- `empresa_id` (integer, FK a `empresas`) — si está seteada, el usuario
  queda atado a esa sola empresa (no ve ni puede cambiar a las otras 2).
- `proyecto_id` (uuid, FK a `proyectos`) — si además está seteada, acota
  aún más: solo ve las OC de ese proyecto puntual dentro de esa empresa.

Ambas en `null` (caso de todos los usuarios hoy) = sin restricción, ve todo
— así quedan los `@patagonica.cl` existentes y cualquier usuario interno
nuevo que no se quiera restringir.

Regla de consistencia: si `proyecto_id` está seteado, `empresa_id` debe ser
el de ese proyecto (se deriva automáticamente al elegir en el desplegable,
nunca se editan por separado).

## UI — Administración → Nuevo/Editar Usuario

Un solo campo "Proyecto" (`<select>`), con esta estructura de opciones:

```
Sin restricción (ve todo)
──────────────────────────
Patagónica
  Toda la empresa
  Remodelación El Cortijo
  Habilitación Edificio 57 — Bodega DKO
  Contenedor
Campo Mar
  Toda la empresa
  Camping
  Glamping Refugio
  Contenedor
Evox
  Toda la empresa
  Contenedor
```

Las opciones de proyecto salen del catálogo real (`proyectos`, activos) —
no hay nada hardcodeado, así que un proyecto nuevo que se cree aparece acá
solo, sin tocar código. Al elegir "Toda la empresa X" se guarda
`empresa_id=X, proyecto_id=null`; al elegir un proyecto puntual se guarda
`empresa_id` (el de ese proyecto) y `proyecto_id`.

## Sesión (JWT)

El payload del token (hoy: `id, usuario, nombre, apellido,
nivel_aprobacion, exp`) suma `empresa_id` y `proyecto_id` (ambos pueden ir
`null`). Se completan al hacer login y se devuelven igual en
`GET /api/auth?action=me`.

## Filtro server-side (no eludible desde el navegador)

- `GET /api/ordenes`: si la sesión trae `empresa_id`/`proyecto_id`, se
  ignora el `empresa_id` que mande el query string del frontend y se filtra
  siempre por el de la sesión; si además hay `proyecto_id`, se agrega
  `eq("proyecto_id", ...)`.
- `GET /api/rendiciones`: mismo mecanismo, pero solo a nivel empresa (no
  existe columna proyecto en esa tabla — ver limitación arriba).
- Dashboard y Reportes se arman en el frontend a partir del mismo array de
  Órdenes que ya llega filtrado por `GET /api/ordenes` — heredan la
  restricción sin lógica adicional.
- `POST /api/ordenes` (creación): si la sesión trae `proyecto_id` fijo, el
  backend ignora cualquier `proyecto_id` que mande el body y usa siempre el
  de la sesión (refuerza el bloqueo del campo en el frontend, para que no
  sea solo cosmético).

## Frontend

- `App`: si `currentUser.empresa_id` está seteado, el `<select>` de empresa
  del encabezado no se muestra (se fija esa empresa como única) y se oculta
  el botón "Administración" del nav.
- `NuevaOC`: si `currentUser.proyecto_id` está seteado, el campo "Proyecto"
  aparece preseleccionado y deshabilitado (no un simple default, el `select`
  queda `disabled`).
- `UsuarioModal`: agrega el nuevo campo "Proyecto" (select descrito arriba),
  guarda `empresa_id`/`proyecto_id` al crear/editar un usuario.
