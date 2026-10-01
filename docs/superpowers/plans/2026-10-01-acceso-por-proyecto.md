# Acceso restringido por Empresa/Proyecto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** permitir vincular a un usuario a una empresa completa o a un proyecto puntual dentro de una empresa, y que esa vinculación filtre (del lado del servidor) lo que ese usuario puede ver/crear en Órdenes, Nueva OC, Dashboard, Reportes y Rendición de Gastos. Ver diseño completo en `docs/superpowers/specs/2026-10-01-acceso-por-proyecto-design.md`.

**Ya hecho (no repetir):** migración de base de datos aplicada — columnas `empresa_id` (integer, FK `empresas`) y `proyecto_id` (uuid, FK `proyectos`) agregadas a `usuarios`, ambas nullable. Verificado con `information_schema.columns`.

---

### Task 1: Backend — login/sesión, usuarios, catálogo de proyectos "todos"

**Files:**
- Modify: `api/auth.js`
- Modify: `api/usuarios.js`
- Modify: `api/proyectos.js`

- [ ] **Step 1: `api/auth.js` — sumar empresa_id/proyecto_id al payload de sesión**

En el `action === "login"`, el SELECT ya trae `*` de `usuarios` (incluye las columnas nuevas). Modificar la construcción del payload:

Buscar:
```js
    const exp = computeExpiry();
    const payload = {
      id: user.id, usuario: user.usuario,
      nombre: user.nombre, apellido: user.apellido,
      nivel_aprobacion: user.nivel_aprobacion, exp,
    };
```
Reemplazar por:
```js
    const exp = computeExpiry();
    const payload = {
      id: user.id, usuario: user.usuario,
      nombre: user.nombre, apellido: user.apellido,
      nivel_aprobacion: user.nivel_aprobacion,
      empresa_id: user.empresa_id || null,
      proyecto_id: user.proyecto_id || null,
      exp,
    };
```

No hace falta tocar `action === "me"`: ese bloque ya hace `{ ...payload, exp }` sobre lo que venía en el token, así que los campos nuevos viajan solos una vez que están en el payload de login.

- [ ] **Step 2: `api/usuarios.js` — aceptar y devolver empresa_id/proyecto_id**

Buscar:
```js
    const fields = {
      nombre: body.nombre,
      apellido: body.apellido,
      usuario: body.usuario,
      nivel_aprobacion: nivel,
    };
    if (body.password) fields.password_hash = hashPassword(body.password);
```
Reemplazar por:
```js
    const fields = {
      nombre: body.nombre,
      apellido: body.apellido,
      usuario: body.usuario,
      nivel_aprobacion: nivel,
      empresa_id: body.empresa_id ? Number(body.empresa_id) : null,
      proyecto_id: body.proyecto_id || null,
    };
    if (body.password) fields.password_hash = hashPassword(body.password);
```

El GET ya hace `select("*")` y `toPublic()` solo saca `password_hash` — los campos nuevos quedan incluidos en la respuesta sin más cambios.

- [ ] **Step 3: `api/proyectos.js` — permitir traer todos los proyectos (todas las empresas)**

Se necesita para el desplegable de Administración → Usuario, que debe listar los proyectos de las 3 empresas agrupados, no solo los de la empresa actualmente seleccionada.

Buscar:
```js
  if (req.method === "GET") {
    const empresaId = Number(req.query.empresa_id) || 1;
    const { data, error } = await db
      .from("proyectos")
      .select("*")
      .eq("empresa_id", empresaId)
      .eq("activo", true)
      .order("created_at", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ proyectos: data });
  }
```
Reemplazar por:
```js
  if (req.method === "GET") {
    let query = db.from("proyectos").select("*").eq("activo", true).order("created_at", { ascending: true });
    if (!req.query.all) {
      const empresaId = Number(req.query.empresa_id) || 1;
      query = query.eq("empresa_id", empresaId);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ proyectos: data });
  }
```

- [ ] **Step 4: Validar sintaxis**

Run: `node --check api/auth.js` y `node --check api/usuarios.js` y `node --check api/proyectos.js`
Expected: sin salida en los 3 (sintaxis OK).

- [ ] **Step 5: Commit y desplegar**

```bash
git add api/auth.js api/usuarios.js api/proyectos.js
git commit -m "feat: sumar empresa_id/proyecto_id a sesion, usuarios y catalogo de proyectos (acceso por proyecto, parte 1/3)"
git push
```

- [ ] **Step 6: Verificar en vivo**

Esperar ~30-40s el redeploy.

Confirmar que `GET /api/proyectos?all=1` devuelve proyectos de más de una empresa:
```powershell
curl.exe -sS "https://ocfast.vercel.app/api/proyectos?all=1" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const empresas=new Set(j.proyectos.map(p=>p.empresa_id));console.log('empresas distintas:',[...empresas]);console.log('total proyectos:',j.proyectos.length);});"
```
Expected: `empresas distintas: [ 1, 2, 3 ]` (o similar, más de una), `total proyectos` >= 7.

No se puede probar login/usuarios sin credenciales reales desde este entorno — verificar por lectura de código que el payload de login y el PUT/POST de usuarios incluyen los campos nuevos (confirmar con `grep` que las líneas quedaron exactamente como en el Step 1/2).

---

### Task 2: Backend — filtro server-side en Órdenes y Rendición de Gastos

**Files:**
- Modify: `api/ordenes.js`
- Modify: `api/rendiciones.js`

- [ ] **Step 1: `api/ordenes.js` — filtrar el GET por la sesión**

Buscar:
```js
  if (req.method === "GET") {
    const empresaId = Number(req.query.empresa_id) || 1;

    // El frontend pide el HES real ANTES de aprobar, para poder generar el
    // PDF con el numero definitivo y mandarlo ya correcto en el primer correo
    // (ver Task 3 en index.html / OrdenAccionModal).
    if (req.query.siguiente_hes) {
      const { data: siguienteHes, error } = await db.rpc("siguiente_numero_hes", { p_empresa_id: empresaId });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ numero_hes: String(siguienteHes).padStart(8, "0") });
    }

    const { data, error } = await db
      .from("ordenes_compra")
      .select("*, proveedores(razon_social, rut), proyectos(nombre)")
      .eq("activo", true)
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ordenes: data });
  }
```
Reemplazar por:
```js
  if (req.method === "GET") {
    const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
    // Si la sesion trae una empresa/proyecto fijo, se ignora el empresa_id
    // que mande el query string y se usa siempre el de la sesion -- asi no
    // se puede eludir el filtro manipulando la URL/el fetch desde el navegador.
    const empresaId = (session && session.empresa_id) ? session.empresa_id : (Number(req.query.empresa_id) || 1);

    // El frontend pide el HES real ANTES de aprobar, para poder generar el
    // PDF con el numero definitivo y mandarlo ya correcto en el primer correo
    // (ver Task 3 en index.html / OrdenAccionModal).
    if (req.query.siguiente_hes) {
      const { data: siguienteHes, error } = await db.rpc("siguiente_numero_hes", { p_empresa_id: empresaId });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ numero_hes: String(siguienteHes).padStart(8, "0") });
    }

    let query = db
      .from("ordenes_compra")
      .select("*, proveedores(razon_social, rut), proyectos(nombre)")
      .eq("activo", true)
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false });
    if (session && session.proyecto_id) {
      query = query.eq("proyecto_id", session.proyecto_id);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ordenes: data });
  }
```

- [ ] **Step 2: `api/ordenes.js` — forzar empresa_id/proyecto_id de la sesión al crear (POST)**

Buscar:
```js
    const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
    const empresaId = Number(body.empresa_id) || 1;
    const estado = ESTADOS_OCSYS.includes(body.estado) ? body.estado : "Borrador";
```
Reemplazar por:
```js
    const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
    const empresaId = (session && session.empresa_id) ? session.empresa_id : (Number(body.empresa_id) || 1);
    const estado = ESTADOS_OCSYS.includes(body.estado) ? body.estado : "Borrador";
```

Buscar:
```js
    const camposBase = {
      numero_cotizacion: body.numero_cotizacion || null,
      proyecto_id: body.proyecto_id || null,
```
Reemplazar por:
```js
    const camposBase = {
      numero_cotizacion: body.numero_cotizacion || null,
      // Si la sesion tiene un proyecto fijo asignado, se ignora cualquier
      // proyecto_id que mande el body -- refuerza del lado del servidor el
      // bloqueo visual del campo "Proyecto" en Nueva OC (ver index.html).
      proyecto_id: (session && session.proyecto_id) ? session.proyecto_id : (body.proyecto_id || null),
```

- [ ] **Step 3: `api/rendiciones.js` — filtrar el GET por la sesión (solo nivel empresa)**

Buscar:
```js
  if (req.method === "GET") {
    const empresaId = Number(req.query.empresa_id) || 1;
    const { data, error } = await db
      .from("rendiciones_gastos")
      .select("*")
      .eq("activo", true)
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ rendiciones: data });
  }
```
Reemplazar por:
```js
  if (req.method === "GET") {
    const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
    // Rendiciones no tiene columna "proyecto" -- un usuario atado a un
    // proyecto puntual ve aqui igual toda su empresa (ver limitacion
    // documentada en el spec de diseno).
    const empresaId = (session && session.empresa_id) ? session.empresa_id : (Number(req.query.empresa_id) || 1);
    const { data, error } = await db
      .from("rendiciones_gastos")
      .select("*")
      .eq("activo", true)
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ rendiciones: data });
  }
```

- [ ] **Step 4: Validar sintaxis**

Run: `node --check api/ordenes.js` y `node --check api/rendiciones.js`
Expected: sin salida en ambos.

- [ ] **Step 5: Commit y desplegar**

```bash
git add api/ordenes.js api/rendiciones.js
git commit -m "feat: filtrar Ordenes y Rendicion de Gastos por empresa/proyecto de la sesion (acceso por proyecto, parte 2/3)"
git push
```

- [ ] **Step 6: Verificar en vivo (sin sesión, debe comportarse igual que antes)**

Esperar el redeploy. Sin cookie de sesión, `session` es `null`, así que el comportamiento para una request sin login debe ser idéntico al actual (filtra solo por el `empresa_id` del query string):
```powershell
curl.exe -sS "https://ocfast.vercel.app/api/ordenes?empresa_id=1" -o "$env:TEMP\ordenes_post_fix.json"
node -e "const d=JSON.parse(require('fs').readFileSync(process.env.TEMP+'\\ordenes_post_fix.json','utf8'));console.log('total ordenes empresa 1:', d.ordenes.length);"
```
Expected: un número de órdenes similar al de antes del cambio (no 0, no error) — confirma que no se rompió el caso sin restricción.

No se puede probar el caso CON sesión restringida desde este entorno sin credenciales de un usuario de prueba ya vinculado a un proyecto — eso se verifica en el Task 3 (que sí crea ese usuario de prueba) o manualmente por el usuario real después del despliegue.

---

### Task 3: Frontend — campo "Proyecto" en Usuarios, bloqueo en Nueva OC, ocultar selector/Administración

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Cargar el catálogo combinado de empresas+proyectos para el desplegable de Usuario**

El `AdministracionList`/`UsuarioModal` necesita la lista de TODAS las empresas y TODOS los proyectos (no solo los de la empresa actualmente seleccionada en el header). `App` ya carga `empresas` (todas) vía `loadEmpresas`; falta cargar "todos los proyectos" por separado del `proyectos` existente (que sigue acotado a `empresaId`, usado en Nueva OC).

Buscar en `App`:
```js
  const [proyectos, setProyectos] = useState([]);
  const [proyectosSeguimiento, setProyectosSeguimiento] = useState([]);
```
Reemplazar por:
```js
  const [proyectos, setProyectos] = useState([]);
  const [proyectosTodos, setProyectosTodos] = useState([]);
  const [proyectosSeguimiento, setProyectosSeguimiento] = useState([]);
```

Buscar:
```js
  const loadProyectos = useCallback(() => {
    api("proyectos?empresa_id=" + empresaId).then((d) => setProyectos(d.proyectos)).catch((e) => notify("err", e.message));
  }, [notify, empresaId]);
```
Agregar justo después:
```js

  const loadProyectosTodos = useCallback(() => {
    api("proyectos?all=1").then((d) => setProyectosTodos(d.proyectos)).catch((e) => notify("err", e.message));
  }, [notify]);
```

Buscar:
```js
  useEffect(() => {
    loadEmpresas();
    loadProveedores();
    loadUsuarios();
  }, []);
```
Reemplazar por:
```js
  useEffect(() => {
    loadEmpresas();
    loadProveedores();
    loadUsuarios();
    loadProyectosTodos();
  }, []);
```

Buscar:
```js
    tab === "administracion" && h(AdministracionList, { usuarios, refreshUsuarios: loadUsuarios, notify, currentUser, refreshOrdenes: loadOrdenes, refreshProveedores: loadProveedores, refreshEmpresas: loadEmpresas, empresaId, empresa: empresaActual }),
```
Reemplazar por:
```js
    tab === "administracion" && h(AdministracionList, { usuarios, refreshUsuarios: loadUsuarios, notify, currentUser, refreshOrdenes: loadOrdenes, refreshProveedores: loadProveedores, refreshEmpresas: loadEmpresas, empresaId, empresa: empresaActual, empresas, proyectosTodos }),
```

- [ ] **Step 2: Pasar `empresas`/`proyectosTodos` de `AdministracionList` a `UsuarioModal`**

Buscar:
```js
function AdministracionList({ usuarios, refreshUsuarios, notify, currentUser, refreshOrdenes, refreshProveedores, refreshEmpresas, empresaId, empresa }) {
  const [showModal, setShowModal] = useState(false);
  const [verificando, setVerificando] = useState(null);
  const [editing, setEditing] = useState(null);
  const closeAny = () => { setShowModal(false); setEditing(null); setVerificando(null); };
  return h("div", { className: "page fade-up" },
    (showModal || editing) && h(UsuarioModal, {
      editUsuario: editing, onClose: closeAny,
      onSaved: () => { refreshUsuarios(); closeAny(); }, notify,
    }),
```
Reemplazar por:
```js
function AdministracionList({ usuarios, refreshUsuarios, notify, currentUser, refreshOrdenes, refreshProveedores, refreshEmpresas, empresaId, empresa, empresas, proyectosTodos }) {
  const [showModal, setShowModal] = useState(false);
  const [verificando, setVerificando] = useState(null);
  const [editing, setEditing] = useState(null);
  const closeAny = () => { setShowModal(false); setEditing(null); setVerificando(null); };
  return h("div", { className: "page fade-up" },
    (showModal || editing) && h(UsuarioModal, {
      editUsuario: editing, onClose: closeAny,
      onSaved: () => { refreshUsuarios(); closeAny(); }, notify,
      empresas, proyectosTodos,
    }),
```

- [ ] **Step 3: Agregar el campo "Proyecto" en `UsuarioModal`**

Buscar:
```js
function UsuarioModal({ onClose, onSaved, notify, editUsuario }) {
  const [form, setForm] = useState(editUsuario
    ? { ...USUARIO_BLANK, ...editUsuario, nivel_aprobacion: String(editUsuario.nivel_aprobacion), password: "" }
    : USUARIO_BLANK);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isEdit = !!editUsuario;
  // Sin cerrar al hacer clic afuera -- el campo de contraseña puede recibir
  // un clic de un gestor de contraseñas del navegador que cae sobre el fondo
  // y cerraba el formulario a medio llenar. Solo se cierra con Cancelar/×.
```
Reemplazar por:
```js
function UsuarioModal({ onClose, onSaved, notify, editUsuario, empresas, proyectosTodos }) {
  const [form, setForm] = useState(editUsuario
    ? { ...USUARIO_BLANK, ...editUsuario, nivel_aprobacion: String(editUsuario.nivel_aprobacion), password: "" }
    : USUARIO_BLANK);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isEdit = !!editUsuario;
  // Sin cerrar al hacer clic afuera -- el campo de contraseña puede recibir
  // un clic de un gestor de contraseñas del navegador que cae sobre el fondo
  // y cerraba el formulario a medio llenar. Solo se cierra con Cancelar/×.

  // El select combina "sin restriccion" + cada empresa ("toda la empresa" +
  // sus proyectos activos) en una sola lista, codificando el valor como
  // "empresa:<id>" o "proyecto:<id>" para despues separarlo en empresa_id/
  // proyecto_id reales -- asi el admin elige una sola cosa sin tener que
  // entender el modelo de 2 columnas por detras.
  const accesoValue = form.proyecto_id ? "proyecto:" + form.proyecto_id : (form.empresa_id ? "empresa:" + form.empresa_id : "");
  const onAccesoChange = (e) => {
    const v = e.target.value;
    if (!v) return setForm((f) => ({ ...f, empresa_id: null, proyecto_id: null }));
    const [tipo, id] = v.split(":");
    if (tipo === "empresa") return setForm((f) => ({ ...f, empresa_id: Number(id), proyecto_id: null }));
    const proyecto = (proyectosTodos || []).find((p) => p.id === id);
    setForm((f) => ({ ...f, empresa_id: proyecto ? proyecto.empresa_id : f.empresa_id, proyecto_id: id }));
  };
```

Buscar:
```js
      h(Field, { label: "Contraseña" },
        h("input", { type: "password", value: form.password, onChange: set("password"),
          placeholder: isEdit ? "Dejar en blanco para no cambiarla" : "Dejar en blanco por ahora" })),
```
Agregar justo antes de ese bloque (antes del campo Contraseña):
```js
      h(Field, { label: "Proyecto" },
        h("select", { value: accesoValue, onChange: onAccesoChange },
          h("option", { value: "" }, "Sin restricción (ve todo)"),
          (empresas || []).map((emp) => h(React.Fragment, { key: emp.id },
            h("option", { value: "empresa:" + emp.id }, emp.nombre + " — Toda la empresa"),
            (proyectosTodos || []).filter((p) => p.empresa_id === emp.id).map((p) =>
              h("option", { key: p.id, value: "proyecto:" + p.id }, emp.nombre + " — " + p.nombre)),
          )),
        )),
      h("div", { className: "hint", style: { marginTop: -8, marginBottom: 10 } }, "Si se deja 'Sin restricción', el usuario ve todas las OC de todas las empresas, como hoy."),
```

- [ ] **Step 4: Guardar empresa_id/proyecto_id al enviar el formulario**

El `submit()` de `UsuarioModal` ya manda `JSON.stringify({ ...form, nivel_aprobacion: Number(form.nivel_aprobacion) })` — como `form.empresa_id`/`form.proyecto_id` ya quedan seteados por `onAccesoChange`, no hace falta tocar `submit()`. Solo falta que `USUARIO_BLANK` los incluya en null por defecto:

Buscar:
```js
const USUARIO_BLANK = { nombre: "", apellido: "", usuario: "", nivel_aprobacion: "0", password: "" };
```
Reemplazar por:
```js
const USUARIO_BLANK = { nombre: "", apellido: "", usuario: "", nivel_aprobacion: "0", password: "", empresa_id: null, proyecto_id: null };
```

- [ ] **Step 5: Mostrar la vinculación en la tabla de usuarios**

Buscar:
```js
const USUARIOS_COLUMNS = [
  { key: "nombre", label: "Nombre" },
  { key: "apellido", label: "Apellido" },
  { key: "usuario", label: "Usuario" },
  { key: "nivel_aprobacion", label: "Nivel Aprobación", render: (u) => (u.nivel_aprobacion === 1
    ? h("span", { className: "pill pill-ok" }, "1 — Aprueba OC")
    : h("span", { className: "pill pill-pend" }, "0 — No aprueba")) },
  { key: "tiene_password", label: "Contraseña", render: (u) => (u.tiene_password
    ? h("span", { className: "pill pill-ok" }, "Configurada")
    : h("span", { className: "pill pill-pend" }, "Sin definir")) },
];
```
Reemplazar por:
```js
const USUARIOS_COLUMNS = [
  { key: "nombre", label: "Nombre" },
  { key: "apellido", label: "Apellido" },
  { key: "usuario", label: "Usuario" },
  { key: "nivel_aprobacion", label: "Nivel Aprobación", render: (u) => (u.nivel_aprobacion === 1
    ? h("span", { className: "pill pill-ok" }, "1 — Aprueba OC")
    : h("span", { className: "pill pill-pend" }, "0 — No aprueba")) },
  {
    key: "acceso", label: "Proyecto", sortable: false,
    render: (u) => u.proyecto_id || u.empresa_id ? h("span", { className: "pill pill-pend" }, "Restringido") : h("span", { className: "pill pill-ok" }, "Ve todo"),
  },
  { key: "tiene_password", label: "Contraseña", render: (u) => (u.tiene_password
    ? h("span", { className: "pill pill-ok" }, "Configurada")
    : h("span", { className: "pill pill-pend" }, "Sin definir")) },
];
```

(Se muestra solo si está restringido o no, no el nombre del proyecto puntual, para no tener que resolver el join en el frontend en esta tabla — alcanza para que el admin note de un vistazo quién tiene acceso acotado.)

- [ ] **Step 6: `App` — fijar empresaId y ocultar el selector/Administración para un usuario restringido**

Buscar:
```js
  const [empresaId, setEmpresaIdState] = useState(() => {
    try { return Number(localStorage.getItem("ocsys_empresa_id")) || 1; } catch (e) { return 1; }
  });
  const setEmpresaId = (id) => {
    setEmpresaIdState(id);
    try { localStorage.setItem("ocsys_empresa_id", String(id)); } catch (e) { /* modo privado u otro bloqueo: no persiste, no es critico */ }
  };
```
Reemplazar por:
```js
  const [empresaId, setEmpresaIdState] = useState(() => {
    if (currentUser.empresa_id) return currentUser.empresa_id;
    try { return Number(localStorage.getItem("ocsys_empresa_id")) || 1; } catch (e) { return 1; }
  });
  const setEmpresaId = (id) => {
    if (currentUser.empresa_id) return; // usuario atado a una empresa fija: no puede cambiarla
    setEmpresaIdState(id);
    try { localStorage.setItem("ocsys_empresa_id", String(id)); } catch (e) { /* modo privado u otro bloqueo: no persiste, no es critico */ }
  };
```

Buscar:
```js
        empresas.length > 0 && h("select", {
          value: empresaId, onChange: (e) => setEmpresaId(Number(e.target.value)),
          style: { fontSize: 12, padding: "5px 8px", width: "auto" },
        }, empresas.map((emp) => h("option", { key: emp.id, value: emp.id }, emp.nombre))),
```
Reemplazar por:
```js
        !currentUser.empresa_id && empresas.length > 0 && h("select", {
          value: empresaId, onChange: (e) => setEmpresaId(Number(e.target.value)),
          style: { fontSize: 12, padding: "5px 8px", width: "auto" },
        }, empresas.map((emp) => h("option", { key: emp.id, value: emp.id }, emp.nombre))),
```

Buscar:
```js
      h("button", { className: "nav-btn" + (tab === "administracion" ? " active" : ""), onClick: () => setTab("administracion") }, "Administración"),
      h("button", { className: "nav-btn" + (tab === "proyectos-seguimiento" ? " active" : ""), onClick: () => setTab("proyectos-seguimiento") }, "Proyectos"),
```
Reemplazar por:
```js
      !currentUser.empresa_id && h("button", { className: "nav-btn" + (tab === "administracion" ? " active" : ""), onClick: () => setTab("administracion") }, "Administración"),
      h("button", { className: "nav-btn" + (tab === "proyectos-seguimiento" ? " active" : ""), onClick: () => setTab("proyectos-seguimiento") }, "Proyectos"),
```

- [ ] **Step 7: `NuevaOC` — fijar y bloquear el campo Proyecto cuando el usuario tiene uno asignado**

Buscar:
```js
  const [form, setForm] = useState(formBlank());
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
```
Reemplazar por:
```js
  const [form, setForm] = useState(() => ({ ...formBlank(), proyecto_id: currentUser.proyecto_id || "" }));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
```

Buscar:
```js
        h(Field, { label: "Proyectos" },
          h("div", { className: "row-inline" },
            h("select", {
              value: form.proyecto_id, onChange: (e) => setForm((f) => ({ ...f, proyecto_id: e.target.value })),
            },
              h("option", { value: "" }, "Selecciona"),
              proyectos.map((p) => h("option", { key: p.id, value: p.id }, p.nombre)),
            ),
            h("button", { className: "btn-add", title: "Agregar proyecto", type: "button", onClick: agregarProyecto }, "+"),
          )),
      ),
```
Reemplazar por (dentro de `NuevaOC` — NO tocar el bloque equivalente de `EditarOrdenModal`, que queda igual):
```js
        h(Field, { label: "Proyectos" },
          h("div", { className: "row-inline" },
            h("select", {
              value: form.proyecto_id, disabled: !!currentUser.proyecto_id,
              onChange: (e) => setForm((f) => ({ ...f, proyecto_id: e.target.value })),
            },
              h("option", { value: "" }, "Selecciona"),
              proyectos.map((p) => h("option", { key: p.id, value: p.id }, p.nombre)),
            ),
            !currentUser.proyecto_id && h("button", { className: "btn-add", title: "Agregar proyecto", type: "button", onClick: agregarProyecto }, "+"),
          )),
      ),
```

- [ ] **Step 8: Validar sintaxis**

Run: `node "$env:TEMP\check_inline_ocsys.js" "C:\Users\ALEX MELENDEZ\Documents\GitHub\ocfast\index.html"`
Expected: `inline script 1: OK (...)`

- [ ] **Step 9: Commit y desplegar**

```bash
git add index.html
git commit -m "feat: campo Proyecto en Usuarios, bloqueo en Nueva OC y ocultar selector/Administracion para usuarios restringidos (acceso por proyecto, parte 3/3)"
git push
```

- [ ] **Step 10: Verificación por lectura de código + prueba end-to-end con un usuario de prueba**

No se puede probar la UI en un navegador real desde este entorno. Verificar por lectura:
- `proyectosTodos` se carga una sola vez (no depende de `empresaId`) y llega correctamente hasta `UsuarioModal`.
- El `select` de "Proyecto" en `UsuarioModal` codifica/decodifica bien `empresa:<id>` / `proyecto:<id>` — probar mentalmente los 3 casos (sin restricción, empresa, proyecto puntual) contra `onAccesoChange`.
- `App` nunca deja que `setEmpresaId` cambie el estado si `currentUser.empresa_id` está seteado, y el `<select>` de empresa directamente no se renderiza en ese caso (no solo queda deshabilitado).
- El botón "Administración" no se renderiza si `currentUser.empresa_id` está seteado.
- En `NuevaOC`, si `currentUser.proyecto_id` está seteado, el campo quedó con ese valor desde el primer render y el `<select>` está `disabled`.

Prueba end-to-end real (requiere credenciales): crear un usuario de prueba vinculado a "Remodelación El Cortijo", loguearse con él (fuera de este entorno, en un navegador), y confirmar que:
1. No ve el selector de empresa ni el botón "Administración".
2. En Nueva OC, el campo Proyecto ya viene en "Remodelación El Cortijo" y no se puede cambiar.
3. En Órdenes, solo ve las OC de ese proyecto (y ninguna otra).
4. Un usuario `@patagonica.cl` sin restricción sigue viendo todo igual que antes.
