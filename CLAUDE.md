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

## Nueva empresa San Miguel SPA + Proyecto Portería Polo — EN PAUSA (detenido a pedido del usuario, retomar desde acá)

**Pedido original:** crear una 4ta empresa en OCFast, **San Miguel SPA** (RUT
`76.731.985-1`), "con la misma lógica" que Patagónica/Campo Mar/Evox, y cargar
en ella las OC de un proyecto en ejecución ("Proyecto Portería Polo", Campo El
Polo) para llevar su registro. Fuente de datos:
`C:\Users\ALEX MELENDEZ\Desktop\Patagonica\Proyecto Portería Polo\` (3 archivos:
`factura 180.pdf`, `Presupuesto_Maestro_El_Polo Rv6.xlsx`,
`Control_Gastos_Porteria_El_Polo.xlsx`). Si el proveedor de una OC no existe en
la tabla `proveedores`, crearlo solo con los datos que haya en el Excel.

**Lo que ya se investigó (no repetir la exploración):**
- La planilla con el registro real de OC es `Control_Gastos_Porteria_El_Polo.xlsx`,
  hoja **"Registro OC"** (NO la hoja "Resumen", que es solo el tablero de
  indicadores armado con fórmulas que apuntan a "Registro OC" y a
  "Control por partida"). "Registro OC" tiene 506 filas, columnas:
  `N° OC | Folio en documento | Fecha OC | Proveedor | Descripción | Código
  partida | Partida (automático) | Moneda | Monto neto s/IVA | Valor UF
  (opcional) | Neto UF (automático) | Incluir | Imputación | Observación | %
  pagado | Pagado UF (automático)`.
- Filas de ejemplo ya leídas (7-10): N° OC `PPL-1-25` (BAUMAX SPA, UF
  732,16, Incluir=SI, %pagado=1), `PPL-2-25` (Modulos Patagonia SpA, CLP
  3.978.000, Incluir=SI), `PPL-4-26` (ECOCONSTRUIR SPA, 2 líneas con el mismo
  N° OC por tener 2 partidas, CLP, Incluir=SI). Columna "Incluir" = NO deja la
  fila registrada pero sin sumarla al control (revisar si esas también deben
  crearse como OC en OCFast o quedar afuera).
- El resto de la planilla (`Presupuesto_Maestro_El_Polo Rv6.xlsx`, hojas
  `RESUMEN EJECUTIVO`, `Pagado a la Fecha Muros`, `Resumen Etapa 1-Etapa 2`,
  `ETAPA 1 — DETALLE`, `DETALLE ETAPA 1-A`, `ETAPA 2 — DETALLE`) es el
  presupuesto maestro contra el que se compara el gasto — no se exploró en
  detalle todavía, probablemente no hace falta para crear las OC en sí.
- Nota de la planilla: el valor UF usado para convertir a CLP es **UF
  40.779** al **20-10-2026** (celda `Resumen!E5`), y puede venir distinto por
  fila en la columna "Valor UF (opcional)" de "Registro OC".
- `factura 180.pdf` no se abrió todavía — probablemente respalda una OC
  puntual (folio/factura #180).

**Lo que falta por hacer (nada de esto se ejecutó todavía):**
1. Terminar de volcar las 506 filas de "Registro OC" (filtrando cuáles
   corresponden a OC reales a crear — probablemente solo `Incluir=SI`, a
   confirmar con el usuario) y agruparlas por N° OC (una OC puede tener
   varias líneas/partidas, ver nota de la planilla sobre PPL-4, PPL-13,
   PPL-19).
2. Crear la empresa **San Miguel SPA** en OCFast: fila en tabla `empresas`
   (nombre, rut, correo_contabilidad, etc.), entrada en
   `EMPRESA_PDF_INFO` de `index.html` (necesita un logo — no hay ninguno
   provisto todavía, preguntar al usuario o usar un fallback de solo texto),
   un color de acento propio en el CSS (`[data-empresa="4"]`, distinto de los
   azules/verdes/negro ya usados por las otras 3, siguiendo el patrón
   existente), semilla en `contadores_oc`/`contadores_hes` para el
   `empresa_id` nuevo, y decidir si necesita su propio catálogo de Centro de
   Costo/Cuenta Contable o si comparte el de Patagónica (dado que es "la
   misma lógica", probablemente necesita su propio catálogo mínimo — a
   confirmar).
3. Revisar/crear proveedores faltantes (BAUMAX SPA, Modulos Patagonia SpA,
   ECOCONSTRUIR SPA, y los que falten del resto de las 506 filas) con los
   datos disponibles en la planilla (razón social, quizás RUT si está en
   algún lado — no se vio todavía una columna de RUT de proveedor en
   "Registro OC", revisar la hoja "Proveedores" del mismo archivo, que
   tampoco se exploró aún).
4. Crear un proyecto en el catálogo `proyectos` para "Portería El Polo"
   (o el nombre que decida el usuario) bajo la empresa San Miguel SPA.
5. Crear las OC reales en `ordenes_compra` (vía API, no INSERT directo, para
   que se respete el correlativo de `numero_oc` igual que una OC nueva) —
   fecha, proveedor, monto, moneda, centro de costo/cuenta
   contable/proyecto, estado (probablemente "Completada" o algo que refleje
   que son históricas ya pagadas, no "Pendiente aprobación" — a confirmar,
   la nota de la planilla dice que todas las OC antes de PPL-19 están
   pagadas al 100%).

**Decisiones/preguntas pendientes de resolver con el usuario antes de seguir:**
- ¿Logo y color de acento para San Miguel SPA?
- ¿Catálogo de Centro de Costo/Cuenta Contable propio o compartido?
- ¿Se crean TODAS las filas de "Registro OC" (506, incluyendo históricas ya
  pagadas) o solo un subconjunto?
- ¿Qué `estado` deben llevar estas OC históricas en OCFast (Completada vs
  Facturada vs otro) para no disparar correos de aprobación/HES nuevos por
  algo que ya ocurrió hace tiempo?
- ¿Las filas con `Incluir=NO` se crean igual (marcadas de alguna forma) o se
  excluyen?

## Cómo trabajar en este repo

- Siempre commit + push al terminar (el usuario lo pidió como regla).
- No hay build: validar sintaxis extrayendo el `<script>` de `index.html` y
  pasándolo por `node --check`.
- No usar `Get-Content`/`Set-Content` de PowerShell para reescribir código
  (corrompe UTF-8); usar las herramientas de edición o Node.
- Si `apply_migration` de Supabase no está disponible, dejar el SQL en
  `docs/migrations/` para que el usuario lo corra en el SQL Editor.
