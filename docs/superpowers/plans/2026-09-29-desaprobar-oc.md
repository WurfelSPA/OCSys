# Desaprobar una OC ya Aprobada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que un usuario con nivel de aprobador revierta una OC de `"Aprobada"` a `"Pendiente aprobación"` (para corregirla y editarla), y que al volver a aprobarla se reutilice el mismo N° de HES en vez de generar uno nuevo — todo lo demás (N° de OC, correo de aprobación, PDF) sigue exactamente igual al flujo de aprobación normal.

**Architecture:** Un bloque de validación nuevo en el PUT de `api/ordenes.js` (autoriza y filtra la transición Aprobada → Pendiente aprobación), un botón nuevo + acción directa en `OrdenesList` (`index.html`), y un ajuste de una línea en `OrdenAccionModal.submit()` para reutilizar el HES existente si ya hay uno.

**Tech Stack:** Vercel Node.js serverless (ESM), Supabase Postgres, React sin build (`h()`) en `index.html`. Sin framework de tests — verificación con `node --check`, el script de sintaxis inline, y pruebas reales contra `https://ocfast.vercel.app` con el proveedor de pruebas ya usado en features anteriores (`5d459c0e-8d9b-4af7-91b9-164fc9a53eca`, "Alex Services (TEST)", empresa 1), limpiando siempre con soft-delete (`activo=false`), nunca un DELETE real.

**Nota sobre pruebas de "Aprobar":** aprobar una OC de verdad envía un correo real al proveedor (`enviarCorreoAprobacion`). Para probar el flujo de desaprobar+reaprobar sin enviar un correo real a nadie externo, se usa el proveedor de pruebas "Alex Services (TEST)" (su `contacto_correo` es la propia casilla del desarrollador, `alexricardomelendez@hotmail.com` — no es un tercero real), y se limpia (soft-delete) la OC de prueba al final igual que en features anteriores.

---

### Task 1: Backend — validar la transición Aprobada → Pendiente aprobación

**Files:**
- Modify: `api/ordenes.js` (handler PUT)

- [ ] **Step 1: Agregar el bloque de validación**

En `api/ordenes.js`, buscar este bloque (dentro de `if (body.estado !== undefined) { ... }`):
```js
      if (body.estado === "Aprobada") {
        session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
        if (!session || session.nivel_aprobacion !== 1) {
          return res.status(403).json({ error: "No tienes nivel de aprobación para aprobar órdenes de compra" });
        }
        // El cliente puede generar y enviar su propio numero_hes junto con
        // el PDF ya regenerado con ese mismo HES (para que el correo de
        // aprobacion salga con el PDF correcto desde el primer envio, sin
        // un segundo paso). Si no lo manda, se pide aqui el siguiente
        // correlativo real (ver Task 1 / siguiente_numero_hes).
        if (body.numero_hes) {
          fields.numero_hes = body.numero_hes;
        } else {
          const { data: filaActual } = await db.from("ordenes_compra").select("empresa_id").eq("id", id).maybeSingle();
          const { data: siguienteHes, error: hesError } = await db.rpc("siguiente_numero_hes", { p_empresa_id: filaActual?.empresa_id || 1 });
          if (hesError) return res.status(500).json({ error: hesError.message });
          fields.numero_hes = String(siguienteHes).padStart(8, "0");
        }
      }
      if (body.estado === "Facturada" && !body.numero_factura) {
```
Insertar un bloque nuevo justo entre el cierre del primer `if` y el segundo,
quedando así:
```js
      if (body.estado === "Aprobada") {
        session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
        if (!session || session.nivel_aprobacion !== 1) {
          return res.status(403).json({ error: "No tienes nivel de aprobación para aprobar órdenes de compra" });
        }
        // El cliente puede generar y enviar su propio numero_hes junto con
        // el PDF ya regenerado con ese mismo HES (para que el correo de
        // aprobacion salga con el PDF correcto desde el primer envio, sin
        // un segundo paso). Si no lo manda, se pide aqui el siguiente
        // correlativo real (ver Task 1 / siguiente_numero_hes).
        if (body.numero_hes) {
          fields.numero_hes = body.numero_hes;
        } else {
          const { data: filaActual } = await db.from("ordenes_compra").select("empresa_id").eq("id", id).maybeSingle();
          const { data: siguienteHes, error: hesError } = await db.rpc("siguiente_numero_hes", { p_empresa_id: filaActual?.empresa_id || 1 });
          if (hesError) return res.status(500).json({ error: hesError.message });
          fields.numero_hes = String(siguienteHes).padStart(8, "0");
        }
      }
      if (body.estado === "Pendiente aprobación") {
        // "Desaprobar": revertir una OC ya Aprobada de vuelta a Pendiente
        // aprobación, para poder corregirla y volver a aprobarla (mismo N°
        // de OC, mismo HES -- ninguno de los dos se toca aqui, solo cambia
        // el estado). Requiere el mismo nivel que se usa para aprobar. No se
        // permite si ya paso a Facturada/Completada (ahi solo cabe Anular).
        const { data: filaActual } = await db.from("ordenes_compra").select("estado").eq("id", id).maybeSingle();
        if (filaActual && filaActual.estado === "Aprobada") {
          session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
          if (!session || session.nivel_aprobacion !== 1) {
            return res.status(403).json({ error: "No tienes nivel de aprobación para desaprobar órdenes de compra" });
          }
        } else if (filaActual && !["Borrador", "Pendiente aprobación"].includes(filaActual.estado)) {
          return res.status(403).json({ error: "Esta OC ya no se puede devolver a Pendiente aprobación" });
        }
      }
      if (body.estado === "Facturada" && !body.numero_factura) {
```

- [ ] **Step 2: Validar sintaxis**

Run: `node --check api/ordenes.js`
Expected: sin salida (sintaxis OK).

- [ ] **Step 3: Commit y desplegar**

```bash
git add api/ordenes.js
git commit -m "feat: permitir desaprobar una OC (Aprobada -> Pendiente aprobacion) con el mismo nivel que aprobar"
git push
```

- [ ] **Step 4: Verificar en vivo que el caso benigno (no-Aprobada) sigue funcionando**

Esperar ~30-40s el redeploy. Crear una OC de prueba en "Pendiente aprobación"
(no llegar a "Aprobada" en este task — eso se prueba con sesión real en
Task 4, ver ese task para el porqué):

```powershell
$bodyBorrador = @{ proveedor_id = "5d459c0e-8d9b-4af7-91b9-164fc9a53eca"; empresa_id = 1; estado = "Pendiente aprobación"; fecha = "2026-09-29"; titulo = "Prueba desaprobar"; moneda = "CLP"; monto_neto = 50000; monto_iva = 9500; monto_total = 59500 } | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText("$env:TEMP\test_desaprobar_crear.json", $bodyBorrador, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -sS -X POST "https://ocfast.vercel.app/api/ordenes" -H "Content-Type: application/json" --data "@$env:TEMP\test_desaprobar_crear.json"
```
Anotar el `id`. Sin cookie, PUT con `{"estado":"Pendiente aprobación"}` sobre
esa misma fila (que ya está en ese estado):
```powershell
$bodyDesaprobar = @{ estado = "Pendiente aprobación" } | ConvertTo-Json
[System.IO.File]::WriteAllText("$env:TEMP\test_desaprobar_intento.json", $bodyDesaprobar, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -sS -X PUT "https://ocfast.vercel.app/api/ordenes?id=<id>" -H "Content-Type: application/json" --data "@$env:TEMP\test_desaprobar_intento.json"
```
Expected: 200, sin exigir sesión (la fila no estaba en "Aprobada", cae en el
caso benigno) — confirma que el bloque nuevo no le agregó una exigencia de
sesión a un caso que no la necesitaba antes.

Limpiar la OC de prueba (soft-delete) vía `mcp__claude_ai_Supabase__execute_sql`
(project_id `kvzcmmcbzlcrvtvfjxaj`):
```sql
update ordenes_compra set activo=false, eliminado_por='desaprobar-test', eliminado_en=now() where id='<id>';
```

---

### Task 2: Frontend — botón "Desaprobar" en el listado

**Files:**
- Modify: `index.html` (componente `OrdenesList`)

- [ ] **Step 1: Agregar la función `desaprobarOrden`**

Buscar en `index.html`, dentro de `OrdenesList`, la función `eliminarOrden`
(justo antes de `ordenesConVisible`):
```js
  const eliminarOrden = async (o) => {
    if (!puedeAprobar) {
      notify("err", "Solo un administrador puede eliminar órdenes de compra.");
      return;
    }
    if (!window.confirm("¿Eliminar la OC " + (o.numero_oc_acquisys || o.numero_oc) + "? Dejará de verse en OCFast y en los informes.")) return;
    try {
      await api("ordenes?id=" + o.id, { method: "DELETE" });
      notify("ok", "OC " + o.numero_oc + " eliminada");
      refreshOrdenes();
    } catch (e) {
      notify("err", e.message);
    }
  };
```
Agregar, inmediatamente después de esa función (antes de `const ordenesConVisible = ...`):
```js

  const desaprobarOrden = async (o) => {
    if (!window.confirm("¿Desaprobar la OC " + (o.numero_oc_acquisys || o.numero_oc) + "? Volverá a estado Pendiente aprobación y se podrá editar de nuevo.")) return;
    try {
      await api("ordenes?id=" + o.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "Pendiente aprobación" }),
      });
      notify("ok", "OC " + o.numero_oc + " devuelta a Pendiente aprobación");
      refreshOrdenes();
    } catch (e) {
      notify("err", e.message);
    }
  };
```

- [ ] **Step 2: Agregar el botón en la columna "Acción"**

Buscar:
```js
      render: (o) => o.estado === "Pendiente aprobación"
        ? (puedeAprobar
            ? h("button", { className: "btn-ghost", style: { padding: "4px 10px", fontSize: 11 }, onClick: () => setAccion({ orden: o, tipo: "aprobar" }) }, "Aprobar")
            : h("span", { className: "hint" }, "Requiere aprobador"))
        : o.estado === "Aprobada"
        ? h("button", { className: "btn-ghost", style: { padding: "4px 10px", fontSize: 11 }, onClick: () => setAccion({ orden: o, tipo: "facturar" }) }, "Facturar")
        : o.estado === "Facturada"
        ? h("button", { className: "btn-ghost", style: { padding: "4px 10px", fontSize: 11 }, onClick: () => setAccion({ orden: o, tipo: "pagar" }) }, "Registrar Pago")
        : "—",
```
Reemplazar por:
```js
      render: (o) => o.estado === "Pendiente aprobación"
        ? (puedeAprobar
            ? h("button", { className: "btn-ghost", style: { padding: "4px 10px", fontSize: 11 }, onClick: () => setAccion({ orden: o, tipo: "aprobar" }) }, "Aprobar")
            : h("span", { className: "hint" }, "Requiere aprobador"))
        : o.estado === "Aprobada"
        ? h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
            h("button", { className: "btn-ghost", style: { padding: "4px 10px", fontSize: 11 }, onClick: () => setAccion({ orden: o, tipo: "facturar" }) }, "Facturar"),
            puedeAprobar && h("button", { className: "btn-ghost", style: { padding: "4px 10px", fontSize: 11 }, onClick: () => desaprobarOrden(o) }, "Desaprobar"),
          )
        : o.estado === "Facturada"
        ? h("button", { className: "btn-ghost", style: { padding: "4px 10px", fontSize: 11 }, onClick: () => setAccion({ orden: o, tipo: "pagar" }) }, "Registrar Pago")
        : "—",
```

- [ ] **Step 3: Validar sintaxis**

Run: `node "$env:TEMP\check_inline_ocsys.js" "C:\Users\ALEX MELENDEZ\Documents\GitHub\ocfast\index.html"`
Expected: `inline script 1: OK (...)`

- [ ] **Step 4: Commit y desplegar**

```bash
git add index.html
git commit -m "feat: boton Desaprobar en el listado de OC (Aprobada -> Pendiente aprobacion)"
git push
```

---

### Task 3: Frontend — reutilizar el HES existente al re-aprobar

**Files:**
- Modify: `index.html` (componente `OrdenAccionModal`, función `submit`)

- [ ] **Step 1: Reemplazar la línea de obtención del HES**

Buscar en `index.html`:
```js
        if (!orden.numero_oc_acquisys) {
          const proveedor = (proveedores || []).find((p) => p.id === orden.proveedor_id);
          if (proveedor) {
            const { numero_hes: numeroHes } = await api("ordenes?siguiente_hes=1&empresa_id=" + orden.empresa_id, { timeoutMs: 15000 });
            const pdfBlob = await generarPdfOC({ ...orden, numero_hes: numeroHes }, proveedor, orden.cuotas || [], empresa);
```
Reemplazar por:
```js
        if (!orden.numero_oc_acquisys) {
          const proveedor = (proveedores || []).find((p) => p.id === orden.proveedor_id);
          if (proveedor) {
            // Si la OC ya tenia un HES (se esta re-aprobando despues de un
            // Desaprobar), se reutiliza el mismo -- solo se pide uno nuevo
            // la primera vez que se aprueba.
            const numeroHes = orden.numero_hes || (await api("ordenes?siguiente_hes=1&empresa_id=" + orden.empresa_id, { timeoutMs: 15000 })).numero_hes;
            const pdfBlob = await generarPdfOC({ ...orden, numero_hes: numeroHes }, proveedor, orden.cuotas || [], empresa);
```

- [ ] **Step 2: Validar sintaxis**

Run: `node "$env:TEMP\check_inline_ocsys.js" "C:\Users\ALEX MELENDEZ\Documents\GitHub\ocfast\index.html"`
Expected: `inline script 1: OK (...)`

- [ ] **Step 3: Commit y desplegar**

```bash
git add index.html
git commit -m "feat: reutilizar el mismo HES al re-aprobar una OC desaprobada, en vez de pedir uno nuevo"
git push
```

---

### Task 4: Verificación end-to-end real

**Files:** ninguno (solo verificación).

**Nota importante para quien ejecute este task:** los pasos de aprobar/
desaprobar requieren una sesión real autenticada con `nivel_aprobacion === 1`
(cookie `ocsys_token` válida) — esto NO se puede obtener por `curl` sin una
contraseña real de un usuario, y este plan no tiene (ni debe pedir)
credenciales de nadie. Por lo tanto:

- La parte que SÍ requiere sesión autenticada (aprobar, desaprobar, verificar
  que el HES no cambia, verificar que el correo se envía) se deja como
  **verificación manual en el navegador para el humano a cargo del proyecto**
  — no la ejecute un subagente vía curl.
- Lo que el subagente SÍ puede y debe verificar por su cuenta, sin sesión:
  que el código nuevo (Task 1) compila y tiene la lógica correcta leyendo el
  archivo con cuidado (ya se validó en el Step 5 de Task 1), y que sin cookie
  un intento de aprobar o desaprobar sigue devolviendo 403 (esto sí se puede
  probar por curl, sin sesión, y confirma que el guard nuevo no abrió un
  hueco de seguridad).

- [ ] **Step 1 (subagente, sin sesión): confirmar que aprobar/desaprobar sin cookie sigue dando 403**

Crear una OC de prueba en "Pendiente aprobación" vía POST (proveedor
`5d459c0e-8d9b-4af7-91b9-164fc9a53eca`, empresa_id 1, incluir `fecha`).
Sin ninguna cookie, intentar `PUT ?id=<id>` con `{"estado":"Aprobada"}` →
esperado 403 "No tienes nivel de aprobación..." (comportamiento ya existente,
sin cambios). Como esta fila nunca llegó a "Aprobada" (el intento de arriba
fue rechazado), un segundo PUT sin cookie con
`{"estado":"Pendiente aprobación"}` cae en el caso benigno (la fila ya está
en Pendiente) y responde 200 sin exigir sesión — confirma que el bloque
nuevo no le exige sesión a un caso que no la necesitaba antes. Limpiar esta
fila de prueba (soft-delete) al terminar.

- [ ] **Step 2 (humano, en el navegador): ciclo completo con sesión real**

1. Genera o usa una OC de prueba con el proveedor "Alex Services (TEST)"
   (su `contacto_correo` es la propia casilla del desarrollador — un correo
   de prueba aquí no llega a un proveedor real).
2. Apruébala normalmente. Anota el N° de HES que le asigna.
3. Con un usuario que tenga nivel de aprobador, haz clic en el nuevo botón
   "Desaprobar". Confirma que vuelve a "Pendiente aprobación" y que el ✏️
   Editar ya está disponible.
4. Edita algo (ej. el título) y guarda — confirma que ahora sí se puede
   (antes, Aprobada, esto daba error).
5. Vuelve a aprobarla. Confirma que el N° de HES es el mismo que en el paso
   2 (no cambió), y que llega el correo de aprobación normal.
6. Borra la OC de prueba cuando termines (botón Eliminar, requiere nivel de
   aprobador).
