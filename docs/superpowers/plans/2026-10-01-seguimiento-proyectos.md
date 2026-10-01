# Menú "Proyectos" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un menú nuevo "Proyectos" (independiente de todo lo demás) donde cualquier usuario puede crear, editar, comentar (historial, nunca se sobrescribe) y marcar como Finalizado un proyecto/trabajo, pensando en reemplazar el seguimiento informal por WhatsApp y dejar la base lista para un informe de gestión futuro.

**Architecture:** Un archivo API nuevo (`api/proyectos-seguimiento.js`) sobre dos tablas ya creadas (`seguimiento_proyectos`, `seguimiento_proyectos_comentarios`), y dos componentes nuevos en `index.html` (`SeguimientoProyectosList`, `ProyectoModal`) siguiendo el mismo patrón ya usado por `AdministracionList`/`UsuarioModal`.

**Tech Stack:** Vercel Node.js serverless (ESM), Supabase Postgres, React sin build (`h()`) en `index.html`. Sin framework de tests — verificación con `node --check`, el script de sintaxis inline, y pruebas reales contra `https://ocfast.vercel.app`.

**Ya hecho (no repetir):** las 2 tablas (`seguimiento_proyectos`, `seguimiento_proyectos_comentarios`) ya existen en la base de datos, con RLS habilitado (sin políticas — mismo patrón de seguridad usado en el resto de las tablas de este proyecto; el backend usa la service-role key, así que no hay impacto funcional).

---

### Task 1: Backend — `api/proyectos-seguimiento.js`

**Files:**
- Create: `api/proyectos-seguimiento.js`

- [ ] **Step 1: Crear el archivo completo**

```js
import { supabase, readJsonBody } from "./_supabase.js";
import { verifyToken, parseCookie } from "./_session.js";

// Bitacora de proyectos/trabajos en curso (independiente del catalogo
// "proyectos" que se usa como campo en Nueva OC) -- reemplaza el grupo de
// WhatsApp donde se informaban avances, para dejar un historial ordenado
// con fecha y autor de cada nota, pensando en poder sacar un informe de
// gestion mas adelante. Crear/editar/comentar/marcar estado/eliminar es
// libre para cualquier usuario con sesion, sin restriccion de nivel.
export default async function handler(req, res) {
  const db = supabase();
  const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");

  if (req.method === "GET") {
    const empresaId = Number(req.query.empresa_id) || 1;
    const { data, error } = await db
      .from("seguimiento_proyectos")
      .select("*, seguimiento_proyectos_comentarios(*)")
      .eq("empresa_id", empresaId)
      .eq("activo", true)
      .order("created_at", { ascending: false })
      .order("created_at", { ascending: true, foreignTable: "seguimiento_proyectos_comentarios" });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ proyectos: data });
  }

  if (req.method === "POST") {
    if (req.query.comentario) {
      const body = await readJsonBody(req);
      const texto = (body.texto || "").trim();
      if (!texto) return res.status(400).json({ error: "texto es obligatorio" });
      if (!body.proyecto_id) return res.status(400).json({ error: "proyecto_id es obligatorio" });
      const { data, error } = await db
        .from("seguimiento_proyectos_comentarios")
        .insert({ proyecto_id: body.proyecto_id, texto, usuario: session ? session.usuario : null })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ comentario: data });
    }

    const body = await readJsonBody(req);
    const descripcion = (body.descripcion || "").trim();
    if (!descripcion) return res.status(400).json({ error: "descripcion es obligatoria" });
    const empresaId = Number(body.empresa_id) || 1;
    const { data, error } = await db
      .from("seguimiento_proyectos")
      .insert({
        empresa_id: empresaId,
        descripcion,
        fecha_inicio: body.fecha_inicio || new Date().toISOString().slice(0, 10),
        creado_por_usuario: session ? session.usuario : null,
      })
      .select("*, seguimiento_proyectos_comentarios(*)")
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ proyecto: data });
  }

  if (req.method === "PUT") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id es obligatorio" });
    const body = await readJsonBody(req);
    const fields = {};
    if (body.descripcion !== undefined) fields.descripcion = body.descripcion;
    if (body.fecha_inicio !== undefined) fields.fecha_inicio = body.fecha_inicio;
    if (body.finalizado !== undefined) fields.finalizado = body.finalizado;
    if (body.fecha_culminacion !== undefined) {
      fields.fecha_culminacion = body.fecha_culminacion;
    } else if (body.finalizado === true) {
      // Se autocompleta con hoy solo si todavia no tenia una fecha de
      // culminacion cargada -- si ya tenia una (puesta a mano antes), se
      // respeta y no se pisa.
      const { data: actual } = await db.from("seguimiento_proyectos").select("fecha_culminacion").eq("id", id).maybeSingle();
      if (!actual?.fecha_culminacion) {
        fields.fecha_culminacion = new Date().toISOString().slice(0, 10);
      }
    }
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: "No hay campos para actualizar" });
    }
    const { data, error } = await db
      .from("seguimiento_proyectos")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*, seguimiento_proyectos_comentarios(*)")
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ proyecto: data });
  }

  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id es obligatorio" });
    const { error } = await db
      .from("seguimiento_proyectos")
      .update({
        activo: false,
        eliminado_por: session ? session.usuario : null,
        eliminado_en: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, PUT, DELETE");
  return res.status(405).json({ error: "Método no permitido" });
}
```

- [ ] **Step 2: Validar sintaxis**

Run: `node --check api/proyectos-seguimiento.js`
Expected: sin salida (sintaxis OK).

- [ ] **Step 3: Commit y desplegar**

```bash
git add api/proyectos-seguimiento.js
git commit -m "feat: endpoint de seguimiento de proyectos (bitacora con historial de comentarios)"
git push
```

- [ ] **Step 4: Verificar en vivo**

Esperar ~30-40s el redeploy.

Crear un proyecto:
```powershell
$body = @{ descripcion = "Prueba plan: retirar palets de bodega"; fecha_inicio = "2026-10-01"; empresa_id = 1 } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText("$env:TEMP\test_proyecto_crear.json", $body, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -sS -X POST "https://ocfast.vercel.app/api/proyectos-seguimiento" -H "Content-Type: application/json" --data "@$env:TEMP\test_proyecto_crear.json"
```
Expected: 201, `{"proyecto": {... "seguimiento_proyectos_comentarios": []}}`. Anotar el `id`.

Agregar un comentario:
```powershell
$bodyC = @{ proyecto_id = "<id>"; texto = "Se coordino el retiro para manana AM" } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText("$env:TEMP\test_proyecto_comentario.json", $bodyC, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -sS -X POST "https://ocfast.vercel.app/api/proyectos-seguimiento?comentario=1" -H "Content-Type: application/json" --data "@$env:TEMP\test_proyecto_comentario.json"
```
Expected: 201, `{"comentario": {...}}`.

Marcar como finalizado (confirma el autocompletado de fecha_culminacion):
```powershell
$bodyF = @{ finalizado = $true } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText("$env:TEMP\test_proyecto_finalizar.json", $bodyF, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -sS -X PUT "https://ocfast.vercel.app/api/proyectos-seguimiento?id=<id>" -H "Content-Type: application/json" --data "@$env:TEMP\test_proyecto_finalizar.json"
```
Expected: 200, `finalizado: true`, `fecha_culminacion` = la fecha de hoy.

Hacer GET y confirmar que el proyecto trae el comentario anidado:
```powershell
curl.exe -sS "https://ocfast.vercel.app/api/proyectos-seguimiento?empresa_id=1"
```
Expected: el proyecto de prueba aparece con `seguimiento_proyectos_comentarios` conteniendo el comentario agregado.

Limpiar (soft-delete) vía la propia API (no hace falta SQL directo, el DELETE ya es seguro/reversible):
```powershell
curl.exe -sS -X DELETE "https://ocfast.vercel.app/api/proyectos-seguimiento?id=<id>"
```
Expected: 200, `{"ok": true}`.

---

### Task 2: Frontend — menú, lista y modal

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Agregar el estado y los loaders en `App`**

Buscar:
```js
  const [proyectos, setProyectos] = useState([]);
```
Reemplazar por:
```js
  const [proyectos, setProyectos] = useState([]);
  const [proyectosSeguimiento, setProyectosSeguimiento] = useState([]);
```
**IMPORTANTE: `proyectos`/`setProyectos` ya existen y son el catálogo que se
usa en Nueva OC — no tocar ni reusar esos nombres. El estado nuevo se llama
`proyectosSeguimiento`.**

Buscar:
```js
  const loadProyectos = useCallback(() => {
    api("proyectos?empresa_id=" + empresaId).then((d) => setProyectos(d.proyectos)).catch((e) => notify("err", e.message));
  }, [notify, empresaId]);
```
Agregar justo después (antes del siguiente `useEffect`):
```js

  const loadProyectosSeguimiento = useCallback(() => {
    api("proyectos-seguimiento?empresa_id=" + empresaId).then((d) => setProyectosSeguimiento(d.proyectos)).catch((e) => notify("err", e.message));
  }, [notify, empresaId]);
```

Buscar:
```js
  useEffect(() => {
    setCatalogos((c) => ({ ...c, listos: false }));
    loadOrdenes();
    loadRendiciones();
    loadCatalogos();
    loadProyectos();
  }, [empresaId]);
```
Reemplazar por:
```js
  useEffect(() => {
    setCatalogos((c) => ({ ...c, listos: false }));
    loadOrdenes();
    loadRendiciones();
    loadCatalogos();
    loadProyectos();
    loadProyectosSeguimiento();
  }, [empresaId]);
```

- [ ] **Step 2: Agregar el botón de navegación y el render de la pestaña**

Buscar:
```js
      h("button", { className: "nav-btn" + (tab === "administracion" ? " active" : ""), onClick: () => setTab("administracion") }, "Administración"),
    ),
```
Reemplazar por:
```js
      h("button", { className: "nav-btn" + (tab === "administracion" ? " active" : ""), onClick: () => setTab("administracion") }, "Administración"),
      h("button", { className: "nav-btn" + (tab === "proyectos-seguimiento" ? " active" : ""), onClick: () => setTab("proyectos-seguimiento") }, "Proyectos"),
    ),
```

Buscar:
```js
    tab === "administracion" && h(AdministracionList, { usuarios, refreshUsuarios: loadUsuarios, notify, currentUser, refreshOrdenes: loadOrdenes, refreshProveedores: loadProveedores, refreshEmpresas: loadEmpresas, empresaId, empresa: empresaActual }),
  );
```
Reemplazar por:
```js
    tab === "administracion" && h(AdministracionList, { usuarios, refreshUsuarios: loadUsuarios, notify, currentUser, refreshOrdenes: loadOrdenes, refreshProveedores: loadProveedores, refreshEmpresas: loadEmpresas, empresaId, empresa: empresaActual }),
    tab === "proyectos-seguimiento" && h(SeguimientoProyectosList, { proyectosSeguimiento, refreshProyectosSeguimiento: loadProyectosSeguimiento, notify, empresaId }),
  );
```

- [ ] **Step 3: Agregar los dos componentes nuevos**

Agregar este bloque completo en `index.html`, justo antes de la función
`function AdministracionList(` (para que quede cerca de componentes de
forma/listado similares — no importa el orden exacto siempre que quede a
nivel superior del archivo, junto a las demás funciones de componente):

```js
function ProyectoModal({ editProyecto, empresaId, notify, onClose, onSaved }) {
  const isEdit = !!editProyecto;
  const [descripcion, setDescripcion] = useState(editProyecto ? editProyecto.descripcion || "" : "");
  const [fechaInicio, setFechaInicio] = useState(editProyecto ? editProyecto.fecha_inicio || "" : new Date().toISOString().slice(0, 10));
  const [finalizado, setFinalizado] = useState(editProyecto ? !!editProyecto.finalizado : false);
  const [fechaCulminacion, setFechaCulminacion] = useState(editProyecto ? editProyecto.fecha_culminacion || "" : "");
  const [saving, setSaving] = useState(false);
  const [comentarioNuevo, setComentarioNuevo] = useState("");
  const [comentarios, setComentarios] = useState(editProyecto ? editProyecto.seguimiento_proyectos_comentarios || [] : []);
  const [enviandoComentario, setEnviandoComentario] = useState(false);

  const guardar = async () => {
    if (!descripcion.trim()) return notify("err", "Ingresa una descripción");
    if (!fechaInicio) return notify("err", "Ingresa la fecha de inicio");
    setSaving(true);
    try {
      if (isEdit) {
        await api("proyectos-seguimiento?id=" + editProyecto.id, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ descripcion, fecha_inicio: fechaInicio, finalizado, fecha_culminacion: fechaCulminacion || null }),
        });
        notify("ok", "Proyecto actualizado");
      } else {
        await api("proyectos-seguimiento", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ descripcion, fecha_inicio: fechaInicio, empresa_id: empresaId }),
        });
        notify("ok", "Proyecto creado");
      }
      onSaved();
    } catch (e) {
      notify("err", e.message);
    } finally {
      setSaving(false);
    }
  };

  const agregarComentario = async () => {
    if (!comentarioNuevo.trim()) return;
    setEnviandoComentario(true);
    try {
      const { comentario } = await api("proyectos-seguimiento?comentario=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proyecto_id: editProyecto.id, texto: comentarioNuevo }),
      });
      setComentarios((c) => [...c, comentario]);
      setComentarioNuevo("");
    } catch (e) {
      notify("err", e.message);
    } finally {
      setEnviandoComentario(false);
    }
  };

  return h("div", { className: "overlay", onClick: (e) => e.target === e.currentTarget && onClose() },
    h("div", { className: "modal", style: { width: 460, maxHeight: "90vh", overflowY: "auto" } },
      h("div", { className: "modal-hdr" },
        h("h3", null, isEdit ? "Editar Proyecto" : "Nuevo Proyecto"),
        h("button", { className: "modal-close", onClick: onClose }, "×")
      ),
      h(Field, { label: "Descripción *" }, h("textarea", { rows: 2, value: descripcion, onChange: (e) => setDescripcion(e.target.value) })),
      h("div", { className: "grid2" },
        h(Field, { label: "Fecha Inicio *" }, h("input", { type: "date", value: fechaInicio, onChange: (e) => setFechaInicio(e.target.value) })),
        isEdit && h(Field, { label: "Fecha Culminación" }, h("input", { type: "date", value: fechaCulminacion, onChange: (e) => setFechaCulminacion(e.target.value) })),
      ),
      isEdit && h(Field, { label: "Estado" },
        h("label", { style: { display: "flex", alignItems: "center", gap: 8 } },
          h("input", {
            type: "checkbox", checked: finalizado,
            onChange: (e) => {
              setFinalizado(e.target.checked);
              if (e.target.checked && !fechaCulminacion) setFechaCulminacion(new Date().toISOString().slice(0, 10));
            },
          }),
          finalizado ? "Finalizado" : "En Ejecución",
        )),
      h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 } },
        h("button", { className: "btn-ghost", onClick: onClose }, "Cancelar"),
        h("button", { className: "btn-primary", onClick: guardar, disabled: saving }, saving ? "Guardando..." : "Guardar"),
      ),
      isEdit && h(React.Fragment, null,
        h("div", { className: "section-lbl" }, "Comentarios"),
        h("div", { style: { maxHeight: 220, overflowY: "auto", border: "1px solid var(--bdr)", borderRadius: 8, padding: "8px 10px", marginBottom: 10 } },
          comentarios.length === 0
            ? h("div", { className: "hint" }, "Todavía no hay comentarios.")
            : comentarios.map((c) => h("div", { key: c.id, style: { marginBottom: 8, fontSize: 13 } },
                h("div", { style: { color: "var(--txm)", fontSize: 11 } }, (c.usuario || "—") + " · " + new Date(c.created_at).toLocaleString("es-CL")),
                h("div", null, c.texto),
              )),
        ),
        h("div", { style: { display: "flex", gap: 8 } },
          h("input", { value: comentarioNuevo, onChange: (e) => setComentarioNuevo(e.target.value), placeholder: "Agregar un comentario...", style: { flex: 1 } }),
          h("button", { className: "btn-ghost", onClick: agregarComentario, disabled: enviandoComentario || !comentarioNuevo.trim() }, "Agregar"),
        ),
      ),
    )
  );
}

function SeguimientoProyectosList({ proyectosSeguimiento, refreshProyectosSeguimiento, notify, empresaId }) {
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const closeAny = () => { setShowModal(false); setEditando(null); };

  const toggleFinalizado = async (p, checked) => {
    try {
      await api("proyectos-seguimiento?id=" + p.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalizado: checked }),
      });
      refreshProyectosSeguimiento();
    } catch (e) {
      notify("err", e.message);
    }
  };

  const eliminarProyecto = async (p) => {
    if (!window.confirm("¿Eliminar este proyecto? Dejará de verse en la lista.")) return;
    try {
      await api("proyectos-seguimiento?id=" + p.id, { method: "DELETE" });
      notify("ok", "Proyecto eliminado");
      refreshProyectosSeguimiento();
    } catch (e) {
      notify("err", e.message);
    }
  };

  const columns = useMemo(() => [
    { key: "fecha_inicio", label: "Fecha Inicio", render: (p) => fmtDate(p.fecha_inicio) },
    { key: "descripcion", label: "Descripción", render: (p) => truncar(p.descripcion || "", 200) },
    {
      key: "finalizado", label: "Estado", sortable: false,
      render: (p) => h("label", {
        style: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer" },
        onClick: (e) => e.stopPropagation(),
      },
        h("input", { type: "checkbox", checked: !!p.finalizado, onChange: (e) => toggleFinalizado(p, e.target.checked) }),
        p.finalizado ? "Finalizado" : "Ejecución"),
    },
    { key: "fecha_culminacion", label: "Fecha Culminación", render: (p) => p.fecha_culminacion ? fmtDate(p.fecha_culminacion) : "—" },
    {
      key: "comentarios", label: "Comentarios", sortable: false,
      render: (p) => "💬 " + ((p.seguimiento_proyectos_comentarios || []).length),
    },
    {
      key: "eliminar", label: "", sortable: false,
      render: (p) => h("button", {
        className: "btn-ghost", title: "Eliminar", style: { padding: "4px 8px", fontSize: 12 },
        onClick: (e) => { e.stopPropagation(); eliminarProyecto(p); },
      }, "🗑️"),
    },
  ], []);

  return h("div", { className: "page fade-up" },
    (showModal || editando) && h(ProyectoModal, {
      editProyecto: editando, empresaId, notify,
      onClose: closeAny,
      onSaved: () => { refreshProyectosSeguimiento(); closeAny(); },
    }),
    h("div", { className: "card" },
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 } },
        h("h2", { style: { marginBottom: 0 } }, "Proyectos"),
        h("button", { className: "btn-primary", style: { padding: "8px 18px" }, onClick: () => setShowModal(true) }, "+ Nuevo Proyecto"),
      ),
      h(DataTable, {
        columns, rows: proyectosSeguimiento, rowKey: (p) => p.id,
        onRowClick: (p) => setEditando(p),
        searchFields: ["descripcion"],
        searchPlaceholder: "Buscar por descripción",
        emptyText: "Aún no hay proyectos registrados",
      }),
    ),
  );
}
```

**Nota importante:** el timestamp de cada comentario (`c.created_at`) es un
`timestamptz` completo (fecha+hora), NO una fecha pura como
`fecha_inicio`/`fecha_culminacion` — por eso se formatea con
`new Date(c.created_at).toLocaleString("es-CL")` y NO con la función
`fmtDate()` ya existente en el archivo (esa función hace `new Date(d +
"T00:00:00")`, pensada solo para strings de fecha pura tipo "2026-07-31" —
concatenarle eso a un timestamp ya completo produciría una fecha inválida).

- [ ] **Step 4: Validar sintaxis**

Run: `node "$env:TEMP\check_inline_ocsys.js" "C:\Users\ALEX MELENDEZ\Documents\GitHub\ocfast\index.html"`
Expected: `inline script 1: OK (...)`

- [ ] **Step 5: Commit y desplegar**

```bash
git add index.html
git commit -m "feat: menu Proyectos (bitacora de trabajos con historial de comentarios)"
git push
```

- [ ] **Step 6: Verificación por lectura de código**

No se puede probar en un navegador real desde este entorno. Verificar por
lectura:
- `proyectosSeguimiento`/`setProyectosSeguimiento`/`loadProyectosSeguimiento`
  son nombres completamente distintos de `proyectos`/`setProyectos`/
  `loadProyectos` (el catálogo de OC) — no hay colisión de nombres en
  ningún lado del archivo.
- El botón "Proyectos" queda después de "Administración" en el nav, y el
  `tab === "proyectos-seguimiento"` correspondiente renderiza
  `SeguimientoProyectosList` con las props correctas.
- `ProyectoModal` y `SeguimientoProyectosList` están definidos como
  funciones de componente a nivel superior del archivo (no anidadas dentro
  de otra función) — igual que `UsuarioModal`/`AdministracionList`.
- El checkbox de "Estado" en la tabla (`SeguimientoProyectosList`) usa
  `onClick: (e) => e.stopPropagation()` en el `<label>` que lo envuelve,
  para que tildarlo no dispare también `onRowClick` (que abriría el modal
  de edición al mismo tiempo) — confirmar que el patrón es análogo al ya
  usado en otras tablas de este archivo para separar un control inline del
  click de la fila completa.
- `fmtDate`, `truncar`, `Field`, `DataTable` ya existen como
  funciones/componentes top-level usados en otras partes del archivo — no
  hace falta definirlos de nuevo.
