# Detalle de montos al facturar (UF / Neto / Total) + reordenar el cuadro

Fecha: 2026-10-01

## Contexto

El cuadro "Facturar OC" (`OrdenAccionModal`, `tipo: "facturar"`) hoy muestra
un solo campo "Monto Facturado" sin formato (ej. `7328710` en vez de
`$7.328.710`), y el orden actual pone el N° Factura y el monto ANTES que la
zona de subir el archivo. Se pide:

1. Mostrar el detalle completo de montos leídos de la factura (Monto UF
   cuando aplica, Monto Neto en pesos, Monto Total Facturado en pesos), cada
   uno con su versión formateada ($ con separador de miles, o "UF X,XX").
2. Que la zona de subir el archivo de la factura quede primero en el cuadro.
3. Guardar los 3 montos de forma permanente (no solo el total, como hoy).

## Cambio 1 — Dos columnas nuevas en `ordenes_compra`

```sql
alter table ordenes_compra add column monto_facturado_neto numeric;
alter table ordenes_compra add column monto_facturado_uf numeric;
```

`monto_facturado` (ya existente) sigue siendo el total en pesos — sin
cambios de significado. Las dos columnas nuevas son opcionales (`null` si
no se llenan, igual que `monto_facturado` hoy).

## Cambio 2 — Backend: aceptar los 2 campos nuevos en el PUT

En `api/ordenes.js`, junto al manejo ya existente de `monto_facturado`,
aceptar `monto_facturado_neto` y `monto_facturado_uf` con el mismo patrón
genérico (`if (body.x !== undefined) fields.x = body.x;`) que ya usa el
resto de los campos de este handler.

## Cambio 3 — Frontend: reordenar y agregar los campos

En `OrdenAccionModal` (sección `isFacturar`):

- El bloque de subir archivo ("Factura (PDF/imagen)" + zona de arrastrar +
  el spinner de verificación) pasa a ir **primero**, antes de "N° Factura".
- Nuevo campo **"Monto UF"** — solo visible si `orden.moneda === "UF"` — se
  autocompleta con `datos.monto_neto_uf` (ya se extrae con IA desde la
  tarea anterior), editable.
- Nuevo campo **"Monto Neto ($)"** — se autocompleta con `datos.monto_neto`,
  editable.
- Campo existente renombrado a **"Monto Total Facturado ($)"** (antes
  "Monto Facturado") — mismo campo/estado de siempre, solo cambia la
  etiqueta.
- Cada uno de los 3 campos muestra, debajo del input, el valor formateado
  (`fmtMoney` para pesos, `fmtMontoMoneda(v, "UF")` para UF) cuando tiene un
  valor — el input en sí sigue siendo `type="number"` (sin cambios de
  comportamiento al tipear), el formato es solo una vista de apoyo debajo.
- Al confirmar, se guardan los 3 valores (`monto_facturado`,
  `monto_facturado_neto`, `monto_facturado_uf` — este último solo si
  `orden.moneda === "UF"`, si no, se manda `null`).

## Fuera de alcance

- No se muestra este detalle en el listado de Órdenes ni en los reportes
  exportados — solo en el cuadro de Facturar, como se pidió.
- No se agrega una "cuenta regresiva" ni validación cruzada extra entre los
  3 montos nuevos (ej. verificar que Neto + algo = Total) — son 3 campos
  independientes, cada uno editable por su cuenta, igual que hoy el único
  campo de monto.
