# Menú "Proyectos" — Fase 1: ficha de proyecto + Órdenes de Trabajo (OT)

Fecha: 2026-10-08

## Contexto

Hoy conviven dos conceptos de "proyecto" sin relación entre sí:

- El catálogo `proyectos` (Remodelación El Cortijo, Glamping Refugio,
  Contenedor...) que se elige al crear una OC (`ordenes_compra.proyecto_id`)
  y que además define el acceso restringido de usuarios externos.
- La bitácora `seguimiento_proyectos` del menú "Proyectos" (reemplazo del
  grupo de WhatsApp), diseñada a propósito sin relación con lo anterior
  (spec 2026-10-01-seguimiento-proyectos).

Se pide un seguimiento de proyectos "profesional" (quién solicita, lugar,
presupuesto, avance, fechas, quién ejecuta). Se decide **unificar**: el
catálogo `proyectos` pasa a ser la ficha completa del proyecto, y la
bitácora se absorbe como Órdenes de Trabajo dentro de los proyectos.

## Decisiones (confirmadas con el usuario)

1. **Solo se trabaja en el menú Proyectos.** Nueva OC, Órdenes, Dashboard,
   Reportes y Administración no se modifican.
2. Acceso: solo personal `@patagonica.cl` (igual que la bitácora actual).
3. **Sin aprobaciones propias**: la aprobación de gasto ya ocurre en la OC;
   el módulo solo hace seguimiento.
4. **Presupuesto en UF como unidad principal**; los montos CLP se muestran
   como equivalente. Las OC en CLP se convierten a UF con el valor UF de la
   fecha de la OC (mindicador.cl, cacheado en tabla `uf_diaria`).
5. **Ejecutor contratista obligatoriamente del catálogo de proveedores.**
   Ejecutor interno = texto libre (persona/cuadrilla).
6. Cada empresa tiene un proyecto permanente **"Mantención General"** (nuevo,
   aparte de "Contenedor", que queda intacto). Aparece también en el
   desplegable de Nueva OC — aceptado.
7. Todo proyecto creado desde el menú Proyectos entra al catálogo y por lo
   tanto aparece en Nueva OC — es justamente la unificación, aceptado.
8. **Regla proyecto vs OT**: si tiene presupuesto propio, OC asociadas o un
   contratista → proyecto. Si no → OT dentro de un proyecto (las sueltas,
   dentro de Mantención General).

## Códigos

Correlativo por empresa, generado en la base (atómico, igual que OC/HES):

| Qué | Formato | Ejemplo |
|---|---|---|
| Proyecto | `{codigo_empresa}-PRY-{nnn}` | `PA-PRY-001` |
| Orden de Trabajo | `{codigo_empresa}-OT-{nnnnn}` | `PA-OT-00001` |

Se asignan por trigger `before insert` cuando `codigo` viene nulo, así un
proyecto creado desde Nueva OC (api/proyectos.js, que no se toca) también
recibe su código. "Contenedor" no recibe código (no es un proyecto real) y
no se muestra en el menú Proyectos.

## Modelo de datos

### `proyectos` (solo columnas nuevas, todas nullable o con default)

`codigo`, `tipo` (Obra / Mantención / Habilitación / TI / Otro),
`prioridad` (Alta / Media / Baja), `descripcion`, `ubicacion`,
`solicitante` (texto libre — puede ser alguien sin usuario),
`jefe_proyecto` (correo de un usuario @patagonica activo),
`ejecutor_tipo` (interno / contratista), `ejecutor_proveedor_id` (FK
proveedores), `ejecutor_interno` (texto), `presupuesto_uf`,
`fecha_inicio_plan`, `fecha_termino_plan`, `fecha_inicio_real`,
`fecha_termino_real`, `estado_proyecto` (Planificado / En ejecución /
Pausado / En recepción / Cerrado / Cancelado), `avance_pct` (0–100),
`es_permanente`, `creado_por_usuario`, `updated_at`.

Check: `ejecutor_tipo = 'contratista'` exige `ejecutor_proveedor_id`.

### `proyecto_ot` (nueva)

`id`, `proyecto_id`, `empresa_id`, `codigo`, `descripcion`, `ubicacion`,
`responsable`, `ejecutor_tipo`, `ejecutor_proveedor_id`, `ejecutor_interno`,
`fecha_inicio`, `fecha_limite`, `fecha_culminacion`, `estado` (Pendiente /
En ejecución / Terminada / Cancelada), `creado_por_usuario`, `created_at`,
`updated_at`, `activo`, `eliminado_por`, `eliminado_en`,
`origen_seguimiento_id` (trazabilidad de la migración).

### `proyecto_bitacora` (nueva, solo-agregar)

`id`, `proyecto_id`, `ot_id` (nullable), `tipo` (comentario / sistema),
`texto`, `usuario`, `created_at`. Los cambios de estado y de % de avance se
registran solos como `sistema` ("Avance 40% → 55%").

### `contadores_proyecto` y `uf_diaria` (nuevas, internas)

RLS activado en todas las tablas nuevas, sin políticas (la API usa service
role).

## Migración de datos

- Códigos `PRY` a los proyectos existentes (sin Contenedor), por fecha de
  creación; estado inicial "En ejecución".
- "Mantención General" por empresa (`es_permanente = true`).
- Las 3 entradas activas de `seguimiento_proyectos` → OT de Mantención
  General de Patagónica (`PA-OT-00001..3`), con sus comentarios → bitácora.
- `seguimiento_proyectos*` **no se borran**: quedan como respaldo de solo
  lectura (la API deja de usarlas).

## Dinero (automático desde OC, solo filas `activo = true`)

Sobre `monto_neto` (sin IVA, la empresa lo recupera):

- **Comprometido** = OC en cualquier estado excepto Borrador, Pendiente
  aprobación/Pendiente, Anulado, Rechazado.
- **Facturado** = Facturada, Factura Pendiente de Aprobación, Factura
  Aprobada, Completada, Proceso de Pago, Pagado.
- **Por aprobar** = Pendiente aprobación (informativo, no suma).
- **Saldo** = presupuesto − comprometido. Alerta ámbar ≥ 80 %, roja ≥ 100 %.

Cada cuota es una fila de OC independiente, así que se suman tal cual.

## API — `api/proyectos-seguimiento.js` (se reescribe; mismo archivo)

- `GET ?empresa_id=N` → cartera con resumen financiero y conteo de OT.
- `GET ?id=X` → ficha: proyecto + OT + bitácora + OC (con monto en UF).
- `GET ?usuarios=1` → usuarios @patagonica activos (para Jefe de proyecto).
- `POST` crea proyecto · `PUT ?id=X` actualiza · `DELETE ?id=X` (solo si
  no tiene OC y no es permanente).
- `POST ?ot=1` · `PUT ?ot_id=X` · `DELETE ?ot_id=X` (soft).
- `POST ?bitacora=1` agrega comentario (proyecto u OT).

## Frontend — menú Proyectos

1. **Cartera**: tabla (Código, Proyecto, Ejecutor, Jefe, Presupuesto UF,
   Comprometido con barra %, Avance %, Término plan, Estado, OT abiertas),
   filtro Activos / Cerrados / Todos, botón "+ Nuevo Proyecto".
2. **Ficha** (clic en una fila) con pestañas: Resumen (formulario editable
   + franja de KPIs financieros) · Órdenes de Trabajo · OC vinculadas (solo
   lectura) · Bitácora.

## Fuera de alcance (fases siguientes)

Hitos ponderados con avance calculado, semáforo plazo vs avance, dashboard
gerencial, informe PDF, adjuntos/fotos, notificaciones por correo, vincular
OC con OT (requiere tocar Nueva OC).
