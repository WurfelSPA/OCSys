# OC en cuotas — 1 sola fila visible, con chips de aprobación por cuota

Fecha: 2026-10-20

## Contexto y problema

Hoy, cuando una OC se paga en N cuotas, el listado (Mesa de Órdenes, componente
`OrdenesList` en `index.html`) las agrupa visualmente bajo 1 fila resumen colapsada,
con una columna "Detalles" (▸/▾) que hay que expandir para ver cada cuota hija y
poder aprobarla, facturarla o registrar su pago — ver
`docs/superpowers/specs/2026-10-07-agrupar-cuotas-listado-design.md`.

El Gerente (Claudio Aguilera) quiere ver y gestionar las N cuotas de una OC **sin
expandir nada**: 1 sola fila, con un control visual directo para aprobar/facturar/
pagar cada cuota una por una, usando como referencia el PDF de la OC (que ya lista
las cuotas en una tabla) como el "look" deseado también en la web.

## Decisión clave: no se toca el modelo de datos

El 29 de septiembre se migró deliberadamente de "1 fila + jsonb `cuotas`" a "N filas
independientes" porque cada cuota necesita su propio ciclo de aprobación/factura/pago
y su propio N° HES (ver `docs/superpowers/specs/2026-09-29-ordenes-en-cuotas-design.md`).
Ese problema sigue vigente y esta mejora **no lo reabre**: las N filas en
`ordenes_compra` siguen existiendo tal cual, con su `cuota_numero`/`cuota_total`,
su propio `estado`, HES, factura y comprobante. Lo único que cambia es **cómo se ven
y se accionan** en el listado web y en el PDF — es un cambio de presentación, no de
esquema. No se agregan columnas nuevas a la base de datos.

## Alcance

**Incluido:** el listado web y el PDF de OC con más de 1 cuota (`cuota_total > 1`).

**Explícitamente fuera de alcance:**
- OC de 1 sola cuota: sin cambios, siguen con el botón "Aprobar"/"Facturar"/
  "Registrar Pago" de siempre.
- No se migra ni se reestructura `ordenes_compra`, `_cuotas.js` ni el PUT de
  aprobación/factura/pago por fila — siguen operando igual, solo que ahora se
  disparan desde un control distinto (los chips) en vez del botón de la fila
  hija expandida.

## Cambio 1 — Permisos de aprobación (ya aplicado, sin código)

Claudio Aguilera es el nuevo Gerente: de ahora en adelante **solo él aprueba**, con
Alex Meléndez (administrador del sistema) como respaldo por si Claudio necesita que
apruebe algo urgente en su ausencia. Esto ya se resolvió actualizando la tabla
`usuarios` en Supabase — no hace falta ningún chequeo especial de correo en el
código, porque `nivel_aprobacion === 1` (la constante `puedeAprobar` que ya usa toda
la app: Aprobar/Facturar/Pagar/Desaprobar/Eliminar OC y Proveedor, Sync Acquisys,
Configuración de correos) ya es el gate correcto:

| Usuario | `nivel_aprobacion` antes | `nivel_aprobacion` ahora |
|---|---|---|
| caguilera@patagonica.cl (Claudio Aguilera) | 1 | 1 |
| amelendez@patagonica.cl (Alex Meléndez, admin) | 1 | 1 |
| cvilugron@patagonica.cl (Carolina Vilugrón) | 1 | 0 |
| rmijac@patagonica.cl (Rudolf Mijac) | 1 | 0 |

Los chips de cuotas (Cambio 2) reusan este mismo `puedeAprobar` — ni más ni menos
permisivo que el resto de la app.

## Cambio 2 — Listado web: fila única con chips por cuota

**Se elimina** la columna/comportamiento "Detalles" (▸/▾ para expandir) para OC con
`cuota_total > 1`. Nunca se renderizan las filas hijas por separado; siempre se ve
1 sola fila por OC, igual que hoy se ve una OC de 1 cuota.

**Nunca se muestra el sufijo** `-1`/`-2`/etc. en ningún lado de esa fila (ya es
mayormente así hoy vía `numero_oc_visible`/`numero_oc_acquisys` recortado con
regex para la fila de grupo — se verifica que no quede ningún lugar donde se filtre
el sufijo crudo).

**Nuevo widget "Cuotas"** (reemplaza el texto "Expandir para gestionar" de hoy):
una fila de círculos pequeños, uno por cuota, en orden de `cuota_numero`. Cada
círculo tiene exactamente 2 estados visuales — sin íconos de "$"/factura, sin
distinguir Aprobada/Facturada/Completada entre sí por color:

- **Vacío, borde azul** — la cuota sigue en `"Pendiente aprobación"`.
- **Verde con check** — la cuota ya pasó de `"Pendiente aprobación"` (está en
  `"Aprobada"`, `"Facturada"` o `"Completada"`).

**Tooltip al pasar el mouse:** muestra la `cuota_observacion` de esa cuota (ej.
"Anticipo", "30% avance") — nunca la palabra de estado, porque el color ya la dice.
Si la cuota está emitida (verde), el tooltip agrega la fecha: `"Anticipo — emitida
15-10-2026"`, usando el campo `fecha_asignacion` que la fila ya guarda hoy al
aprobarse (no es un campo nuevo, solo se muestra). Si esa cuota no tiene
`cuota_observacion` cargada (puede quedar vacía al crear la OC), el tooltip cae a
`"Cuota N/M"` en su lugar, para que nunca quede un tooltip en blanco.

**Clic en un círculo** (habilitado solo si `puedeAprobar`; para el resto del equipo
el círculo sigue mostrando el tooltip pero no reacciona al clic):

- Círculo **azul/pendiente** → abre el mismo modal de "Aprobar" que existe hoy
  (`OrdenAccionModal` tipo `"aprobar"`), apuntando a **esa fila hija específica**
  (su `id`), no a la fila resumen. Mismo flujo de siempre: asigna N° HES, regenera
  el PDF (ver Cambio 3) y envía el correo al proveedor. Se reusa el componente tal
  cual — el único cambio es qué fila le pasa como `orden`.
- Círculo **verde/emitido** → si a esa cuota todavía le falta Facturar
  (`estado === "Aprobada"`) o Registrar Pago (`estado === "Facturada"`), el clic
  abre el modal correspondiente (`OrdenAccionModal` tipo `"facturar"`/`"pagar"`),
  igual que hoy, apuntando a esa fila hija. Si ya está `"Completada"`, el clic no
  hace nada (ya no hay ninguna acción pendiente para esa cuota).

**Columnas que no cambian:** "Editar" sigue abriendo `EditarGrupoModal` (datos
compartidos de las N cuotas), "Eliminar" sigue eliminando el grupo completo
(`eliminarGrupo`), "Duplicar" sigue duplicando usando la cuota 1 como referencia
— todo igual que hoy. "Monto Neto" sigue mostrando la suma del grupo
(`monto_neto_grupo`); "Monto Cuota"/"Pendiente" siguen en "—" para estas filas
(el detalle por cuota ya está en los chips, no se duplica en esas columnas).

## Cambio 3 — PDF consolidado con las N cuotas y su Estado

Hoy `generarPdfOC` arma, para una fila con `cuota_total` definido, **una sola fila**
en la tabla del PDF (la posición de esa fila puntual, ej. "1/6") — no lista las
demás cuotas. Pasa a listar **todas** las cuotas del grupo en una sola tabla,
igual que el PDF de referencia que mostró el Gerente:

| Columna | Contenido |
|---|---|
| Cuota | `cuota_numero/cuota_total`, ej. `1/6` |
| Observación | `cuota_observacion` de esa cuota |
| Porcentaje | igual que hoy (monto de la cuota / monto neto total) |
| Monto | `monto_neto` de esa cuota |
| Estado | `"Emitida"` o `"Pendiente"` — mismo criterio binario que los chips web |
| Fecha Emisión | `fecha_asignacion` formateada, o `"—"` si sigue pendiente |

- El encabezado deja de mostrar la anotación `"Cuota N de M"` (ya no aplica, el PDF
  ahora siempre representa el grupo completo) y usa el número de OC sin sufijo.
- "Base Imponible"/"IVA"/"Total" siguen siendo los de **toda la OC** (la suma de
  las N cuotas), no los de una sola.
- Este PDF se regenera cada vez que se **aprueba** cualquier cuota del grupo (es la
  única transición que cambia la columna Estado/Fecha Emisión de la tabla — Facturar
  y Registrar Pago no tocan esas columnas ni el PDF de la OC, igual que hoy). Se sube
  y se adjunta al correo de aprobación de esa cuota, y además se actualiza
  `archivo_oc_url`/`archivo_oc_nombre` de la **cuota 1** del grupo (la que realmente
  se ve y se puede abrir desde la columna "N° OC" del listado, ya que las demás
  cuotas dejan de tener fila propia visible) — así el link que ve el usuario siempre
  apunta a la versión más reciente, sin importar cuál cuota se acaba de aprobar.
- Para construir la tabla, el código que genera el PDF necesita las N filas
  hermanas (hoy cada llamada a `generarPdfOC` solo recibe la fila sobre la que se
  está actuando) — se buscan por `numero_oc_base` antes de generar, igual que ya
  hace `filasAgrupadas` en el listado web.

## Fuera de alcance / decisiones explícitas

- No se agrega ningún campo nuevo a `ordenes_compra` — todo lo que se muestra
  (observación, estado, fecha de emisión) ya existe por fila.
- No se cambia el criterio de aprobación/factura/pago por fila (sigue siendo
  exactamente el mismo PUT y las mismas reglas de transición de estado que hoy).
- No se distingue visualmente Aprobada/Facturada/Completada en el listado web
  (todas se ven "verde, emitida") — la distinción real se resuelve en el momento
  del clic, según el `estado` real de esa cuota.
- No se toca nada de las OC de 1 sola cuota.
