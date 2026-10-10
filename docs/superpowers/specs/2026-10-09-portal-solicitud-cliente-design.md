# Portal de solicitudes para arrendatarios (piloto)

## Qué es

Vía pública (sin login) para que un arrendatario reporte una incidencia de
mantención y se genere automáticamente una OT en OT Mantención, sin
intervención de nadie de Patagónica. Modo de prueba: corre bajo la cuenta de
amelendez@patagonica.cl mientras se habilita el correo de Operaciones, para
comparar el volumen/calidad de OT creadas por clientes vs. creadas
internamente (Registro rápido).

## Frontend: mini web app en Apps Script

No es un Google Form real -- un Google Form no puede validar el RUT contra
nuestra base y mostrarle un error en pantalla al tiro (su trigger
`onFormSubmit` corre después de que la persona ya vio la pantalla de
"respuesta enviada"). En su lugar: una páginita servida por Apps Script
(`HtmlService`), misma pinta simple, pero el envío llama a una función de
servidor que valida el RUT contra OCFast y muestra el resultado (éxito o
error) sin recargar la página.

Campos: **RUT** (obligatorio), **¿Qué pasa?** (obligatorio, párrafo),
**Categoría** (opcional, mismo catálogo de 13 categorías + Otro),
**Reportado por** (opcional, nombre de contacto).

## Backend: `POST /api/ot-mantencion?solicitud=1`

Nueva rama, sin sesión de OCFast -- se autentica con un token fijo compartido
(`PORTAL_CLIENTE_TOKEN`, header `x-portal-token`) en vez del cookie
`ocsys_token`, ya que quien llama es el script de Apps Script, no un usuario
logeado. Se ubica ANTES del gate `@patagonica.cl` del handler.

Body: `{ rut, titulo, categoria, reportado_por }`.

1. Verifica el token; si falta o no coincide, 401.
2. Normaliza el RUT (saca puntos/guión, mayúsculas) y busca en
   `cliente_operaciones` comparando igual de normalizado.
3. Si no hay cliente, o el cliente no tiene ninguna unidad vigente hoy (vía
   `contrato_unidad`), responde `404 { error: "rut_no_encontrado" }` -- el
   frontend muestra "RUT no encontrado, favor verificar o comunicarte
   directamente con Operaciones." Esto es sencillo, no toca el objetivo de
   comparar canales de creación.
4. Si hay una sola unidad vigente, la usa. Si hay más de una, usa la primera
   y dicho vigente, y deja una nota en bitácora de la OT: "Cliente tiene N
   unidades vigentes -- confirmar cuál corresponde con el contacto" (se
   resuelve a mano desde el Mesa de control, usando el dato de "Reportado
   por" para contactar al arrendatario).
5. Crea la OT con la misma lógica que el Registro rápido interno (impacto
   derivado de categoría, urgencia "Estable" por defecto -- se ajusta a mano
   después, como ya quedó definido), pero:
   - `creado_por_usuario: "amelendez@patagonica.cl"`
   - `origen: "portal_cliente"` (columna nueva, default `'interno'` para
     todo lo existente/Registro rápido) -- para poder comparar después
     cuántas OT entran por cada canal.
   - `reportado_por`: lo que mandó el formulario (o vacío).
   - `descripcion_original`: el texto de "¿Qué pasa?".

## Migración

`alter table ot_mantencion add column if not exists origen text default 'interno';`

## Fuera de alcance (prueba)

Captcha/rate-limiting, verificación por correo del dominio del cliente,
selector de ubicación cuando hay más de una unidad, Google Form real.
