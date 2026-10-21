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

## Nueva empresa San Miguel SPA + Proyecto Portería Polo — COMPLETO (2026-10-21)

4ta empresa en OCFast, **San Miguel SPA** (`empresas.id=4`, RUT
`76.731.985-1`, `codigo='SM'`, `correo_contabilidad='contabilidad@patagonica.cl'`),
creada para llevar el registro de las OC de "Proyecto Portería Polo" (Campo El
Polo), con datos sacados de
`C:\Users\ALEX MELENDEZ\Desktop\Patagonica\Proyecto Portería Polo\Control_Gastos_Porteria_El_Polo.xlsx`
(hoja "Registro OC", 62 filas reales agrupadas en 27 N° OC distintos).

**Qué se creó:**
- `index.html`: `[data-empresa="4"]` con tonos naranjos (`--acc:#C2500A`,
  `--acc2:#F08A24`, `--accl:#8F3B06`, `--accbg:#FDEEE0`); `EMPRESA_PDF_INFO[4]`
  con `logo: null` (sin logo — header y PDF quedan solo con texto, ya
  soportado por los `if (info.logo)` existentes).
- Centro de Costo `000005` / Cuenta Contable `11080200100` ("PROY. EN
  EJECUCION PORTERIA EL POLO"), ambos bajo `empresa_id=4`. Ojo: `codigo` de
  `centros_costo` es **único a nivel global** (no por empresa), por eso no se
  pudo reusar "000001".
- Proyecto `proyectos` "Portería El Polo" (`empresa_id=4`, `estado_proyecto`
  'En ejecución', código auto-asignado por trigger: `PO-PRY-010`) —
  independiente del proyecto "REMODELACIÓN EL CORTIJO" (ese es de Patagónica,
  `empresa_id=1`, no tiene relación).
- 7 proveedores nuevos (BAUMAX SPA, Modulos Patagonia SpA, ECOCONSTRUIR SPA,
  TECNIFICA IT SPA, SEGURIDAD OPERATIVA RJ CHILE SPA —RUT corregido a
  `77.323.255-5`, el de la planilla traía un dígito de más—, Construcciones
  Angelo Pizarro Lazo EIRL, VYA Ingeniería y Construcción).
- 15 OC (`SM-OC-00001` a `SM-OC-00015`, `numero_hes` `00000001`-`00000015`),
  todas `estado='Aprobada'` directo (sin correo, `cliente_destino='Otro'`,
  IVA 19% calculado sobre el neto). De los 27 N° OC del Excel se excluyeron
  12: 1 con todas las líneas `Incluir=NO` y 11 con datos incompletos/dudosos
  en la planilla (proveedor sin identificar, RUT a verificar, monto no
  informado, etc. — ver `PPL-3-25 (tablero)`, `PPL-8-26 PL C/PL M/BÑ`,
  `PPL-17-26`, `PPL-18-26`, `PPL-20-26`, `PPL-21-26`, `PPL-24-26`,
  `PPL-25-26`, `PPL-27-26`). Esas 11 quedan pendientes si el usuario decide
  completar/confirmar sus datos más adelante.
- Las OC con varias partidas en la planilla (PPL-4-26, PPL-12-03, PPL-13-26,
  PPL-19-26) se cargaron como **una sola OC** con `monto_neto` = suma de sus
  líneas (son splits de presupuesto de una misma compra, no cuotas/pagos
  separados).

## Cómo trabajar en este repo

- Siempre commit + push al terminar (el usuario lo pidió como regla).
- No hay build: validar sintaxis extrayendo el `<script>` de `index.html` y
  pasándolo por `node --check`.
- No usar `Get-Content`/`Set-Content` de PowerShell para reescribir código
  (corrompe UTF-8); usar las herramientas de edición o Node.
- Si `apply_migration` de Supabase no está disponible, dejar el SQL en
  `docs/migrations/` para que el usuario lo corra en el SQL Editor.
