# OCFast (OCSys) — contexto para Claude

App de Órdenes de Compra de Patagónica / Campo Mar / Evox. Frontend en un
solo `index.html` (React 18 UMD con `h()`, sin build ni JSX) + funciones
serverless en `api/` (Vercel, deploy automático al hacer push a `main`).
Base de datos: Supabase proyecto **OCSys** (`kvzcmmcbzlcrvtvfjxaj`); la API
usa la service role key, por eso las tablas tienen RLS activado sin políticas.

Diseños y planes de cada cambio en `docs/superpowers/specs/` y
`docs/superpowers/plans/`; SQL ejecutado a mano en `docs/migrations/`.

## Menú Proyectos (gestión de proyectos tipo CRM) — en curso

Spec: `docs/superpowers/specs/2026-10-08-proyectos-fase1-design.md`.
API: `api/proyectos-seguimiento.js` (+ `api/_uf.js`). UI: `ProyectosPage`,
`ProyectoFicha`, `OtModal` en `index.html`.

Decisiones ya tomadas por el usuario (no volver a preguntar):
- Se trabaja **solo en el menú Proyectos**; no tocar Nueva OC, Órdenes,
  Dashboard, Reportes ni Administración salvo que se pida.
- El catálogo `proyectos` (el mismo del campo "Proyecto" de Nueva OC) es la
  ficha del proyecto. "Contenedor" no es un proyecto real (sin código, no se
  muestra en el menú).
- Solo personal `@patagonica.cl`.
- **Sin aprobaciones propias**: la aprobación del gasto viene de la OC; aquí
  solo seguimiento.
- Presupuesto en **UF** como unidad principal; las OC en CLP se convierten
  con la UF de la fecha de cada OC (mindicador.cl, cache `uf_diaria`).
- Contratista ejecutor **obligatoriamente** del catálogo de proveedores.
- "Mantención General": proyecto permanente por empresa para tareas sueltas.
- Códigos: el proyecto ES la Orden de Trabajo → `OT{sigla}-{nnn}` con
  correlativo único global (OTPA-001, OTGL-006…); sus sub-órdenes se llaman
  **Tareas** → `OTPA-001-01`. Se asignan por triggers en la BD.

Supuestos pendientes de validar con el usuario: montos en neto (sin IVA);
"Comprometido" excluye Borrador/Pendiente aprobación/Anulado/Rechazado; % de
avance manual.

Próximas fases propuestas: (2) hitos ponderados + semáforo plazo/avance +
dashboard de cartera; (3) notificaciones por correo; (4) informe PDF por
proyecto + adjuntos/fotos. Vincular OC↔Tarea requiere tocar Nueva OC.

## Cómo trabajar en este repo

- Siempre commit + push al terminar (el usuario lo pidió como regla).
- No hay build: validar sintaxis extrayendo el `<script>` de `index.html` y
  pasándolo por `node --check`.
- No usar `Get-Content`/`Set-Content` de PowerShell para reescribir código
  (corrompe UTF-8); usar las herramientas de edición o Node.
- Si `apply_migration` de Supabase no está disponible, dejar el SQL en
  `docs/migrations/` para que el usuario lo corra en el SQL Editor.
