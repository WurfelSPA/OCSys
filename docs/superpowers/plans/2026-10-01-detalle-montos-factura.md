# Detalle de montos al facturar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el cuadro "Facturar OC" muestre y guarde el detalle de montos (UF, Neto, Total) con formato legible ($ con separador de miles / UF con decimales), y que la zona de subir el archivo quede primero en el cuadro.

**Architecture:** Dos columnas nuevas en `ordenes_compra` (`monto_facturado_neto`, `monto_facturado_uf` — **ya creadas**, no son parte de este plan), aceptadas genéricamente en el PUT de `api/ordenes.js`, y nuevo estado + reordenamiento en `OrdenAccionModal` (`index.html`).

**Tech Stack:** Vercel Node.js serverless (ESM), React sin build (`h()`) en `index.html`. Sin framework de tests — verificación con `node --check`, el script de sintaxis inline, y una prueba real contra `https://ocfast.vercel.app`.

**Nota:** las columnas `monto_facturado_neto` y `monto_facturado_uf` en `ordenes_compra` ya fueron creadas directamente (numeric, nullable). No hay que repetir esa migración.

---

### Task 1: Backend — aceptar monto_facturado_neto y monto_facturado_uf

**Files:**
- Modify: `api/ordenes.js` (handler PUT)

- [ ] **Step 1: Agregar el manejo genérico de los 2 campos nuevos**

Buscar en `api/ordenes.js`:
```js
    if (body.numero_factura !== undefined) fields.numero_factura = body.numero_factura;
    if (body.monto_facturado !== undefined) fields.monto_facturado = body.monto_facturado;
```
Reemplazar por:
```js
    if (body.numero_factura !== undefined) fields.numero_factura = body.numero_factura;
    if (body.monto_facturado !== undefined) fields.monto_facturado = body.monto_facturado;
    if (body.monto_facturado_neto !== undefined) fields.monto_facturado_neto = body.monto_facturado_neto;
    if (body.monto_facturado_uf !== undefined) fields.monto_facturado_uf = body.monto_facturado_uf;
```

- [ ] **Step 2: Validar sintaxis**

Run: `node --check api/ordenes.js`
Expected: sin salida (sintaxis OK).

- [ ] **Step 3: Commit y desplegar**

```bash
git add api/ordenes.js
git commit -m "feat: aceptar monto_facturado_neto y monto_facturado_uf en el PUT de ordenes"
git push
```

- [ ] **Step 4: Verificar en vivo (PUT directo, sin disparar el correo de Facturar real)**

Esperar ~30-40s el redeploy. Crear una OC de prueba en Borrador (proveedor
`5d459c0e-8d9b-4af7-91b9-164fc9a53eca`, empresa_id 1, **incluir `fecha`**):
```powershell
$bodyBorrador = @{ proveedor_id = "5d459c0e-8d9b-4af7-91b9-164fc9a53eca"; empresa_id = 1; estado = "Borrador"; fecha = "2026-10-01"; titulo = "Prueba monto factura detalle"; moneda = "UF"; monto_neto = 150; monto_iva = 28.5; monto_total = 178.5 } | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText("$env:TEMP\test_montos_crear.json", $bodyBorrador, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -sS -X POST "https://ocfast.vercel.app/api/ordenes" -H "Content-Type: application/json" --data "@$env:TEMP\test_montos_crear.json"
```
Anotar el `id`. Actualizar SOLO los 2 campos nuevos (sin cambiar `estado`,
para no disparar ningún correo ni requerir sesión):
```powershell
$bodyMontos = @{ monto_facturado_neto = 6158580; monto_facturado_uf = 150 } | ConvertTo-Json
[System.IO.File]::WriteAllText("$env:TEMP\test_montos_put.json", $bodyMontos, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -sS -X PUT "https://ocfast.vercel.app/api/ordenes?id=<id>" -H "Content-Type: application/json" --data "@$env:TEMP\test_montos_put.json"
```
Expected: 200, la respuesta trae `monto_facturado_neto: 6158580` y
`monto_facturado_uf: 150` guardados en la fila.

Limpiar la fila de prueba (soft-delete) vía `mcp__claude_ai_Supabase__execute_sql`
(project_id `kvzcmmcbzlcrvtvfjxaj`):
```sql
update ordenes_compra set activo=false, eliminado_por='detalle-montos-test', eliminado_en=now() where id='<id>';
```
**Nunca un DELETE real.**

---

### Task 2: Frontend — reordenar el cuadro y agregar los campos de monto

**Files:**
- Modify: `index.html` (componente `OrdenAccionModal`)

- [ ] **Step 1: Agregar el estado nuevo**

Buscar:
```js
  const [numeroFactura, setNumeroFactura] = useState("");
  const [montoFacturado, setMontoFacturado] = useState("");
```
Reemplazar por:
```js
  const [numeroFactura, setNumeroFactura] = useState("");
  const [montoFacturado, setMontoFacturado] = useState("");
  const [montoNetoFactura, setMontoNetoFactura] = useState("");
  const [montoUfFactura, setMontoUfFactura] = useState("");
```

- [ ] **Step 2: Autocompletar los 2 campos nuevos al verificar la factura con IA**

Buscar:
```js
        if (datos.numero_factura) setNumeroFactura((n) => n || datos.numero_factura);
        if (datos.monto_total != null) setMontoFacturado((m) => m || datos.monto_total);
```
Reemplazar por:
```js
        if (datos.numero_factura) setNumeroFactura((n) => n || datos.numero_factura);
        if (datos.monto_total != null) setMontoFacturado((m) => m || datos.monto_total);
        if (datos.monto_neto != null) setMontoNetoFactura((m) => m || datos.monto_neto);
        if (datos.monto_neto_uf != null) setMontoUfFactura((m) => m || datos.monto_neto_uf);
```

- [ ] **Step 3: Reordenar el cuadro y agregar los campos (sección `isFacturar`)**

Buscar:
```js
      isFacturar &&
        h(React.Fragment, null,
          h(Field, { label: "N° Factura *" }, h("input", { value: numeroFactura, onChange: (e) => setNumeroFactura(e.target.value), autoFocus: true, placeholder: "Se completa automáticamente al leer la factura, o ingrésalo a mano" })),
          h(Field, { label: "Monto Facturado" }, h("input", { type: "number", value: montoFacturado, onChange: (e) => setMontoFacturado(e.target.value), placeholder: orden.monto_total })),
          h(Field, { label: "Factura (PDF/imagen)" },
            h("input", {
              type: "file", id: fileFieldId, style: { display: "none" },
              accept: ".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png",
              onChange: (e) => handleFacturaFile(e.target.files[0] || null),
            })),
          h("label", {
            htmlFor: fileFieldId,
            className: "drop-zone" + (file ? " done" : "") + (dragOver ? " dragover" : ""),
            style: { display: "block" },
            ...fileDropHandlers(handleFacturaFile, setDragOver),
          },
            file ? ("✓ " + file.name) : "Haz clic o arrastra aquí la factura"),
          verificandoFactura && h("div", { className: "hint", style: { marginTop: 6, display: "flex", alignItems: "center", gap: 8 } },
            h("span", { className: "spinner" }), `Verificando factura contra la OC con IA (${motorFactura})...`),
          discrepancia && h("div", {
            className: "notif-err",
            style: { padding: "10px 12px", borderRadius: 8, marginTop: 8, fontSize: 12, lineHeight: 1.5 },
          },
            h("b", null, "⚠ " + discrepancia),
            h("div", { style: { marginTop: 4 } }, "No se puede continuar. Anula esta OC y genera una nueva, o sube la factura correcta."),
          ),
        ),
```
Reemplazar por:
```js
      isFacturar &&
        h(React.Fragment, null,
          h(Field, { label: "Factura (PDF/imagen)" },
            h("input", {
              type: "file", id: fileFieldId, style: { display: "none" },
              accept: ".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png",
              onChange: (e) => handleFacturaFile(e.target.files[0] || null),
            })),
          h("label", {
            htmlFor: fileFieldId,
            className: "drop-zone" + (file ? " done" : "") + (dragOver ? " dragover" : ""),
            style: { display: "block" },
            ...fileDropHandlers(handleFacturaFile, setDragOver),
          },
            file ? ("✓ " + file.name) : "Haz clic o arrastra aquí la factura"),
          verificandoFactura && h("div", { className: "hint", style: { marginTop: 6, display: "flex", alignItems: "center", gap: 8 } },
            h("span", { className: "spinner" }), `Verificando factura contra la OC con IA (${motorFactura})...`),
          h(Field, { label: "N° Factura *" }, h("input", { value: numeroFactura, onChange: (e) => setNumeroFactura(e.target.value), autoFocus: true, placeholder: "Se completa automáticamente al leer la factura, o ingrésalo a mano" })),
          orden.moneda === "UF" && h(Field, { label: "Monto UF" },
            h("input", { type: "number", value: montoUfFactura, onChange: (e) => setMontoUfFactura(e.target.value), placeholder: orden.monto_neto }),
            montoUfFactura !== "" && h("div", { className: "hint", style: { marginTop: 4 } }, fmtMontoMoneda(montoUfFactura, "UF"))),
          h(Field, { label: "Monto Neto ($)" },
            h("input", { type: "number", value: montoNetoFactura, onChange: (e) => setMontoNetoFactura(e.target.value) }),
            montoNetoFactura !== "" && h("div", { className: "hint", style: { marginTop: 4 } }, fmtMoney(montoNetoFactura))),
          h(Field, { label: "Monto Total Facturado ($)" },
            h("input", { type: "number", value: montoFacturado, onChange: (e) => setMontoFacturado(e.target.value), placeholder: orden.monto_total }),
            montoFacturado !== "" && h("div", { className: "hint", style: { marginTop: 4 } }, fmtMoney(montoFacturado))),
          discrepancia && h("div", {
            className: "notif-err",
            style: { padding: "10px 12px", borderRadius: 8, marginTop: 8, fontSize: 12, lineHeight: 1.5 },
          },
            h("b", null, "⚠ " + discrepancia),
            h("div", { style: { marginTop: 4 } }, "No se puede continuar. Anula esta OC y genera una nueva, o sube la factura correcta."),
          ),
        ),
```

- [ ] **Step 4: Enviar los 2 campos nuevos al confirmar**

Buscar:
```js
      } else if (isFacturar) {
        payload = { estado: "Facturada", numero_factura: numeroFactura, monto_facturado: montoFacturado || null };
```
Reemplazar por:
```js
      } else if (isFacturar) {
        payload = {
          estado: "Facturada", numero_factura: numeroFactura,
          monto_facturado: montoFacturado || null,
          monto_facturado_neto: montoNetoFactura || null,
          monto_facturado_uf: orden.moneda === "UF" ? (montoUfFactura || null) : null,
        };
```

- [ ] **Step 5: Validar sintaxis**

Run: `node "$env:TEMP\check_inline_ocsys.js" "C:\Users\ALEX MELENDEZ\Documents\GitHub\ocfast\index.html"`
Expected: `inline script 1: OK (...)`

- [ ] **Step 6: Commit y desplegar**

```bash
git add index.html
git commit -m "feat: mostrar y guardar detalle de montos (UF/Neto/Total) al facturar, subir archivo primero"
git push
```

- [ ] **Step 7: Verificación por lectura de código**

No se puede probar en un navegador real desde este entorno. Verificar por
lectura:
- El orden de los elementos en el JSX nuevo coincide con: archivo primero,
  spinner, N° Factura, Monto UF (condicional), Monto Neto, Monto Total
  Facturado, discrepancia al final.
- `fmtMontoMoneda` y `fmtMoney` ya existen como funciones top-level en el
  archivo (usadas en otras partes) — no hace falta definirlas de nuevo.
- Que el campo "Monto UF" realmente desaparezca (no se renderice, no solo
  quede vacío) cuando `orden.moneda !== "UF"` — confirmar que la expresión
  `orden.moneda === "UF" && h(Field, ...)` se evalúa a `false` (no a un nodo
  vacío) en ese caso, que es como React maneja correctamente "no renderizar
  nada" con `&&`.
- Que `submit()` arma el payload igual que antes para `isAprobar`/`isPagar`
  (no tocado) y que el nuevo payload de `isFacturar` no rompe el resto de la
  función (el `if (file) { ... }` que sigue después de construir `payload`
  no cambia).
