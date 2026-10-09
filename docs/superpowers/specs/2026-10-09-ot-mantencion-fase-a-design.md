# Menú "OT Mantención" — Fase A: catálogo, ciclo de vida de la OT y Mesa de control

Fecha: 2026-10-09

## Contexto

El usuario trae un spec completo de "Operaciones Patagónica" (`operaciones-patagonica-spec-beta.md`,
provisto por el usuario, fuera del repo): un sistema de **tickets de mantención reactiva** para
arrendatarios de Patagónica Inmobiliaria (goteras, cortes de luz, portones, etc.), con ingesta de
correo + IA, SLA, fichas de inmueble/cliente/contrato, Modo Evento y reportes.

Se pidió tratar esto como la "Fase 2" del menú Proyectos, pero son dos problemas de negocio
distintos: Proyectos (ya construido, Fase 1) hace seguimiento de **proyectos de capital**
(remodelaciones, con presupuesto en UF y gasto tomado de OC); este spec es sobre **mantención
reactiva de arriendo** (tickets de arrendatarios). El usuario confirmó construirlo igual dentro de
OCFast, como su propio menú nuevo ("OT Mantención"), no como parte de Proyectos.

El spec completo es muy grande (ingesta de correo con IA, SLA, Modo Evento, fichas, reportes,
vista móvil). Esta Fase A cubre la base: catálogo, la OT con su ciclo de vida completo y la Mesa
de control — **sin correo ni IA todavía** (eso es Fase B).

## Decisiones confirmadas con el usuario

### Nomenclatura (colisión de "OT" resuelta)

Había colisión: en Proyectos, "OT" = el código del proyecto de capital (`OTPA-001`). En el spec
nuevo, "OT" = un ticket de mantención — que es como se le llama realmente en el rubro. Se decide:

- **OT queda libre para los tickets de mantención** (el uso real/natural del término).
- El código de **proyecto de capital se renombra**: `{empresa}-OT-{n}` → `{empresa}-PRY-{n}`
  (ej. `OTPA-001` → `PA-PRY-001`; Tarea `OTPA-001-02` → `PA-PRY-001-02`). Requiere tocar la
  migración de triggers de Fase 1 de Proyectos (`docs/migrations/2026-10-09-codigo-ot-sigla.sql`)
  y el código ya desplegado (`ProyectosPage`/`ProyectoFicha`/`OtModal`, `api/proyectos-seguimiento.js`).
- **OT de mantención**: `OT-{n}`, correlativo **global** (todas las empresas), **sin año y sin
  prefijo de empresa** (ej. `OT-0034`) — a propósito distinto en forma de `{empresa}-OC-{n}` (las
  Órdenes de Compra), para que nunca se confundan por una sola letra (OC vs OT) cuando aparecen
  juntas (una OT de mantención puede generar una OC).
- Las 3 familias de código conviven así: `PA-OC-00331` (OC) · `PA-PRY-001` (proyecto de capital)
  · `OT-0034` (OT de mantención).

### Alcance multiempresa

El catálogo (sitios, edificios, unidades, clientes, contratos) nace con `empresa_id` en las 3
empresas desde el inicio, aunque hoy la data real sea solo de Patagónica/El Cortijo.

### Reutilización de catálogos existentes

- **Proveedores**: se usa la tabla `proveedores` que ya existe (compartida con OC y con el
  ejecutor contratista de Proyectos) — se le agrega el campo `rubro` (techumbres, electricidad,
  gasfitería, etc.). No se crea un catálogo de proveedores aparte.
- **Persona/técnico**: se usa la tabla `usuarios` que ya existe (login con correo @patagonica.cl)
  — se le agrega `rol_operaciones` (Coordinador / Técnico / Administración / Gerencia) y
  `especialidad` (electricidad, gasfitería, general), análogo a `nivel_aprobacion`. No se crea un
  catálogo de personas aparte ni un sistema de cuentas paralelo.

### Carga inicial del catálogo de clientes

El catálogo de Clientes/Sitios se puede **importar inicialmente desde la Planilla de Facturación**
(Google Sheets, columnas Sitio/Cliente/Correo/...) en vez de tipear ~107 clientes a mano — mismo
patrón de integración que ya usa la app de facturación (`facturacion-patagonica`). Los campos
(RUT, dominios de correo, código de sitio) quedan compatibles para cuando la Fase B necesite
identificar al remitente de un correo automáticamente. **Alcance de esta fase: import puntual, NO
sincronización automática continua** — eso se evalúa en Fase B junto con el resto del pipeline de
correo.

### Fase A explícitamente NO incluye

Ingesta de correo entrante, clasificación con IA, Modo Evento, reportes (semanal/gerencial),
notificaciones por correo, vista móvil "Mi trabajo", mapa esquemático. Todo eso queda para fases
siguientes (B, C...).

### Simplificación: sin tabla "Incidencia" separada todavía

El spec separa "Incidencia" (lo reportado) de "OT" (el trabajo), para poder agrupar varios
reportes duplicados en una sola OT vía detección automática. Como la detección de duplicados
requiere IA/correo (Fase B), en esta fase el reporte inicial (quién, cuándo, descripción) vive
directo en la OT; un segundo reporte del mismo problema se agrega a mano como comentario en la
bitácora y el cliente se suma a "afectados". La tabla `incidencia` se formaliza recién en Fase B.

## Modelo de datos

### Catálogo de ubicaciones

- **`sitio`**: `codigo`, `nombre`, `direccion`, `empresa_id`, `rol_sii`, `superficie_terreno_m2`.
- **`edificio`**: `codigo`, `nombre`, `sitio_id`, `direccion`, `pisos`, `alias` (text[] — clave
  para que más adelante la IA/matching reconozca la ubicación en un correo informal).
- **`unidad`**: `codigo` (`{sitio}-{edificio}-{unidad}`), `nombre`, `tipo` (Bodega / Oficina /
  Local comercial / Espacio-terreno / Estacionamiento / Antena-uso técnico), `edificio_id`,
  `sitio_id`, `piso`, `superficie_m2`, `estado` (Ocupada / Vacante / En remodelación / De baja),
  `alias` (text[]), `vigente_desde`/`vigente_hasta`, `unidades_origen` (uuid[] — fusión/subdivisión),
  `plano_url`.
- **`area_comun`**: `codigo`, `nombre`, `sitio_id`/`edificio_id`, `unidades_que_atiende` (uuid[]),
  `alias` (text[]).

### Cliente / Contrato

- **`cliente_operaciones`**: `rut`, `razon_social`, `nombre_fantasia`, `giro`, `dominios_correo`
  (text[] — excluye gmail.com/hotmail.com/similares), `estado` (Activo / Ex-cliente / Prospecto),
  `notas`. (Nombre `cliente_operaciones`, no `cliente`, para no chocar con ningún concepto
  existente de OCFast.)
- **`contacto_operaciones`**: `cliente_id`, `nombre`, `cargo`, `correo`, `telefono`, `rol`
  (Operaciones-mantención / Facturación / Emergencias / Representante legal / Gerencia, puede ser
  más de uno), `principal_operaciones` (bool).
- **`contrato_operaciones`**: `codigo` (`CT-0001`), `cliente_id`, fechas inicio/término, `estado`
  calculado (Vigente / Por vencer ≤6 meses / Terminado), `renta_uf`, `gastos_comunes_uf`,
  `garantia_tipo`/`monto`/`vencimiento`, `seguro_arrendatario_vencimiento`,
  `clausula_mantencion` (texto — quién paga qué reparaciones), `sla_contractual`,
  `horario_acceso`, `uso_compartido` (bool). Tabla puente `contrato_unidad` (`contrato_id`,
  `unidad_id`, `desde`, `hasta`). Regla: una unidad tiene **un solo contrato vigente** a la vez,
  salvo `uso_compartido = true`.

### La OT

- **`ot_mantencion`**: `codigo` (`OT-{n}`), `titulo`, `resumen`, `elemento_afectado` (texto con
  autocompletado — detecta recurrencias), `categoria`/`subcategoria` (catálogo de la tabla 4.11
  del spec: Techumbre y filtraciones, Eléctrico, Agua y sanitario, Accesos y seguridad,
  Ascensores, Obra civil, Climatización, Incendio y emergencias, Áreas comunes y aseo, Plagas,
  Solicitud de servicio, Reclamo de convivencia — cada una con prioridad base y cargo sugeridos),
  `ubicacion_principal_tipo`/`id` (unidad / edificio / sitio / área común),
  `ubicaciones_adicionales` (uuid[]), `clientes_afectados` (uuid[] — snapshot),
  `contratos_afectados` (uuid[] — snapshot), `impacto` (Seguridad de personas / Operación
  detenida / Operación afectada / Sin impacto operativo), `urgencia` (En curso / Estable),
  `prioridad` (P1–P4, calculada por la matriz impacto×urgencia — sección 7.1 del spec),
  `prioridad_motivo_cambio` (obligatorio si alguien la corrige a mano), `estado` (Nueva / Asignada
  / En curso / En espera / Resuelta / Cerrada / Anulada), `motivo_espera` (Proveedor / Materiales
  / Cotización / Aprobación de gasto / Acceso del cliente / Clima), `responsable_id` (FK
  `usuarios`), `ejecutor_tipo` (interno/proveedor), `ejecutor_proveedor_id` (FK `proveedores`),
  `ejecutor_interno` (texto), `fecha_limite_respuesta`/`fecha_limite_solucion` (calculadas según
  SLA de la tabla 7.2 + horario hábil lun-vie 8:30-18:00), `contencion_realizada` (fecha-hora,
  solo P1), `fecha_asignacion`/`inicio`/`resolucion`/`cierre`, `solucion` (texto, obligatorio
  para Resolver), `costo_estimado`/`costo_real` (CLP, suma de `ot_costo`), `cargo` (Arrendador /
  Arrendatario / Compartido-% / Seguro / Garantía / Por definir), `recuperable_monto`,
  `aprobacion_gasto_usuario`/`fecha` (si `costo_estimado` supera umbral configurable, default
  $500.000 — en esta fase se aprueba manualmente en la app, sin correo automático),
  `reaperturas` (int), `etiquetas` (text[]), `reportado_por`/`fecha_reporte`/
  `descripcion_original` (reemplaza la tabla `incidencia` separada por ahora), `creado_por_usuario`,
  `activo`, `eliminado_por`, `eliminado_en`.
- **`ot_tarea`**: `ot_id`, `descripcion`, `responsable_id`, `estado` (pendiente/hecha), `fecha`.
- **`ot_evidencia`**: `ot_id`, `archivo_url`, `tipo` (antes/durante/después/documento/factura),
  `autor_usuario`, `fecha`.
- **`ot_costo`**: `ot_id`, `concepto` (materiales/mano de obra/proveedor/otro), `monto_clp`,
  `proveedor_id`, `numero_factura_boleta`, `fecha`.
- **`ot_bitacora`**: mismo patrón que `proyecto_bitacora` — `ot_id`, `tipo` (comentario/sistema),
  `texto`, `usuario`, `created_at`. Cambios de estado/reasignación se registran solos como
  `sistema`.

### Reglas de vinculación automática (R1–R9, iguales con registro manual o — más adelante — correo)

1. Toda OT tiene una ubicación principal obligatoria.
2. Cliente y contrato **se derivan solos** de la ubicación + fecha del reporte (contrato vigente
   en esa unidad en esa fecha) — nunca se escriben a mano.
3. Si la ubicación es edificio/sitio/área común, se sugieren todos los clientes con contrato
   vigente en las unidades contenidas/atendidas; el coordinador desmarca los que no corresponden.
4. Unidad vacante → OT sin cliente, marcada "Vacante", cargo sugerido Arrendador.
5. Cliente y contrato quedan de **snapshot** al crear la OT — no cambian si después cambia el
   arrendatario (corrección manual queda en la bitácora).
6. Si el reportante no es contacto del arrendatario de la unidad, aviso "Reportante no es el
   arrendatario" (válido, pero se revisa).
7. Cada entrada de bitácora se guarda una vez, con todos sus vínculos.
8. Unidad fusionada/subdividida: la nueva muestra el historial de sus unidades de origen en
   "Historial heredado", separado del propio.
9. Al terminar un contrato, su historial queda en cliente/contrato; en la unidad aparece bajo
   "Arrendatarios anteriores", nunca mezclado con el arrendatario actual.

## Ciclo de vida de la OT

```
Nueva → Asignada → En curso → Resuelta → Cerrada
                      ↕
                  En espera
Cualquier estado abierto → Anulada
Resuelta → En curso (si el problema persiste antes del cierre)
Cerrada → En curso (reapertura, dentro de 30 días)
```

Reglas: no se puede pasar a Asignada sin responsable, a Resuelta sin `solucion` (+ 1 foto
"después" si P1/P2), ni a Cerrada sin `costo_real` (puede ser $0) y `cargo` definido. El reloj de
SLA se pausa **solo** con espera por *Acceso del cliente* o *Clima* (las demás esperas no, porque
dependen de nosotros). Reapertura: mismo problema (ubicación + categoría + elemento) dentro de 30
días del cierre → se propone reabrir en vez de crear una OT nueva, suma 1 a `reaperturas`.

## Priorización (sin IA — la persona que registra elige impacto/urgencia)

Matriz impacto × urgencia (sección 7.1 del spec) → P1–P4. Puntaje para ordenar dentro de cada
prioridad (sección 7.3): alcance, clientes afectados adicionales, daño en curso, recurrencia,
antigüedad, SLA vencido, contrato por vencer. Cambiar la prioridad exige un motivo de una línea.

## Pantallas

1. **Mesa de control** (layout validado con el usuario vía maqueta visual): fila de indicadores
   (P1/P2 abiertas, sin asignar, SLA vencido, en espera +3d, resueltas hoy), cola priorizada con
   filtros rápidos, **panel lateral fijo** con la "foto actual" (estado/responsable/afectados +
   acciones rápidas) al hacer clic en una fila, y **fila expandible** (ícono ▸/▾) aparte para la
   **bitácora completa** (fecha+hora por entrada, quién la escribió, con scroll propio — no
   empuja el resto de la tabla; puede extenderse por días/semanas a medida avanza la OT). Mismo
   patrón ya usado para las cuotas en el listado de Órdenes de Compra.
2. **Registro rápido** (formulario de 30 segundos, reemplaza el ingreso por correo en esta fase):
   ubicación (autocompletar por alias), qué pasa, foto opcional, ¿es urgente?
3. **Ficha de OT**: encabezado (código, prioridad+motivo, estado, SLA, responsable, botones de
   transición válidos), bloque de vínculos (ubicación, clientes/contratos afectados, avisos de
   recurrencia / reportante-no-arrendatario), pestañas: Resumen, Línea de tiempo, Evidencias
   (antes/durante/después), Costos y cargo, Historial del lugar (últimas 10 OT de esa ubicación).
4. **Ficha de inmueble** (unidad/edificio/área común): encabezado + arrendatario actual,
   indicadores (OT abiertas, OT últimos 12 meses, costo de mantención, recurrencias), pestañas:
   línea de tiempo, OT, arrendatarios (actual vs. anteriores, separados), documentos, historial
   heredado (si viene de fusión).
5. **Ficha de cliente**: encabezado, indicadores (contratos vigentes, OT 12 meses, % SLA
   cumplido, riesgo de renovación — contrato vence ≤6 meses + 3+ OT P1/P2 o 2+ SLA incumplidos en
   12 meses), pestañas: línea de tiempo, contratos, inmuebles, OT, cargos por recuperar, contactos.
6. **Ficha de contrato**: encabezado (vigencia, garantía, seguro), condiciones operativas,
   pestañas: OT durante el contrato, línea de tiempo, cargos por recuperar, documentos,
   liquidación operativa (si terminado/por vencer).

## Roles

Reutiliza `usuarios` + `rol_operaciones` (análogo a `nivel_aprobacion`): Coordinador (gestiona
todo), Técnico (solo ve/actúa sobre sus OT asignadas), Administración (cierra OT y define cargo),
Gerencia (solo lectura + aprueba gastos sobre el umbral).

## Fuera de alcance de esta fase (confirmado con el usuario)

Ingesta de correo entrante y clasificación con IA, Modo Evento, reportes (semanal/gerencial),
notificaciones automáticas por correo, vista móvil "Mi trabajo", mapa esquemático. Candidatas a
Fase B / C, en ese orden aproximado.
