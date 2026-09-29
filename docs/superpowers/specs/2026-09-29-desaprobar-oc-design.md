# Desaprobar una OC ya Aprobada

Fecha: 2026-09-29

## Contexto y problema

Hoy, una vez que una OC pasa a `"Aprobada"`, ningún campo de datos (proveedor,
título, monto, etc.) se puede volver a editar — el PUT lo bloquea explícitamente
(`CAMPOS_SOLO_ANTES_DE_APROBAR` en `api/ordenes.js`). Si se aprobó con un error
(ej. monto mal ingresado), hoy no hay forma de corregirla sin anularla y crear
una OC nueva (con un N° de OC y HES distintos, lo cual no siempre es aceptable
administrativamente).

Se pide poder "desaprobar" una OC (volverla a `"Pendiente aprobación"`) para
poder corregirla y volver a aprobarla, **manteniendo el mismo N° de OC y el
mismo N° de HES** — como si nunca se hubiera revertido.

## Alcance

**Incluido:** OC nativas de OCFast en estado `"Aprobada"`.

**Explícitamente fuera de alcance:**
- No se permite desaprobar una OC que ya pasó a `"Facturada"` o `"Completada"`
  — en esos estados solo cabe Anular (ya existe, no se toca).
- No se agrega un campo de motivo/nota al desaprobar (confirmación simple,
  igual que el botón Eliminar existente).
- No se agrega un campo `aprobado_por` — el permiso para desaprobar es el
  mismo `nivel_aprobacion === 1` que ya se exige para aprobar, sin registrar
  quién aprobó originalmente.
- No se restringe quién puede editar una OC devuelta a Pendiente — ya hoy
  cualquier usuario con acceso a la app puede editar cualquier OC en Borrador
  o Pendiente aprobación (no hay ni había restricción por "quién la creó").

## Cambio 1 — Backend: permitir y validar la transición Aprobada → Pendiente aprobación

Hoy nada en `api/ordenes.js` impide (ni exige permiso) revertir el estado de
una OC ya aprobada — un PUT plano con `{estado: "Pendiente aprobación"}` no
dispara ningún chequeo, porque `CAMPOS_SOLO_ANTES_DE_APROBAR` solo mira los
campos de DATOS, no el campo `estado` en sí.

Se agrega un bloque nuevo (junto al que ya existe para `estado === "Aprobada"`)
que, cuando se pide pasar a `"Pendiente aprobación"`:
- Si la fila está actualmente en `"Aprobada"`: exige `session.nivel_aprobacion
  === 1` (el mismo permiso que aprobar) — si no, 403.
- Si la fila está en `"Facturada"` o `"Completada"`: rechaza con 403 siempre
  (no se puede devolver a Pendiente en esos estados).
- Si la fila ya está en `"Borrador"` o `"Pendiente aprobación"`: no hace nada
  especial (caso benigno, ya funciona así hoy).

No se toca `numero_oc` ni `numero_hes` en esta transición — quedan tal cual
estaban.

## Cambio 2 — Frontend: botón "Desaprobar"

En el listado de Órdenes, para una OC en `"Aprobada"`, junto al botón
"Facturar" ya existente, se agrega un botón "Desaprobar" (visible solo si
`puedeAprobar`, es decir `currentUser.nivel_aprobacion === 1` — el mismo
chequeo que ya se usa para mostrar "Aprobar"). Al hacer clic: confirmación
simple (`window.confirm`, mismo patrón que Eliminar) y luego un PUT directo
con `{estado: "Pendiente aprobación"}`, sin modal ni campos adicionales.

Una vez revertida, el botón ✏️ Editar ya aparece solo (su condición actual,
`["Borrador", "Pendiente aprobación"].includes(o.estado)`, ya cubre este caso
— no requiere cambios).

## Cambio 3 — Frontend: re-aprobar sin generar código nuevo

En `OrdenAccionModal.submit()` (rama `isAprobar`), antes de pedir un HES
nuevo vía el endpoint `siguiente_hes`, se revisa si la OC ya trae un
`numero_hes` (quedó guardado en la fila al desaprobar, nunca se borra) — si
existe, se reutiliza tal cual; si no (primera aprobación), se pide uno nuevo
como hoy. El resto del flujo de aprobación (regenerar PDF con ese HES,
subirlo, guardar `archivo_oc_url`, enviar el correo de aprobación al
proveedor) queda exactamente igual — no requiere cambios, ya es genérico para
cualquier transición a `"Aprobada"`.
