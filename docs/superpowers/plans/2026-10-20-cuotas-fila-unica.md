# OC en cuotas — fila única con chips de aprobación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En el listado de Órdenes (`OrdenesList`), una OC con más de 1 cuota se ve y se gestiona como **1 sola fila** (sin expandir, sin sufijo `-1`/`-2` visible), con un círculo por cuota para aprobar/facturar/pagar cada una sin salir de la fila. El PDF de la OC pasa a listar siempre las N cuotas completas con su Estado y Fecha de Emisión.

**Architecture:** Cambio de presentación puro — no se toca `ordenes_compra` (sigue con N filas independientes, mismo PUT/estado/HES/factura/pago de siempre, ver `docs/superpowers/specs/2026-09-29-ordenes-en-cuotas-design.md`). Se elimina el mecanismo de expandir/colapsar en `OrdenesList`; se agrega un widget de círculos que lee `o._hijos` (ya calculado hoy por `filasAgrupadas`, sin fetch nuevo) y reusa `OrdenAccionModal` tal cual, solo pasándole la fila-cuota correcta y (cuando aplica) la lista de hermanas para el PDF consolidado. `generarPdfOC`/`generarYAdjuntarPdf` ganan un parámetro opcional `hermanos` para construir la tabla completa en vez de la fila única de hoy.

**Tech Stack:** React sin build (`h()`/`useState`) en `index.html`, jsPDF (`generarPdfOC`), Vercel Node.js serverless (`api/ordenes.js`, sin cambios en este plan).

**Nota sobre pruebas:** este proyecto no tiene framework de tests — la verificación es `node --check` sobre el `<script>` extraído de `index.html` (mismo patrón usado toda la sesión) más pruebas manuales contra datos reales. Aprobar una cuota envía un correo real al proveedor, así que la prueba end-to-end del flujo de aprobación se hace contra el proveedor de pruebas ya existente **"Alex Services (TEST)"** (id `5d459c0e-8d9b-4af7-91b9-164fc9a53eca`, empresa 1/Patagónica) con una OC nueva creada solo para la prueba, limpiada después con `activo=false` (soft-delete, nunca un DELETE real). La OC real **PA-OC-00350** (ya en producción, con la cuota 1 ya "Aprobada" y el resto "Pendiente aprobación") se usa **solo para verificar visualmente** que la fila/chips se ven bien con datos mixtos reales — no se le hace ninguna acción de escritura.

---

### Task 1: Quitar expandir/Detalles y agregar los chips de cuota en `OrdenesList`

**Files:**
- Modify: `index.html` (función `OrdenesList`, aprox. líneas 2222-2749 antes de este cambio — confirmar número exacto de línea al editar, pudo correrse por cambios previos en la sesión)

- [ ] **Step 1: Helper `tipoAccionCuota` y componente `CuotasChips`**

Agregar, justo antes de `function OrdenesList(...)` (como función de módulo, reusable):

```js
// Que accion corresponde al clic en el circulo de una cuota, segun su estado
// real -- "Anulada"/"Completada" no tienen accion pendiente (null = el
// circulo no reacciona al clic en ese caso).
function tipoAccionCuota(estado) {
  if (estado === "Pendiente aprobación") return "aprobar";
  if (estado === "Aprobada") return "facturar";
  if (estado === "Facturada") return "pagar";
  return null;
}

// Fila unica con chips: reemplaza el texto "Expandir para gestionar" de hoy.
// Cada circulo es 1 cuota; verde+check = ya paso de "Pendiente aprobacion"
// (Aprobada/Facturada/Completada se ven igual -- el clic decide el paso
// real segun el estado de ESA fila hija). onAccionar recibe (hijo, tipo).
function CuotasChips({ hijos, puedeAprobar, onAccionar }) {
  return h("div", { style: { display: "flex", gap: 5, flexWrap: "wrap" } },
    hijos.map((hijo) => {
      const emitida = hijo.estado !== "Pendiente aprobación";
      const tooltip = (hijo.cuota_observacion || ("Cuota " + hijo.cuota_numero + "/" + hijo.cuota_total))
        + (emitida && hijo.fecha_asignacion ? (" — emitida " + fmtDate(hijo.fecha_asignacion.slice(0, 10))) : "");
      const tipo = tipoAccionCuota(hijo.estado);
      const clickable = puedeAprobar && !!tipo;
      return h("span", {
        key: hijo.id, title: tooltip,
        style: {
          width: 22, height: 22, minWidth: 22, borderRadius: "50%", display: "flex",
          alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0,
          cursor: clickable ? "pointer" : "default",
          border: "2px solid " + (emitida ? "var(--green)" : "var(--acc2)"),
          color: emitida ? "var(--green)" : "var(--acc2)",
        },
        onClick: clickable ? () => onAccionar(hijo, tipo) : undefined,
      }, emitida ? "✓" : "");
    }),
  );
}
```

- [ ] **Step 2: Quitar `gruposExpandidos` y el bloque que expande las cuotas hijas en `filasAgrupadas`**

Buscar (dentro de `OrdenesList`):
```js
  const [gruposExpandidos, setGruposExpandidos] = useState({});
```
Eliminar esa línea completa (ya no hace falta — nunca más se expande).

Buscar, dentro del `useMemo` de `filasAgrupadas`:
```js
      if (gruposExpandidos[b]) {
        hijos.forEach((h) => resultado.push({ ...h, _esHijoDeGrupo: true }));
      }
    });
    return resultado;
  }, [ordenesParaAgrupar, hayFiltroActivo, gruposExpandidos]);
```
Reemplazar por (se quita el `if` completo — nunca se agregan filas hijas al resultado — y se quita `gruposExpandidos` del arreglo de dependencias):
```js
    });
    return resultado;
  }, [ordenesParaAgrupar, hayFiltroActivo]);
```

- [ ] **Step 3: Quitar la columna "detalles" por completo**

Buscar y eliminar este bloque completo de la definición de `columns`:
```js
    {
      key: "detalles", label: "Detalles", sortable: false,
      render: (o) => {
        if (o._esGrupo) {
          const expandido = !!gruposExpandidos[o._grupoId];
          return h("button", {
            className: "btn-ghost", title: expandido ? "Ocultar cuotas" : "Ver cuotas",
            style: { padding: "2px 8px", fontSize: 12 },
            onClick: () => setGruposExpandidos((g) => ({ ...g, [o._grupoId]: !g[o._grupoId] })),
          }, expandido ? "▾" : "▸");
        }
        if (o._esHijoDeGrupo) return h("span", { className: "hint" }, "↳");
        return null;
      },
    },
```
(La columna completa desaparece de la tabla — ya no queda ningún rastro de "Detalles"/expandir.)

- [ ] **Step 4: `renderAccion` ya no muestra "Expandir para gestionar"**

Buscar:
```js
  const renderAccion = (o) => o.activo === false ? null : o._esGrupo ? h("span", { className: "hint" }, "Expandir para gestionar") : o.estado === "Pendiente aprobación"
```
Reemplazar por:
```js
  const renderAccion = (o) => o.activo === false ? null : o._esGrupo ? null : o.estado === "Pendiente aprobación"
```
(Para una fila agrupada ya no hay nada que mostrar aquí — la acción ahora vive en los chips de la columna Estado, Step 5.)

- [ ] **Step 5: Columna "Estado" — chips para grupos, pill normal para el resto**

Buscar:
```js
    {
      key: "estado", label: "Estado",
      render: (o) => o.activo === false
        ? h("span", { className: "pill pill-anul" }, "ELIMINADA")
        : o._esGrupo ? h("span", { className: "hint" }, o._indicadorEstados) : estadoPill(o.estado),
    },
```
Reemplazar por:
```js
    {
      key: "estado", label: "Estado",
      render: (o) => o.activo === false
        ? h("span", { className: "pill pill-anul" }, "ELIMINADA")
        : o._esGrupo
        ? h(CuotasChips, {
            hijos: o._hijos, puedeAprobar,
            onAccionar: (hijo, tipo) => setAccion({ orden: hijo, tipo, hermanos: o._hijos }),
          })
        : estadoPill(o.estado),
    },
```

- [ ] **Step 6: Pasar `hermanos` al abrir `OrdenAccionModal`**

Buscar, en el `return` de `OrdenesList` (donde se renderiza el modal):
```js
    accion && h(OrdenAccionModal, {
      orden: accion.orden, tipo: accion.tipo, notify, proveedores, empresa, currentUser,
      onClose: () => setAccion(null),
      onDone: () => { refreshOrdenes(); setAccion(null); },
    }),
```
Reemplazar por (se agrega `hermanos: accion.hermanos`; para el flujo normal de 1 sola cuota `accion.hermanos` es `undefined`, sin cambio de comportamiento):
```js
    accion && h(OrdenAccionModal, {
      orden: accion.orden, tipo: accion.tipo, hermanos: accion.hermanos, notify, proveedores, empresa, currentUser,
      onClose: () => setAccion(null),
      onDone: () => { refreshOrdenes(); setAccion(null); },
    }),
```

- [ ] **Step 7: Validar sintaxis**

Correr el extractor de siempre y `node --check`:
```powershell
& "C:\Program Files\nodejs\node.exe" "$env:TEMP\claude\C--Users-ALEX-MELENDEZ\669caecb-f9d3-4d40-b9de-7a83a1204d38\scratchpad\extract.js"
& "C:\Program Files\nodejs\node.exe" --check "$env:TEMP\claude\C--Users-ALEX-MELENDEZ\669caecb-f9d3-4d40-b9de-7a83a1204d38\scratchpad\extracted.js"
```
Esperado: sin salida de error (si el extractor/scratchpad de esta sesión ya no existe, extraer el `<script>...</script>` de `index.html` a un `.js` suelto con cualquier script corto de Node y correr `node --check` sobre ese archivo).

- [ ] **Step 8: Commit**

```powershell
$git = "C:\Users\ALEX MELENDEZ\AppData\Local\GitHubDesktop\app-3.6.5\resources\app\git\cmd\git.exe"
& $git add index.html
& $git commit -m "Ordenes: fila unica con chips de aprobacion por cuota (quita expandir/Detalles)"
```
(El `push` se deja para el final del Task 3, cuando el conjunto completo de cambios esté validado — o se puede pushear aquí también si se prefiere ir confirmando en el repo remoto paso a paso; este proyecto no usa ramas, todo va directo a `main`.)

---

### Task 2: PDF consolidado — `generarPdfOC` y `generarYAdjuntarPdf`

**Files:**
- Modify: `index.html` (funciones `generarPdfOC` y `generarYAdjuntarPdf`, antes de `OrdenesList`)

- [ ] **Step 1: Tabla de cuotas completa en `generarPdfOC`**

Buscar:
```js
  doc.setFontSize(20); doc.setTextColor(140);
  doc.text("Orden de Compra #" + (orden.numero_oc_acquisys || orden.numero_oc), left, 82);
  if (orden.cuota_total) {
    doc.setFontSize(11); doc.setTextColor(140);
    doc.text("Cuota " + orden.cuota_numero + " de " + orden.cuota_total, right, 82, { align: "right" });
  }
```
Reemplazar por (ya no se anota "Cuota N de M" en el encabezado — el PDF ahora siempre representa el grupo completo; el numero base se obtiene quitando el sufijo `-N` si `orden.numero_oc` lo trae):
```js
  const numeroOcBase = orden.cuota_total ? orden.numero_oc.replace(/-\d+$/, "") : orden.numero_oc;
  doc.setFontSize(20); doc.setTextColor(140);
  doc.text("Orden de Compra #" + (orden.numero_oc_acquisys || numeroOcBase), left, 82);
```

Buscar:
```js
  // Una OC dividida en cuotas (filas independientes, cada una con su propio
  // monto/HES/factura) no trae el detalle de TODAS las cuotas en "cuotas"
  // (eso quedaria vacio, ver _cuotas.js) -- se arma una sola fila mostrando
  // nada mas la posicion de ESTA fila (ej. "1/6"), nunca el resto.
  const rows = orden.cuota_total
    ? [[
        "0", orden.cuota_numero + "/" + orden.cuota_total,
        Math.round(100 / orden.cuota_total) + " %",
        moneda + " " + fmtMontoPdf(orden.monto_neto, moneda),
      ]]
    : (cuotas || []).map((c) => [String(c.dias || 0), c.observacion || "", (c.porcentaje || 0) + " %", moneda + " " + fmtMontoPdf(c.monto, moneda)]);
  doc.autoTable({
    startY: 140, margin: { left, right: 210 - right },
    head: [["Días de Pago", "Observación", "Porcentaje", "Monto"]],
    body: rows,
    foot: [["Precio Total Neto", "", "", moneda + " " + fmtMontoPdf(orden.monto_neto, moneda)]],
    theme: "plain",
    styles: { fontSize: 9, textColor: 40 },
    headStyles: { fontStyle: "bold", lineWidth: { bottom: 0.3 }, lineColor: 200 },
    footStyles: { fontStyle: "bold", textColor: 40, lineWidth: { top: 0.3 }, lineColor: 200 },
  });
```
Reemplazar por (si viene `hermanos` -- fila dividida en cuotas con sus hermanas ya cargadas -- se listan TODAS con Estado y Fecha Emisión; si no, se mantiene el camino de siempre para OC de 1 sola cuota con el jsonb `cuotas`):
```js
  const rows = hermanos
    ? hermanos
        .slice()
        .sort((a, b) => (a.cuota_numero || 0) - (b.cuota_numero || 0))
        .map((h) => [
          h.cuota_numero + "/" + h.cuota_total,
          h.cuota_observacion || "",
          Math.round(((Number(h.monto_neto) || 0) / (Number(orden.monto_neto_grupo) || Number(orden.monto_neto) || 1)) * 100) + " %",
          moneda + " " + fmtMontoPdf(h.monto_neto, moneda),
          h.estado === "Pendiente aprobación" ? "Pendiente" : "Emitida",
          h.fecha_asignacion ? fmtDate(h.fecha_asignacion.slice(0, 10)) : "—",
        ])
    : (cuotas || []).map((c) => [String(c.dias || 0), c.observacion || "", (c.porcentaje || 0) + " %", moneda + " " + fmtMontoPdf(c.monto, moneda)]);
  const montoTotalGrupo = hermanos
    ? hermanos.reduce((sum, h) => sum + (Number(h.monto_neto) || 0), 0)
    : Number(orden.monto_neto) || 0;
  doc.autoTable({
    startY: 140, margin: { left, right: 210 - right },
    head: hermanos
      ? [["Cuota", "Observación", "Porcentaje", "Monto", "Estado", "Fecha Emisión"]]
      : [["Días de Pago", "Observación", "Porcentaje", "Monto"]],
    body: rows,
    foot: hermanos
      ? [["Precio Total Neto", "", "", moneda + " " + fmtMontoPdf(montoTotalGrupo, moneda), "", ""]]
      : [["Precio Total Neto", "", "", moneda + " " + fmtMontoPdf(orden.monto_neto, moneda)]],
    theme: "plain",
    styles: { fontSize: 9, textColor: 40 },
    headStyles: { fontStyle: "bold", lineWidth: { bottom: 0.3 }, lineColor: 200 },
    footStyles: { fontStyle: "bold", textColor: 40, lineWidth: { top: 0.3 }, lineColor: 200 },
  });
```

Buscar la firma de la función y agregar el parámetro nuevo (al final, opcional — no rompe ninguna llamada existente que no lo pase):
```js
async function generarPdfOC(orden, proveedor, cuotas, empresa) {
```
Reemplazar por:
```js
async function generarPdfOC(orden, proveedor, cuotas, empresa, hermanos) {
```

- [ ] **Step 2: `generarYAdjuntarPdf` arma el PDF una sola vez y actualiza TODAS las filas hermanas**

Buscar:
```js
async function generarYAdjuntarPdf(ordenFila, proveedor, empresa) {
  const pdfBlob = await generarPdfOC(ordenFila, proveedor, ordenFila.cuotas || [], empresa);
  const pdfBase64 = await fileToBase64(new File([pdfBlob], "OC.pdf", { type: "application/pdf" }));
  const up = await api("upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: ordenFila.numero_oc + ".pdf", base64: pdfBase64 }),
    timeoutMs: 25000,
  });
  await api("ordenes?id=" + ordenFila.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archivo_oc_url: up.url, archivo_oc_nombre: ordenFila.numero_oc + ".pdf" }),
    timeoutMs: 25000,
  });
```
Reemplazar por (agrega el parámetro `hermanos`; cuando está presente, genera UN solo PDF consolidado y lo guarda en TODAS las filas del grupo, en vez de un PDF distinto por cada una):
```js
async function generarYAdjuntarPdf(ordenFila, proveedor, empresa, hermanos) {
  const esGrupo = Array.isArray(hermanos) && hermanos.length > 1;
  const nombreArchivo = (esGrupo ? ordenFila.numero_oc.replace(/-\d+$/, "") : ordenFila.numero_oc) + ".pdf";
  const pdfBlob = await generarPdfOC(ordenFila, proveedor, ordenFila.cuotas || [], empresa, esGrupo ? hermanos : undefined);
  const pdfBase64 = await fileToBase64(new File([pdfBlob], "OC.pdf", { type: "application/pdf" }));
  const up = await api("upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: nombreArchivo, base64: pdfBase64 }),
    timeoutMs: 25000,
  });
  const filasAActualizar = esGrupo ? hermanos : [ordenFila];
  for (const fila of filasAActualizar) {
    await api("ordenes?id=" + fila.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archivo_oc_url: up.url, archivo_oc_nombre: nombreArchivo }),
      timeoutMs: 25000,
    });
  }
}
```
(La función no tenía ningún `return` ni código después del `PUT` — termina ahí mismo con el `}` de cierre, como se muestra arriba.)

- [ ] **Step 3: Validar sintaxis**

Mismo comando que Task 1 Step 7.

- [ ] **Step 4: Commit**

```powershell
& $git add index.html
& $git commit -m "PDF de OC: tabla consolidada de cuotas (Estado + Fecha Emision) cuando hay mas de 1"
```

---

### Task 3: Conectar el PDF consolidado en los 3 puntos donde se genera/regenera

**Files:**
- Modify: `index.html` (`NuevaOC.submit`, `EditarOrdenModal.generarOrden`, `OrdenAccionModal.submit`)

**Fuera de alcance, a propósito:** existe un 4to llamado a `generarPdfOC` dentro de
`SincronizarAcquisys` (herramienta manual de administración que rellena el PDF de
cualquier OC que no tenga `archivo_oc_url`, mayormente pensada para las OC
importadas de Acquisys). Se deja sin tocar — sigue generando un PDF de 1 sola fila
si alguna vez corre sobre una OC nativa dividida en cuotas sin PDF, caso raro dado
que `NuevaOC`/`EditarOrdenModal` ya le asignan su PDF al crearla. Si se quiere
cubrir también ese caso, es una mejora aparte.

- [ ] **Step 1: `NuevaOC.submit` — generar 1 PDF consolidado en vez de N**

Buscar (dentro de `submit`, rama `estado === "Pendiente aprobación"`):
```js
      if (estado === "Pendiente aprobación") {
        const proveedor = proveedores.find((p) => p.id === form.proveedor_id);
        for (const ordenFila of ordenesCreadas) {
          await generarYAdjuntarPdf(ordenFila, proveedor, empresa);
        }
      }
```
Reemplazar por (si hay más de 1 fila creada, son las N cuotas del mismo grupo — se genera 1 solo PDF consolidado, no uno por fila):
```js
      if (estado === "Pendiente aprobación") {
        const proveedor = proveedores.find((p) => p.id === form.proveedor_id);
        if (ordenesCreadas.length > 1) {
          await generarYAdjuntarPdf(ordenesCreadas[0], proveedor, empresa, ordenesCreadas);
        } else {
          for (const ordenFila of ordenesCreadas) {
            await generarYAdjuntarPdf(ordenFila, proveedor, empresa);
          }
        }
      }
```

- [ ] **Step 2: `EditarOrdenModal.generarOrden` — mismo cambio**

Buscar:
```js
        const ordenesCreadas = respuesta.ordenes;
        sePartioEnCuotas = true;
        if (proveedor) {
          for (const fila of ordenesCreadas) {
            await generarYAdjuntarPdf(fila, proveedor, empresa);
          }
        }
```
Reemplazar por:
```js
        const ordenesCreadas = respuesta.ordenes;
        sePartioEnCuotas = true;
        if (proveedor) {
          await generarYAdjuntarPdf(ordenesCreadas[0], proveedor, empresa, ordenesCreadas);
        }
```

- [ ] **Step 3: `OrdenAccionModal` — recibir `hermanos` y usarlo al aprobar**

Buscar la firma del componente:
```js
function OrdenAccionModal({ orden, tipo, onClose, onDone, notify, proveedores, empresa, currentUser }) {
```
Reemplazar por:
```js
function OrdenAccionModal({ orden, tipo, hermanos, onClose, onDone, notify, proveedores, empresa, currentUser }) {
```

Buscar, dentro de `submit()`, rama `isAprobar`:
```js
        if (!orden.numero_oc_acquisys) {
          const proveedor = (proveedores || []).find((p) => p.id === orden.proveedor_id);
          if (proveedor) {
            // Si la OC ya tenia un HES (se esta re-aprobando despues de un
            // Desaprobar), se reutiliza el mismo -- solo se pide uno nuevo
            // la primera vez que se aprueba.
            const numeroHes = orden.numero_hes || (await api("ordenes?siguiente_hes=1&empresa_id=" + orden.empresa_id, { timeoutMs: 15000 })).numero_hes;
            const pdfBlob = await generarPdfOC({ ...orden, numero_hes: numeroHes, aprobado_por: aprobadoPor }, proveedor, orden.cuotas || [], empresa);
            const pdfBase64 = await fileToBase64(new File([pdfBlob], "OC.pdf", { type: "application/pdf" }));
            const up = await api("upload", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ filename: orden.numero_oc + ".pdf", base64: pdfBase64 }),
            });
            payload.numero_hes = numeroHes;
            payload.archivo_oc_url = up.url;
            payload.archivo_oc_nombre = orden.numero_oc + ".pdf";
          }
        }
```
Reemplazar por (si `hermanos` viene con más de 1 fila, el PDF sale con la tabla completa del grupo -- con ESTA cuota ya marcada como recién aprobada, para que el correo que se envía ahora mismo ya la muestre "Emitida" -- y además se propaga el link a la cuota 1 del grupo, que es la que realmente se ve en el listado):
```js
        if (!orden.numero_oc_acquisys) {
          const proveedor = (proveedores || []).find((p) => p.id === orden.proveedor_id);
          if (proveedor) {
            // Si la OC ya tenia un HES (se esta re-aprobando despues de un
            // Desaprobar), se reutiliza el mismo -- solo se pide uno nuevo
            // la primera vez que se aprueba.
            const numeroHes = orden.numero_hes || (await api("ordenes?siguiente_hes=1&empresa_id=" + orden.empresa_id, { timeoutMs: 15000 })).numero_hes;
            const esGrupo = Array.isArray(hermanos) && hermanos.length > 1;
            const hermanosConEstaAprobada = esGrupo
              ? hermanos.map((h) => h.id === orden.id ? { ...h, estado: "Aprobada", fecha_asignacion: new Date().toISOString() } : h)
              : undefined;
            const nombreArchivo = (esGrupo ? orden.numero_oc.replace(/-\d+$/, "") : orden.numero_oc) + ".pdf";
            const pdfBlob = await generarPdfOC({ ...orden, numero_hes: numeroHes, aprobado_por: aprobadoPor }, proveedor, orden.cuotas || [], empresa, hermanosConEstaAprobada);
            const pdfBase64 = await fileToBase64(new File([pdfBlob], "OC.pdf", { type: "application/pdf" }));
            const up = await api("upload", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ filename: nombreArchivo, base64: pdfBase64 }),
            });
            payload.numero_hes = numeroHes;
            payload.archivo_oc_url = up.url;
            payload.archivo_oc_nombre = nombreArchivo;
            if (esGrupo) {
              const primera = hermanos.find((h) => h.cuota_numero === 1) || hermanos[0];
              if (primera.id !== orden.id) {
                await api("ordenes?id=" + primera.id, {
                  method: "PUT", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ archivo_oc_url: up.url, archivo_oc_nombre: nombreArchivo }),
                });
              }
            }
          }
        }
```

- [ ] **Step 4: Validar sintaxis**

Mismo comando que Task 1 Step 7.

- [ ] **Step 5: Commit**

```powershell
& $git add index.html
& $git commit -m "Conecta el PDF consolidado en creacion y aprobacion de OC en cuotas"
```

---

### Task 4: Verificación manual

**Files:** ninguno — solo pruebas contra el deploy ya pusheado (esperar a que Vercel termine el deploy automático antes de probar).

- [ ] **Step 1: Verificar visualmente PA-OC-00350 (datos reales, estado mixto)**

Entrar a OCFast → Órdenes, buscar "PA-OC-00350". Confirmar:
- Aparece **1 sola fila** (no 6), sin ningún "▸"/"Detalles".
- El N° de OC no muestra ningún sufijo `-1`.
- En la columna Estado se ven **6 círculos**: el primero verde con check (esa cuota ya está "Aprobada" en producción), los otros 5 vacíos con borde azul.
- Al pasar el mouse por el círculo verde, el tooltip muestra la Observación de esa cuota + "— emitida " y una fecha real (no vacía).
- Al pasar el mouse por un círculo azul, el tooltip muestra solo la Observación (o "Cuota N/6" si no tiene).
- Si el usuario logueado tiene `puedeAprobar` (Claudio o Alex): los círculos azules tienen `cursor:pointer`; el verde no (ya no tiene acción pendiente de Facturar/Pagar si sigue en "Aprobada" sin facturar todavía, sí la tendría y SÍ sería clickeable).

No se hace clic en ningún círculo de esta OC real todavía (eso se prueba en el Step 2 con la OC de prueba).

De paso, en esta misma fila de PA-OC-00350, confirmar que "Editar" (abre `EditarGrupoModal` con los datos compartidos de las 6 cuotas), "Duplicar" y "Eliminar" siguen apareciendo y funcionando igual que antes del cambio — ninguno de los tres se tocó en este plan, pero dependían del mismo `_esGrupo`/`_hijos` que ahora también alimenta los chips, así que vale la pena confirmarlo con datos reales.

- [ ] **Step 2: Flujo completo de aprobación con una OC de prueba (sí escribe, pero con el proveedor de pruebas)**

Crear una OC nueva en Nueva OC usando el proveedor **"Alex Services (TEST)"**, con 2 cuotas (ej. 50%/50%, con una Observación distinta en cada una, ej. "Anticipo prueba" y "Saldo prueba"). Generar la OC (botón "Generar OC").

En el listado, confirmar que aparece como 1 sola fila con 2 círculos azules vacíos, y que el link de "N° OC" abre un PDF con la tabla de 2 cuotas, ambas "Pendiente", columna Fecha Emisión en "—".

Hacer clic en el primer círculo azul (requiere estar logueado como Claudio o Alex). Confirmar:
- Se abre el mismo modal de "Aprobar" de siempre (texto "Se asignará automáticamente el N° HES...").
- Al confirmar, el círculo pasa a verde con check.
- El tooltip del círculo verde ahora trae la fecha de hoy.
- El link "N° OC" del listado, al abrirlo de nuevo, muestra el PDF actualizado: cuota 1 "Emitida" con su Fecha Emisión de hoy, cuota 2 sigue "Pendiente" con "—".
- El correo de aprobación llegó al correo de contacto de "Alex Services (TEST)" con ese mismo PDF adjunto (revisar bandeja si corresponde, o al menos confirmar que `correoError` no vino en la respuesta/notificación de la app).

- [ ] **Step 3: Limpiar la OC de prueba**

```sql
update ordenes_compra set activo = false
where numero_oc in (select numero_oc from ordenes_compra where proveedor_id = '5d459c0e-8d9b-4af7-91b9-164fc9a53eca' order by created_at desc limit 2);
```
Ejecutar con `mcp__claude_ai_Supabase__execute_sql` (revisar primero con un `select` el `numero_oc` exacto de las 2 filas recién creadas antes de correr el `update`, para no desactivar una OC de prueba vieja por error).

- [ ] **Step 4: Confirmar que una OC de 1 sola cuota no cambió**

Abrir cualquier OC normal (sin cuotas) en el listado — confirmar que se ve exactamente igual que antes (botón "Aprobar"/"Facturar"/"Registrar Pago" de siempre, sin círculos, columna "Detalles" ya no existe para nadie pero eso no afecta su fila porque nunca tuvo contenido en esa columna).
