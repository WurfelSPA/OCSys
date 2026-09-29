# OC con pago en cuotas — HES independiente por cuota

Fecha: 2026-09-29

## Contexto y problema

Hoy, cuando una Orden de Compra se paga en cuotas, el sistema guarda **una sola fila**
en `ordenes_compra` con un arreglo `cuotas` (jsonb) que documenta el cronograma de pago
(fecha/monto/porcentaje de cada cuota), pero toda la fila comparte:
- un solo `numero_oc`
- un solo `numero_hes` (asignado al aprobar)
- un solo ciclo de aprobación/factura/pago

En la práctica esto no calza con cómo se procesa administrativamente una compra en
cuotas: cada cuota se aprueba, se factura y se paga por separado, y cada una necesita
su propio código HES.

De hecho, **Acquisys ya maneja este mismo caso** — al revisar los datos históricos
sincronizados se encontraron ~15 OC donde `numero_hes` contiene varios valores
separados por coma en un solo campo de texto (ej. `"1772548618768, 1772822114627,
1775583876741, ..."` para la OC `GEOP-02-2026-00038`, con 6 HES). Es decir, Acquisys sí
genera un HES por cuota/entrega; el script de sincronización de OCFast simplemente los
concatena en un solo campo en vez de crear una fila por HES.

## Alcance

**Incluido:** OC nuevas creadas de aquí en adelante directamente en OCFast (no
sincronizadas desde Acquisys), cuando tengan más de 1 cuota.

**Explícitamente fuera de alcance:**
- No se migra el historial ya sincronizado desde Acquisys (esas ~15 OC con HES
  concatenados quedan tal cual están).
- No se tocan OC de 1 sola cuota más allá del cambio de formato de HES (ver abajo),
  que aplica parejo a todas.

## Cambio 1 — Correlativo real de HES (reemplaza el timestamp actual)

Hoy `numero_hes` se genera como `Date.now().toString()` (ej. `"1790354005101"`, 13
dígitos) — no es un correlativo real, es solo una marca de tiempo usada como ID único.

**Nuevo comportamiento** (aplica a *todas* las OC aprobadas de aquí en adelante, tengan
o no cuotas):

- Tabla nueva `contadores_hes` — mismo patrón que `contadores_oc`:
  ```sql
  create table contadores_hes (
    empresa_id integer primary key references empresas(id),
    ultimo_numero bigint not null
  );
  insert into contadores_hes (empresa_id, ultimo_numero) values
    (1, 17903340), (2, 17903340), (3, 17903340);
  ```
  (Los 3 arrancan en el mismo número, `17903340`, elegido por continuidad visual con
  el último HES real que generó Patagónica — `1790333833379` truncado a 8 dígitos.
  No hay riesgo de choque con HES viejos: esos tienen 13 dígitos, los nuevos 8, se
  distinguen solo por el largo.)

- Función `siguiente_numero_hes(p_empresa_id integer) returns text`, mismo estilo que
  `siguiente_numero_oc`: incrementa `ultimo_numero` en `contadores_hes` para esa
  empresa y devuelve el valor como texto de 8 dígitos (`lpad(numero::text, 8, '0')`).

- En `api/ordenes.js`, donde hoy se asigna `fields.numero_hes = body.numero_hes ||
  Date.now().toString()` al pasar a `"Aprobada"`, se reemplaza por una llamada a
  `siguiente_numero_hes(empresa_id)` (respetando igual que hoy la opción de que el
  cliente ya mande un `numero_hes` propio, caso que hoy solo se usa para no
  regenerar PDF dos veces en el flujo de aprobación — ese caso especial no cambia).

## Cambio 2 — División en N filas al generar una OC con cuotas > 1

**Disparador:** al pasar una OC de `Borrador`/nueva a `"Pendiente aprobación"`
(botón "Generar OC" en Nueva OC o en Editar OC) cuando `cuotas.length > 1`.

**Qué se crea:** N filas en `ordenes_compra` en vez de 1, donde N = cantidad de
cuotas del formulario.

**Idéntico en las N filas** (se copian del formulario, sin cambios):
proveedor, título, descripción, condiciones, motivo, proyecto, centro de costo,
cuenta contable, tipo de orden, tipo de compra, moneda, fecha, N° de cotización,
y `archivo_url`/`archivo_nombre` (la cotización/anexo que subió el proveedor — se
sube **una sola vez**, las N filas apuntan al mismo archivo en Storage).

`archivo_oc_url`/`archivo_oc_nombre` (el PDF de la OC generada) **no** es idéntico
entre filas — cada fila tiene su propio PDF, ver Cambio 3.

**Independiente por fila desde el momento de la creación:**
- `id` (uuid propio)
- `numero_oc`: mismo número base + sufijo de cuota — `PA-OC-20260929-00300-1`,
  `-2`, `-3`. Solo se consume **un** número del correlativo `siguiente_numero_oc`
  para el grupo completo (no N números).
- `monto_neto` / `monto_iva` / `monto_total`: el de **esa** cuota (no el total
  completo) — se toma directo del array `cuotas` que ya arma
  `distribuirCuotas()` en el formulario.
- Dos columnas nuevas en `ordenes_compra`: `cuota_numero integer null` y
  `cuota_total integer null` (ej. fila 2 de 3 → `cuota_numero=2, cuota_total=3`;
  en una OC normal de 1 sola cuota, ambas quedan `null`). Esto es lo que permite
  mostrar "Cuota 2 de 3" en el PDF y, si se quiere más adelante, en el listado —
  sin necesitar parsear el sufijo del `numero_oc` ni mantener un id de grupo aparte.
- `cuotas` (el jsonb): queda vacío (`[]`) en cada fila — ya no hace falta, el
  monto de la fila ya representa esa cuota individual.
- Estado, HES, factura, comprobante de pago, fechas: 100% independientes desde
  el primer momento. Cada fila avanza sola por `Pendiente aprobación → Aprobada →
  Facturada → Completada`, con su propio HES asignado al aprobarse (usando el
  correlativo del Cambio 1), y su propia factura/comprobante cargados por separado.
  Esto ya funciona así hoy para cualquier fila individual — no requiere lógica
  nueva más allá de que ahora hay N filas en vez de 1.

**Después de creadas, las N filas son completamente independientes** — editar,
aprobar o eliminar una no afecta a las demás. No hay sincronización posterior entre
"cuotas hermanas".

## Cambio 3 — PDF de la OC

- El PDF que se genera al "Generar OC" (antes de aprobar, sin HES todavía) se genera
  una vez por fila (no se reutiliza el mismo archivo para las N, porque cada uno
  muestra su propio N° de OC y monto) — pero el archivo de la cotización/anexo que
  el proveedor mandó sí es el mismo para las N.
- Se agrega la anotación `(Cuota 2 de 3)` junto al encabezado "Orden de Compra
  #PA-OC-20260929-00300-2" cuando `cuota_total` no es null — así quien aprueba
  entiende de inmediato que el monto es una fracción del total y por qué el título/
  descripción se repite en varias OC.
- El PDF final regenerado al aprobar (que ya incluye el HES y hoy ya es por fila)
  no cambia de lógica, solo hereda el N° de OC con sufijo y la anotación de cuota.

## Cambio 4 — Listado de Órdenes

Sin cambios estructurales: las N filas aparecen como filas normales del listado,
identificables por el sufijo del N° de OC y el monto de cada una. No se agrupan
visualmente ni se colapsan.

## Fuera de alcance / decisiones explícitas

- No se migra el historial de Acquisys con HES concatenados.
- No se agrega un id de grupo compartido entre las N filas — `cuota_numero` +
  `cuota_total` en cada fila es autosuficiente para todo lo que se necesita hoy.
- No hay sincronización entre cuotas hermanas después de creadas (editar una no
  edita las demás).
