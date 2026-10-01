# Verificar factura en pesos contra una OC en UF

Fecha: 2026-10-01

## Contexto y problema

Al subir una factura para facturar una OC, `verificarFactura` (en
`OrdenAccionModal`) ya lee el documento con IA y compara RUT/moneda/monto
contra la OC. Esto funciona bien cuando ambos documentos están en la misma
moneda, pero **las facturas electrónicas chilenas (SII) siempre emiten sus
totales en pesos**, incluso cuando la OC/contrato está denominado en UF — el
valor en UF se expresa solo en la línea de detalle (columna "Cantidad" con
unidad "UF", precio unitario = valor de la UF del día, valor = cantidad ×
precio en pesos).

Hoy, al subir una factura así contra una OC en UF, la verificación compara
`datos.monto_total` (en pesos) contra `orden.monto_total` (en UF) sin
convertir — y marca `moneda`/`monto` como "no coincide" siempre, aunque la
factura sea perfectamente correcta. Esto bloquea la facturación (caso real
probado: OC-00236-3, factura N°211 de INMOBILIARIA CRISAL, 150 UF netos que
sí coinciden exactamente con los 150 UF netos de esa cuota).

Además, se pide verificar que la factura esté dirigida a la empresa correcta
(RUT del receptor, no solo el del proveedor/emisor), y mejorar la UX del
campo N° Factura para que no parezca que hay que llenarlo a mano cuando la
IA ya lo completa sola.

## Cambio 1 — Extraer también el RUT del receptor y el monto neto en UF

En `api/extraer-factura.js`, agregar dos campos al schema de extracción:
- `receptor_rut`: RUT del RECEPTOR/cliente (bajo "Señor(es):"/"Para:"/
  "Cliente:" — el opuesto al `proveedor_rut`, que ya se extrae del emisor).
- `monto_neto_uf`: si el detalle de la factura muestra una cantidad
  expresada en UF (ej. columna "Cantidad" = "150 UF", con un precio unitario
  que es el valor de la UF del día), el monto neto en UF (ej. `150`). Si el
  documento no está denominado en UF o no se indica, `null`.

Ninguno de los dos es obligatorio (`required` sigue siendo solo
`monto_total`, como hoy) — si la IA no los encuentra, quedan en `null`/vacío
y el resto del flujo sigue igual.

## Cambio 2 — Verificación cruzada en `verificarFactura`

En `index.html` (`OrdenAccionModal`):

- **RUT del receptor:** si `datos.receptor_rut` y `empresa.rut` existen y no
  coinciden (misma normalización que ya se usa para `proveedor_rut`), se
  agrega un problema a la lista ("el RUT del receptor en la factura no
  corresponde a [nombre de la empresa]").
- **Monto en UF:** si `orden.moneda === "UF"` y la IA extrajo un
  `monto_neto_uf` (no nulo), se compara ese valor contra `orden.monto_neto`
  (ambos en UF, neto contra neto — no contra el total, porque el IVA/total
  de la OC en UF asume un valor de UF que no necesariamente coincide con el
  de la fecha real de la factura; neto-a-neto es inmune a esa variación), con
  la misma tolerancia relativa (1%) que ya se usa para el monto total. En
  este caso **se omite el chequeo de "moneda no coincide"** — una factura en
  pesos para una OC en UF es la norma en Chile, no un error.
- **Si la OC no está en UF, o la IA no logra extraer `monto_neto_uf`:** se
  usa exactamente la lógica actual (comparación directa de `moneda` y
  `monto_total`), sin cambios — cero riesgo de regresión para el caso ya
  probado (facturas y OC en pesos).

## Cambio 3 — UX del campo N° Factura

En el campo "N° Factura" del formulario de Facturar, agregar un `placeholder`
tipo "Se completa automáticamente al leer la factura, o ingrésalo a mano"
(mismo patrón ya usado en el campo "N° Cotización" de Nueva OC), para que no
parezca un campo obligatorio de llenado manual.

## Fuera de alcance

- No se agrega una fuente externa de valor de la UF (ej. API del Banco
  Central) — la verificación depende exclusivamente de lo que la propia
  factura exprese en su detalle.
- No se auto-confirma la facturación tras subir el archivo — el usuario
  sigue haciendo clic en "Confirmar" como hoy, solo que con los campos ya
  completados y verificados.
