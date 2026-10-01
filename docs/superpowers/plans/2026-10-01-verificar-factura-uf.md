# Verificar factura en pesos contra OC en UF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que subir una factura en pesos contra una OC en UF se verifique correctamente (comparando el monto neto en UF, no el total en pesos), que se verifique también el RUT del receptor (la empresa cliente, no solo el proveedor), y que el campo N° Factura deje claro que se completa solo.

**Architecture:** Dos campos nuevos (opcionales) en el schema de extracción de `api/extraer-factura.js`, y una rama nueva en la comparación de `verificarFactura` (`index.html`) que solo se activa cuando la OC está en UF y la IA logró leer un monto en UF — en cualquier otro caso, la lógica existente queda intacta.

**Tech Stack:** Vercel Node.js serverless (ESM, Gemini structured output), React sin build (`h()`) en `index.html`. Sin framework de tests — verificación con `node --check`, el script de sintaxis inline, y una prueba real contra `https://ocfast.vercel.app` usando la factura real ya disponible en `C:\Users\ALEX MELENDEZ\Downloads\Factura 211 El Cortijo 09  CRISAL.pdf` (factura real de INMOBILIARIA CRISAL LTDA para la OC-00236-3, ya validada manualmente: 150 UF netos, RUT emisor 77.191.530-2, RUT receptor 96.673.250-4).

---

### Task 1: Backend — extraer receptor_rut y monto_neto_uf

**Files:**
- Modify: `api/extraer-factura.js`

- [ ] **Step 1: Reemplazar el schema, las instrucciones y el prompt genérico**

Reemplazar el archivo completo `api/extraer-factura.js` por:
```js
import { readJsonBody } from "./_supabase.js";
import { leerDocumentoConFallback } from "./_ia-lectura.js";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    numero_factura: { type: "string", description: "Número o folio de la factura tal como aparece impreso en el documento (ej. 'N°101', 'Factura Electrónica N°304')." },
    proveedor_rut: { type: "string", description: "RUT del emisor de la factura (quien la emite, no quien la recibe), formato XX.XXX.XXX-X" },
    receptor_rut: { type: "string", description: "RUT del RECEPTOR/cliente de la factura (bajo 'Señor(es):', 'Para:', 'Cliente:' o 'Dirigido a:' — el opuesto al proveedor_rut), formato XX.XXX.XXX-X. Si no aparece, usa cadena vacía \"\"." },
    moneda: { type: "string", enum: ["CLP", "USD", "UF"] },
    monto_neto: { type: "number", description: "Monto neto (sin IVA), en la moneda de los totales del documento (normalmente pesos chilenos, aunque el contrato sea en UF)" },
    monto_iva: { type: "number", description: "Monto de IVA, si se indica" },
    monto_total: { type: "number", description: "Monto total de la factura (con IVA)" },
    monto_neto_uf: {
      type: ["number", "null"],
      description: "Si el detalle de la factura muestra una cantidad expresada en UF (ej. columna 'Cantidad' con un valor como '150 UF', junto a un precio unitario que es el valor de la UF del día), el monto neto en UF (ej. 150). Esto es común en facturas chilenas por servicios con contrato en UF, donde los totales igual se emiten en pesos. Si el documento no muestra ningún monto en UF, usa null — no lo inventes ni lo calcules tú mismo.",
    },
  },
  propertyOrdering: ["numero_factura", "proveedor_rut", "receptor_rut", "moneda", "monto_neto", "monto_iva", "monto_total", "monto_neto_uf"],
  required: ["monto_total"],
};

const INSTRUCCIONES = "Este es un documento de factura (electrónica o física) emitida por un proveedor a una empresa cliente (Patagónica Inmobiliaria, Campo Mar SPA o Evox/Sánchez Hermanos SpA). El documento muestra DOS RUT distintos: el del EMISOR/proveedor (generalmente en el encabezado o membrete) y el del RECEPTOR/cliente (frecuentemente bajo 'Señor(es):', 'Para:', 'Cliente:' o 'Dirigido a:'). Extrae proveedor_rut SOLO del emisor y receptor_rut SOLO del receptor/cliente — NUNCA los confundas, aunque ambos estén etiquetados simplemente como 'RUT:' cerca de sus respectivos datos. Si alguno de los dos no aparece impreso, usa cadena vacía \"\" para ese campo — no inventes ni copies uno en el otro. Extrae también el número/folio de la factura, la moneda y los montos neto/IVA/total tal como aparecen impresos en los totales del documento (normalmente en pesos, aunque el contrato sea en UF). Si el detalle de la factura muestra además una cantidad expresada en UF (columna 'Cantidad' con algo como '150 UF', con un precio unitario que es el valor de la UF del día), extrae ese monto neto en UF en monto_neto_uf; si no, usa null. No inventes datos que no esten en el documento — si un dato no aparece, usa cadena vacía \"\" (o null para monto_neto_uf).";

const PROMPT_GENERICO = `${INSTRUCCIONES}

Responde ÚNICAMENTE con un objeto JSON (sin texto adicional, sin bloques de código markdown) con exactamente estas claves:
{
  "numero_factura": string, "proveedor_rut": string, "receptor_rut": string,
  "moneda": "CLP" | "USD" | "UF", "monto_neto": number, "monto_iva": number, "monto_total": number,
  "monto_neto_uf": number | null
}`;

const EXT_MIME = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { filename, base64 } = await readJsonBody(req);
  if (!filename || !base64) return res.status(400).json({ error: "filename y base64 son obligatorios" });

  const ext = filename.split(".").pop().toLowerCase();
  const mimeType = EXT_MIME[ext];
  if (!mimeType) {
    return res.status(400).json({ error: "La lectura con IA solo funciona con PDF, JPG o PNG." });
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const emitir = (linea) => { try { res.write(JSON.stringify(linea) + "\n"); } catch (_) {} };

  try {
    const { datos, motor } = await leerDocumentoConFallback({
      promptGemini: INSTRUCCIONES,
      promptGenerico: PROMPT_GENERICO,
      mimeType,
      base64,
      geminiSchema: RESPONSE_SCHEMA,
      geminiModel: "gemini-3.6-flash",
      onProgress: (motorCorto) => emitir({ tipo: "progreso", motor: motorCorto }),
    });
    emitir({ tipo: "resultado", datos, motor });
  } catch (e) {
    emitir({ tipo: "error", error: e.message });
  }
  res.end();
}
```

- [ ] **Step 2: Validar sintaxis**

Run: `node --check api/extraer-factura.js`
Expected: sin salida (sintaxis OK).

- [ ] **Step 3: Commit y desplegar**

```bash
git add api/extraer-factura.js
git commit -m "feat: extraer RUT del receptor y monto neto en UF al leer una factura con IA"
git push
```

- [ ] **Step 4: Verificar en vivo con la factura real**

Esperar ~30-40s el redeploy, luego:
```powershell
$pdfPath = "C:\Users\ALEX MELENDEZ\Downloads\Factura 211 El Cortijo 09  CRISAL.pdf"
$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($pdfPath))
$json = @{ filename = "Factura 211 El Cortijo 09 CRISAL.pdf"; base64 = $base64 } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText("$env:TEMP\test_factura211_v2.json", $json, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -sS -X POST "https://ocfast.vercel.app/api/extraer-factura" -H "Content-Type: application/json" --data "@$env:TEMP\test_factura211_v2.json" --max-time 100
```
Expected (puede variar levemente en formato pero debe incluir estos valores):
`receptor_rut` = algo equivalente a `96.673.250-4` (puede venir con o sin
puntos/guión), `monto_neto_uf` = `150` (no `null`), además de los campos ya
existentes (`numero_factura` ~ "211", `proveedor_rut` ~ "77.191.530-2",
`moneda` = "CLP", `monto_neto` = 6158580, `monto_total` = 7328710). Si
`monto_neto_uf` sale `null` o la llamada falla con un error de schema
(posible incompatibilidad de `type: ["number","null"]` con el `responseSchema`
de Gemini), reportar el error exacto como BLOCKED/DONE_WITH_CONCERNS en vez
de improvisar un schema distinto — este es el único punto de este task con
riesgo real de no funcionar a la primera.

---

### Task 2: Frontend — comparación en UF, RUT del receptor, y placeholder del N° Factura

**Files:**
- Modify: `index.html` (función `verificarFactura` y el campo "N° Factura *" dentro de `OrdenAccionModal`)

- [ ] **Step 1: Reemplazar la lógica de comparación en `verificarFactura`**

Buscar en `index.html`:
```js
      const rutNorm = (r) => (r || "").replace(/[^0-9kK]/g, "").toUpperCase();
      const rutProveedor = orden.proveedores && orden.proveedores.rut;
      const problemas = [];
      if (datos.proveedor_rut && rutProveedor && rutNorm(datos.proveedor_rut) !== rutNorm(rutProveedor)) {
        problemas.push("el RUT del emisor (" + datos.proveedor_rut + ") no coincide con el proveedor de la OC (" + rutProveedor + ")");
      }
      if (datos.moneda && orden.moneda && datos.moneda !== orden.moneda) {
        problemas.push("la moneda de la factura (" + datos.moneda + ") no coincide con la de la OC (" + orden.moneda + ")");
      }
      if (datos.monto_total != null && orden.monto_total != null) {
        const tolerancia = Math.max(1, Number(orden.monto_total) * 0.01);
        if (Math.abs(Number(datos.monto_total) - Number(orden.monto_total)) > tolerancia) {
          problemas.push("el monto de la factura (" + fmtMontoMoneda(datos.monto_total, datos.moneda || orden.moneda) + ") no coincide con el de la OC (" + fmtMontoMoneda(orden.monto_total, orden.moneda) + ")");
        }
      }
```
Reemplazar por:
```js
      const rutNorm = (r) => (r || "").replace(/[^0-9kK]/g, "").toUpperCase();
      const rutProveedor = orden.proveedores && orden.proveedores.rut;
      const problemas = [];
      if (datos.proveedor_rut && rutProveedor && rutNorm(datos.proveedor_rut) !== rutNorm(rutProveedor)) {
        problemas.push("el RUT del emisor (" + datos.proveedor_rut + ") no coincide con el proveedor de la OC (" + rutProveedor + ")");
      }
      if (datos.receptor_rut && empresa?.rut && rutNorm(datos.receptor_rut) !== rutNorm(empresa.rut)) {
        problemas.push("el RUT del receptor en la factura (" + datos.receptor_rut + ") no corresponde a " + (empresa?.nombre || "esta empresa") + " (" + empresa.rut + ")");
      }
      // Las facturas chilenas (SII) siempre emiten sus totales en pesos, aunque
      // el contrato/OC este en UF -- el valor en UF solo aparece en el detalle
      // (cantidad en UF x valor de la UF del dia). Si la IA logro leer ese
      // monto neto en UF, se compara neto-a-neto en UF (inmune al valor de la
      // UF del dia de la factura) en vez de comparar el total en pesos contra
      // el total en UF, que siempre daria un falso "no coincide".
      if (orden.moneda === "UF" && datos.monto_neto_uf != null) {
        const tolerancia = Math.max(0.5, Number(orden.monto_neto) * 0.01);
        if (Math.abs(Number(datos.monto_neto_uf) - Number(orden.monto_neto)) > tolerancia) {
          problemas.push("el monto neto de la factura (UF " + datos.monto_neto_uf + ") no coincide con el de la OC (UF " + orden.monto_neto + ")");
        }
      } else {
        if (datos.moneda && orden.moneda && datos.moneda !== orden.moneda) {
          problemas.push("la moneda de la factura (" + datos.moneda + ") no coincide con la de la OC (" + orden.moneda + ")");
        }
        if (datos.monto_total != null && orden.monto_total != null) {
          const tolerancia = Math.max(1, Number(orden.monto_total) * 0.01);
          if (Math.abs(Number(datos.monto_total) - Number(orden.monto_total)) > tolerancia) {
            problemas.push("el monto de la factura (" + fmtMontoMoneda(datos.monto_total, datos.moneda || orden.moneda) + ") no coincide con el de la OC (" + fmtMontoMoneda(orden.monto_total, orden.moneda) + ")");
          }
        }
      }
```

- [ ] **Step 2: Agregar el placeholder al campo N° Factura**

Buscar:
```js
          h(Field, { label: "N° Factura *" }, h("input", { value: numeroFactura, onChange: (e) => setNumeroFactura(e.target.value), autoFocus: true })),
```
Reemplazar por:
```js
          h(Field, { label: "N° Factura *" }, h("input", { value: numeroFactura, onChange: (e) => setNumeroFactura(e.target.value), autoFocus: true, placeholder: "Se completa automáticamente al leer la factura, o ingrésalo a mano" })),
```

- [ ] **Step 3: Validar sintaxis**

Run: `node "$env:TEMP\check_inline_ocsys.js" "C:\Users\ALEX MELENDEZ\Documents\GitHub\ocfast\index.html"`
Expected: `inline script 1: OK (...)`

- [ ] **Step 4: Commit y desplegar**

```bash
git add index.html
git commit -m "feat: verificar factura en UF (neto a neto) y RUT del receptor; placeholder en N de Factura"
git push
```

- [ ] **Step 5: Verificación por lectura de código (sin disparar una factura real)**

Esta función solo corre en el navegador real al subir un archivo dentro del
modal de Facturar — no se puede probar en vivo por curl de forma
significativa (ya se probó el endpoint en Task 1). Verificar por lectura:
- Trazar que para una OC en UF con `monto_neto_uf` extraído (como la
  factura 211 de prueba: `monto_neto_uf=150`, `orden.monto_neto=150` para
  OC-00236-3), la rama nueva se activa, NO agrega el problema de moneda, y
  compara neto-a-neto sin diferencia (0 ≤ tolerancia) → sin discrepancia.
- Trazar que para una OC en CLP (el caso normal de hoy, mayoría de las OC),
  `orden.moneda === "UF"` es falso, así que cae en el `else` con la lógica
  exactamente igual a la de antes — cero cambio de comportamiento ahí.
- Confirmar que `empresa` está en scope dentro de `verificarFactura` (ya es
  un prop del componente `OrdenAccionModal`, usado en otras partes de la
  misma función para `generarPdfOC`).
