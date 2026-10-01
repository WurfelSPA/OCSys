# Menú "Proyectos" — bitácora de trabajos/tareas con historial de comentarios

Fecha: 2026-10-01

## Contexto

Hoy el equipo informa avances de trabajos en terreno (ej. "sacar palets",
"instalar batea", "mejorar el cierre") por un grupo de WhatsApp — sin
registro estructurado ni forma de sacar después un informe de gestión. Se
pide un menú nuevo, independiente de todo lo demás en la app (incluido el
campo "Proyecto" que ya existe al crear una OC — son conceptos distintos
que comparten nombre por coincidencia).

## Alcance

**Incluido:** un menú "Proyectos" (a la derecha de "Administración") con una
lista de "proyectos/trabajos" por empresa, cada uno con Fecha Inicio,
Descripción, Estado (check Ejecución/Finalizado), Fecha Culminación, y un
historial de comentarios (como un hilo — nunca se sobrescribe, cada nota
queda con fecha y quién la escribió). Crear, editar, comentar, marcar
estado y eliminar: libre para cualquier usuario con sesión, sin restricción
de nivel.

**Explícitamente fuera de alcance (confirmado con el usuario):**
- No se genera el informe de gestión todavía — eso es trabajo futuro. Este
  cambio solo deja la base de datos lista para eso (fechas, estado y
  comentarios con fecha propia, exportables después sin rediseñar nada).
- No hay relación con el catálogo `proyectos` existente (usado en el
  desplegable de Nueva OC) — tablas y menú completamente separados.

## Modelo de datos — 2 tablas nuevas

```sql
create table seguimiento_proyectos (
  id uuid primary key default gen_random_uuid(),
  empresa_id integer references empresas(id),
  descripcion text,
  fecha_inicio date,
  fecha_culminacion date,
  finalizado boolean not null default false,
  creado_por_usuario text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activo boolean not null default true,
  eliminado_por text,
  eliminado_en timestamptz
);

create table seguimiento_proyectos_comentarios (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references seguimiento_proyectos(id) on delete cascade,
  texto text not null,
  usuario text,
  created_at timestamptz not null default now()
);
```

`finalizado` es el check (Estado); `fecha_culminacion` se autocompleta con
la fecha de hoy la primera vez que se marca `finalizado=true` (si el
usuario ya puso una fecha de culminación a mano, esa se respeta y no se
pisa). Los comentarios son estrictamente de solo-agregar — no hay UPDATE ni
DELETE sobre un comentario individual en este alcance.

## API — `api/proyectos-seguimiento.js`

Nuevo archivo (nombre distinto de `api/proyectos.js`, que sigue intacto):
- `GET ?empresa_id=N` → lista de proyectos activos de esa empresa, cada uno
  con su arreglo `seguimiento_proyectos_comentarios` anidado (ordenado del
  más antiguo al más nuevo, para leer el hilo de arriba a abajo).
- `POST` → crea un proyecto nuevo (`descripcion`, `fecha_inicio`,
  `empresa_id` obligatorios), guarda `creado_por_usuario` desde la sesión.
- `POST ?comentario=1` → agrega un comentario (`proyecto_id`, `texto` en el
  body), guarda `usuario` desde la sesión.
- `PUT ?id=X` → actualiza campos (`descripcion`, `fecha_inicio`,
  `fecha_culminacion`, `finalizado`) de forma genérica, con la regla de
  autocompletar `fecha_culminacion` descrita arriba.
- `DELETE ?id=X` → soft-delete (`activo=false`), sin chequeo de nivel
  (libre para cualquier usuario, según lo acordado).

## Frontend — `index.html`

- Nuevo botón de navegación "Proyectos" después de "Administración".
- Nuevo estado a nivel de `App`: `proyectosSeguimiento`/
  `setProyectosSeguimiento` + `loadProyectosSeguimiento` (nombres distintos
  del `proyectos`/`setProyectos` ya existente, que es el catálogo de OC —
  **no reusar ese nombre**, se pisarían entre sí).
- Componente nuevo `SeguimientoProyectosList`: tabla (reutilizando el
  componente `DataTable` ya usado en el resto de la app) con columnas Fecha
  Inicio, Descripción, Estado (checkbox inline, togglea con un PUT directo
  al marcarlo/desmarcarlo), Fecha Culminación, Comentarios (muestra la
  cantidad, ej. "💬 3", botón para abrir), Eliminar.
- Un solo modal `ProyectoModal` (mismo patrón que `ProveedorModal`/
  `UsuarioModal`: sirve tanto para crear uno nuevo como para editar uno
  existente) con: Descripción, Fecha Inicio, Estado (check), Fecha
  Culminación, y debajo el historial de comentarios completo + un cuadro
  para agregar uno nuevo. Editar Descripción/Fechas y agregar un comentario
  son acciones independientes (cada una dispara su propio guardado), no
  hace falta un botón único de "Guardar todo".
