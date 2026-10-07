# Agrupar visualmente las cuotas de una OC en el listado de Órdenes

Fecha: 2026-10-07

## Contexto y problema

Desde [2026-09-29-ordenes-en-cuotas-design.md](2026-09-29-ordenes-en-cuotas-design.md), una OC
dividida en cuotas se guarda como N filas independientes (`OC-00236-1` ... `OC-00236-6`), cada
una con su propio ciclo de aprobación/factura/pago. El listado de Órdenes las muestra como N
filas sueltas, ordenadas adyacentes pero sin ninguna agrupación visual.

En la práctica esto hace fácil perderse entre los sufijos cuando una OC tiene varias cuotas:
cuesta ver de un vistazo cuál cuota ya se aprobó, cuál falta, o qué pasó con una cuota puntual
(ej. "la -3") sin leer fila por fila.

Esto además es el mismo problema de fondo que presenta el caso "Miguel Angel Etcheverry, CC El
Montijo, Pavimentación" (2 etapas de proyecto, cada una con 3 pagos EDP) — se resuelve cargando
esa OC con el mismo mecanismo de cuotas existente (6 cuotas, usando "Observación" para indicar
a qué etapa/EDP corresponde cada una), por lo que este cambio aplica igual a ambos casos.

## Alcance

**Incluido:** cambios de presentación en `OrdenesList` (agrupar/colapsar cuotas en el listado,
nuevo orden por N° de OC). Sin cambios de modelo de datos ni de API.

**Explícitamente fuera de alcance:**
- No se toca cómo se crean/dividen las cuotas (`dividirEnCuotasPUT`), ni el PDF.
- No se agrega un id de grupo en la base de datos — el agrupamiento se arma en el cliente a
  partir de `numero_oc`/`numero_oc_acquisys` (sufijo `-N`) igual que ya hacía el cálculo de
  `monto_neto_grupo`/`pendiente_calc`.
- No se corrige la fórmula existente de `pendiente_calc` (es secuencial, no depende del estado
  real de cada cuota) — en la fila resumen del grupo simplemente se oculta ("—") en vez de
  mostrar un número que podría confundir.

## Cambio 1 — Orden por N° de OC (reemplaza orden por fecha)

`ordenesConVisible` pasa a ordenar por `numero_oc_base` descendente (el N° de OC visible, sin el
sufijo de cuota) y, dentro de un mismo grupo, por `cuota_numero` ascendente. Aplica siempre,
haya o no agrupación activa.

## Cambio 2 — Fila resumen colapsada + columna "Detalles"

Nueva columna "Detalles" entre "N° OC" y "Fecha": solo las OC con cuotas muestran un botón
▸/▾. Por defecto el grupo está colapsado y se ve como **una sola fila**:

- N° OC: el número base (sin sufijo), reutilizando el mismo render que hoy (link al PDF de la
  cuota 1 + subtexto con el número interno si viene de Acquisys).
- Cotiz. / Respaldo / Fecha / Proveedor / Usuario: se toman de la cuota 1 (son campos
  compartidos por todas las cuotas desde que se crean, ver Cambio 2 del spec de cuotas).
- N° HES: se concatenan los HES de todas las cuotas (ya existe el render que muestra un
  desplegable cuando hay más de uno separado por coma — se reutiliza sin cambios).
- Monto Neto: ya es el total del grupo (`monto_neto_grupo`, sin cambios).
- Monto Cuota / N° Factura / Comprobante / Pendiente: "—" (no hay un solo valor que represente
  al grupo completo).
- Estado: texto tipo "3 Facturadas · 2 Pendiente aprobación · 1 Aprobada" en vez de un solo
  pill (opción elegida por el usuario sobre puntos de color o barra de progreso).
- Acción / Editar / Borrar: deshabilitadas ("Expandir para gestionar" / nada) — cada cuota se
  gestiona individualmente, nunca como grupo.

Al expandir (clic en ▸) se insertan debajo las N filas individuales tal como se ven hoy, con
una marca "↳" en la columna Detalles para distinguirlas visualmente del resto.

## Cambio 3 — Búsqueda y filtro del Dashboard desactivan la agrupación

Si hay texto en el buscador de la tabla o viene un filtro de categoría desde el Dashboard (clic
en una tarjeta), se muestran las filas individuales que calzan, sin agrupar — si se está
buscando algo puntual se quiere ver la fila exacta, no expandir un grupo para encontrarla. El
estado de búsqueda se sube de `DataTable` (que hasta ahora lo manejaba internamente) a
`OrdenesList` mediante props opcionales `searchValue`/`onSearchChange`, sin romper los otros 4
usos existentes de `DataTable` (que siguen sin pasarlas y se comportan igual que antes).

## Cambio 4 — Orden de columna deshabilitado mientras se agrupa

Con la agrupación activa, el clic en los encabezados de columna para ordenar se deshabilita
(`sortable: false` en todas) para no romper el orden fijo por N° de OC. Al activarse un filtro
o búsqueda (agrupación desactivada), el orden por columna vuelve a funcionar igual que hoy.

## Fuera de alcance / decisiones explícitas

- No se agrega un atajo de "próxima acción" (ej. "Falta aprobar cuota 4") en la fila resumen —
  el usuario eligió el indicador de texto simple; para actuar sobre una cuota puntual hay que
  expandir el grupo.
- `documentos_respaldo` en la fila resumen muestra el valor de la cuota 1 (puede no reflejar
  documentos subidos a otras cuotas del grupo) — limitación preexistente, no introducida por
  este cambio.
