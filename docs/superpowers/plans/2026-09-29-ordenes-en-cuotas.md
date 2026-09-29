# OC con pago en cuotas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando una OC nativa de OCFast (no sincronizada desde Acquisys) se genera con más de 1 cuota, crear N filas independientes en `ordenes_compra` (una por cuota, mismo N° de OC base con sufijo `-1`/`-2`/etc.), cada una con su propio HES correlativo real (reemplazando el timestamp actual, para todas las OC de aquí en adelante) y su propio ciclo de aprobación/factura/pago.

**Architecture:** Cambios aditivos sobre el modelo existente: 2 columnas nuevas en `ordenes_compra` (`cuota_numero`, `cuota_total`), una tabla+función nueva en Postgres para el correlativo de HES (mismo patrón que `contadores_oc`/`siguiente_numero_oc`), un helper JS puro compartido (`api/_cuotas.js`) que calcula los N conjuntos de campos por cuota, y ramas nuevas (aditivas, sin tocar el camino existente de 1 sola cuota) en `api/ordenes.js` (POST y PUT) y en `index.html` (`NuevaOC.submit`, `EditarOrdenModal.generarOrden`, `OrdenAccionModal.submit`, `generarPdfOC`).

**Tech Stack:** Vercel Node.js serverless functions (ESM), Supabase/Postgres (vía MCP `apply_migration`/`execute_sql`), React sin build step (`h()` + `useState`) en `index.html`, jsPDF para los PDF.

**Nota sobre pruebas:** este proyecto no tiene framework de tests ni entorno de staging — todo corre contra la única base de datos/deploy de producción. Igual que el resto de esta sesión, la verificación se hace con: (a) scripts Node sueltos para lógica pura, (b) llamadas SQL envueltas en `begin;...rollback;` para funciones de Postgres (no dejan estado), y (c) pruebas reales contra el deploy vía `curl` para los endpoints, usando el proveedor de pruebas ya existente **"Alex Services (TEST)"** (id `5d459c0e-8d9b-4af7-91b9-164fc9a53eca`, empresa 1/Patagónica) y limpiando después con un `update ... set activo=false` (soft-delete, igual que hace la propia app) — nunca un DELETE real. La aprobación (`estado="Aprobada"`) envía un correo real al proveedor, así que **no se prueba en vivo**: se verifica por separado la función SQL del HES (aislada, con rollback) y el cableado del código se revisa por lectura — es un cambio pequeño y de bajo riesgo (reemplaza `Date.now()` por una llamada a una función ya probada).

---

### Task 1: Correlativo de HES en Postgres

**Files:**
- Ninguno en el repo — cambios de esquema vía Supabase MCP (`mcp__claude_ai_Supabase__apply_migration`, `project_id: kvzcmmcbzlcrvtvfjxaj`).

- [ ] **Step 1: Verificar que las columnas/tabla no existan todavía**

Ejecutar con `mcp__claude_ai_Supabase__execute_sql`:
```sql
select column_name from information_schema.columns
where table_name = 'ordenes_compra' and column_name in ('cuota_numero', 'cuota_total');

select table_name from information_schema.tables where table_name = 'contadores_hes';
```
Esperado: ambas consultas vacías (nada creado todavía).

- [ ] **Step 2: Aplicar la migración**

Ejecutar con `mcp__claude_ai_Supabase__apply_migration`, `name: "hes_correlativo_y_columnas_cuota"`:
```sql
alter table public.ordenes_compra add column cuota_numero integer;
alter table public.ordenes_compra add column cuota_total integer;

create table public.contadores_hes (
  empresa_id integer primary key references public.empresas(id),
  ultimo_numero bigint not null
);

insert into public.contadores_hes (empresa_id, ultimo_numero)
select id, 17903340 from public.empresas;

create or replace function public.siguiente_numero_hes(p_empresa_id integer)
returns bigint
language plpgsql
set search_path to 'public'
as $function$
declare
  v_numero bigint;
begin
  update contadores_hes
  set ultimo_numero = ultimo_numero + 1
  where empresa_id = p_empresa_id
  returning ultimo_numero into v_numero;

  return v_numero;
end;
$function$;
```

- [ ] **Step 3: Verificar la función sin dejar estado (rollback)**

Ejecutar con `mcp__claude_ai_Supabase__execute_sql` (una sola llamada, todo dentro de la misma transacción):
```sql
begin;
select siguiente_numero_hes(1) as primero;
select siguiente_numero_hes(1) as segundo;
select siguiente_numero_hes(2) as campo_mar;
rollback;
```
Esperado: `primero = 17903341`, `segundo = 17903342` (consecutivos dentro de la misma empresa), `campo_mar = 17903341` (cada empresa lleva su propio contador). Como termina en `rollback`, `contadores_hes` queda intacto en `17903340` para las 3 empresas — confirmar con:
```sql
select empresa_id, ultimo_numero from contadores_hes order by empresa_id;
```
Esperado: los 3 en `17903340` todavía.

- [ ] **Step 4: Commit**

No hay archivos que commitear en este paso (cambio solo de base de datos). Continuar directo a Task 2.

---

### Task 2: Helper `calcularFilasCuotas`

**Files:**
- Create: `api/_cuotas.js`
- Test: `C:\Users\ALEX MELENDEZ\AppData\Local\Temp\ocfast_test_cuotas.mjs` (script suelto, no queda en el repo)

- [ ] **Step 1: Escribir el script de verificación (antes de implementar)**

Crear `C:\Users\ALEX MELENDEZ\AppData\Local\Temp\ocfast_test_cuotas.mjs`:
```js
import { calcularFilasCuotas } from "C:/Users/ALEX MELENDEZ/Documents/GitHub/ocfast/api/_cuotas.js";

function assertEqual(actual, esperado, etiqueta) {
  const a = JSON.stringify(actual), e = JSON.stringify(esperado);
  if (a !== e) throw new Error(`FALLO [${etiqueta}]: esperado ${e}, obtuvo ${a}`);
  console.log(`OK: ${etiqueta}`);
}

// 3 cuotas de $100.000 neto c/u (total 300.000 neto, 57.000 iva, 357.000 total)
const cuotas = [
  { dias: 0, observacion: "1/3", monto: 100000, porcentaje: 33 },
  { dias: 0, observacion: "2/3", monto: 100000, porcentaje: 33 },
  { dias: 0, observacion: "3/3", monto: 100000, porcentaje: 34 },
];
const filas = calcularFilasCuotas({ cuotas, montoNeto: 300000, montoIva: 57000, numeroBase: "PA-OC-20260929-00300" });

assertEqual(filas.length, 3, "cantidad de filas");
assertEqual(filas[0].numero_oc, "PA-OC-20260929-00300-1", "sufijo cuota 1");
assertEqual(filas[1].numero_oc, "PA-OC-20260929-00300-2", "sufijo cuota 2");
assertEqual(filas[2].numero_oc, "PA-OC-20260929-00300-3", "sufijo cuota 3");
assertEqual(filas[0].cuota_numero, 1, "cuota_numero fila 1");
assertEqual(filas[0].cuota_total, 3, "cuota_total fila 1");
assertEqual(filas[0].monto_neto, 100000, "monto_neto fila 1");
assertEqual(filas[0].monto_iva, 19000, "monto_iva fila 1 (redondeo proporcional)");
assertEqual(filas[0].monto_total, 119000, "monto_total fila 1");
const sumaIva = filas.reduce((s, f) => s + f.monto_iva, 0);
assertEqual(sumaIva, 57000, "la suma de IVA de las 3 filas da exacto el IVA total (sin perder centavos por redondeo)");

// Cuotas desiguales (caso real de distribuirCuotas: la ultima se lleva el resto)
const cuotasDesiguales = [
  { monto: 33333, observacion: "1/3" }, { monto: 33333, observacion: "2/3" }, { monto: 33334, observacion: "3/3" },
];
const filasDesiguales = calcularFilasCuotas({ cuotas: cuotasDesiguales, montoNeto: 100000, montoIva: 19000, numeroBase: "CM-OC-20260929-00005" });
const sumaNeto = filasDesiguales.reduce((s, f) => s + f.monto_neto, 0);
const sumaIva2 = filasDesiguales.reduce((s, f) => s + f.monto_iva, 0);
assertEqual(sumaNeto, 100000, "suma neto cuotas desiguales");
assertEqual(sumaIva2, 19000, "suma iva cuotas desiguales (exacta pese al redondeo)");

console.log("Todas las verificaciones pasaron.");
```

- [ ] **Step 2: Correr el script para confirmar que falla (el archivo aún no existe)**

Run: `node "C:\Users\ALEX MELENDEZ\AppData\Local\Temp\ocfast_test_cuotas.mjs"`
Expected: FAIL con `Cannot find module '.../api/_cuotas.js'`

- [ ] **Step 3: Implementar `api/_cuotas.js`**

Create `api/_cuotas.js`:
```js
// Reparte el monto (neto/iva) de una OC entre sus N cuotas y arma los campos
// que le corresponden a cada fila cuando se divide en cuotas independientes
// (ver docs/superpowers/specs/2026-09-29-ordenes-en-cuotas-design.md). El IVA
// se reparte proporcionalmente al neto de cada cuota (no siempre es 19% --
// una OC "Exento" puede traer monto_iva=0), y la ultima cuota se lleva el
// resto del redondeo para que la suma de las N filas de exacto el total
// original, nunca mas ni menos por un centavo perdido en el redondeo.
export function calcularFilasCuotas({ cuotas, montoNeto, montoIva, numeroBase }) {
  const netoTotal = Number(montoNeto) || 0;
  const ivaTotal = Number(montoIva) || 0;
  let ivaAcumulado = 0;

  return cuotas.map((c, i) => {
    const esUltima = i === cuotas.length - 1;
    const montoNetoCuota = Number(c.monto) || 0;
    const montoIvaCuota = esUltima
      ? ivaTotal - ivaAcumulado
      : Math.round(netoTotal ? (montoNetoCuota / netoTotal) * ivaTotal : 0);
    ivaAcumulado += montoIvaCuota;

    return {
      numero_oc: numeroBase + "-" + (i + 1),
      monto_neto: montoNetoCuota,
      monto_iva: montoIvaCuota,
      monto_total: montoNetoCuota + montoIvaCuota,
      cuota_numero: i + 1,
      cuota_total: cuotas.length,
    };
  });
}
```

- [ ] **Step 4: Correr el script y confirmar que pasa**

Run: `node "C:\Users\ALEX MELENDEZ\AppData\Local\Temp\ocfast_test_cuotas.mjs"`
Expected: imprime una línea `OK: ...` por cada verificación y termina con `Todas las verificaciones pasaron.`, sin errores.

- [ ] **Step 5: Validar sintaxis y commit**

```bash
node --check api/_cuotas.js
git add api/_cuotas.js
git commit -m "feat: helper calcularFilasCuotas para dividir monto/HES por cuota"
git push
```

---

### Task 3: `api/ordenes.js` — dividir en N filas al crear (POST)

**Files:**
- Modify: `api/ordenes.js:1-3` (imports), `api/ordenes.js:169-222` (handler POST)

- [ ] **Step 1: Agregar el import del helper**

En `api/ordenes.js`, la línea 1 hoy es:
```js
import { supabase, readJsonBody } from "./_supabase.js";
```
Cambiar a:
```js
import { supabase, readJsonBody } from "./_supabase.js";
import { calcularFilasCuotas } from "./_cuotas.js";
```

- [ ] **Step 2: Reemplazar el bloque POST completo**

Reemplazar desde `if (req.method === "POST") {` hasta el `}` que lo cierra (líneas 169-222 del archivo actual) por:
```js
  if (req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.proveedor_id) {
      return res.status(400).json({ error: "proveedor_id es obligatorio" });
    }
    // Se identifica por la sesion (no por lo que mande el cliente) para que
    // quede registrado quien de verdad elaboro la OC en OCSys -- esto es
    // independiente del "Representante de Compra", que es solo un dato de
    // texto libre y puede ser otra persona.
    const session = verifyToken(parseCookie(req.headers.cookie, "ocsys_token"), process.env.SESSION_SECRET || "");
    const empresaId = Number(body.empresa_id) || 1;
    const estado = ESTADOS_OCSYS.includes(body.estado) ? body.estado : "Borrador";
    const cuotas = Array.isArray(body.cuotas) ? body.cuotas : [];

    const { data: empresa, error: empresaError } = await db.from("empresas").select("codigo").eq("id", empresaId).maybeSingle();
    if (empresaError) return res.status(500).json({ error: empresaError.message });
    const { data: siguiente, error: seqError } = await db.rpc("siguiente_numero_oc", { p_empresa_id: empresaId });
    if (seqError) return res.status(500).json({ error: seqError.message });
    const fechaHoy = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const numeroBase = (empresa?.codigo || "OC") + "-OC-" + fechaHoy + "-" + String(siguiente).padStart(5, "0");

    const camposBase = {
      numero_cotizacion: body.numero_cotizacion || null,
      proyecto_id: body.proyecto_id || null,
      creado_por_usuario: session ? session.usuario : null,
      proveedor_id: body.proveedor_id,
      empresa_id: empresaId,
      fecha: body.fecha || undefined,
      titulo: body.titulo || null,
      descripcion: body.descripcion || null,
      condiciones: body.condiciones || null,
      motivo: body.motivo || null,
      gerencia: body.gerencia || null,
      centro_costo_codigo: body.centro_costo_codigo || null,
      cuenta_contable_codigo: body.cuenta_contable_codigo || null,
      tipo_orden: body.tipo_orden || null,
      tipo_compra: body.tipo_compra || null,
      moneda: body.moneda || "CLP",
      estado,
      archivo_url: body.archivo_url || null,
      archivo_nombre: body.archivo_nombre || null,
      creado_por: body.creado_por || null,
    };

    // Una OC con mas de 1 cuota se divide en N filas independientes (mismo
    // numero_oc base + sufijo, cada una con su propio monto/HES/aprobacion) --
    // ver docs/superpowers/specs/2026-09-29-ordenes-en-cuotas-design.md. Con 1
    // sola cuota (o en Borrador) se sigue creando una sola fila, como siempre.
    const dividirEnCuotas = estado === "Pendiente aprobación" && cuotas.length > 1;

    if (!dividirEnCuotas) {
      const { data, error } = await db
        .from("ordenes_compra")
        .insert({
          ...camposBase,
          numero_oc: numeroBase,
          monto_neto: body.monto_neto || null,
          monto_iva: body.monto_iva || null,
          monto_total: body.monto_total || null,
          cuotas,
        })
        .select("*, proveedores(razon_social, rut)")
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ orden: data });
    }

    const filasCuotas = calcularFilasCuotas({ cuotas, montoNeto: body.monto_neto, montoIva: body.monto_iva, numeroBase });
    const filas = filasCuotas.map((f) => ({ ...camposBase, ...f, cuotas: [] }));
    const { data, error } = await db
      .from("ordenes_compra")
      .insert(filas)
      .select("*, proveedores(razon_social, rut)");
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ ordenes: data });
  }
```

- [ ] **Step 3: Validar sintaxis**

Run: `node --check api/ordenes.js`
Expected: sin salida (sintaxis OK).

- [ ] **Step 4: Commit y desplegar**

```bash
git add api/ordenes.js
git commit -m "feat: dividir en N filas al crear una OC con mas de 1 cuota"
git push
```

- [ ] **Step 5: Verificar en vivo contra el deploy (proveedor de pruebas, sin enviar correos)**

Esperar ~30-40s a que Vercel redespliegue. Armar el body sin BOM (usar
`[System.Text.UTF8Encoding($false)]`, igual que se hizo toda la sesión con
`curl.exe` en PowerShell — un BOM rompe `JSON.parse` en `readJsonBody`) y
probar la creación en 3 cuotas:

```powershell
$body = @{
  proveedor_id = "5d459c0e-8d9b-4af7-91b9-164fc9a53eca"
  empresa_id = 1
  estado = "Pendiente aprobación"
  titulo = "Prueba plan cuotas"
  descripcion = "Fila de prueba, se elimina (soft-delete) al terminar"
  moneda = "CLP"
  monto_neto = 300000
  monto_iva = 57000
  monto_total = 357000
  cuotas = @(
    @{ dias = 0; observacion = "1/3"; monto = 100000; porcentaje = 33 },
    @{ dias = 0; observacion = "2/3"; monto = 100000; porcentaje = 33 },
    @{ dias = 0; observacion = "3/3"; monto = 100000; porcentaje = 34 }
  )
} | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText("$env:TEMP\test_post_cuotas.json", $body, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -sS -X POST "https://ocfast.vercel.app/api/ordenes" -H "Content-Type: application/json" --data "@$env:TEMP\test_post_cuotas.json"
```

Expected: JSON con `"ordenes"` (no `"orden"`), un array de 3 objetos, con
`numero_oc` terminando en `-1`, `-2`, `-3` sobre el mismo número base, cada
uno con `cuota_numero`/`cuota_total` (1/3, 2/3, 3/3), `monto_neto` 100000 x2 +
100000 en el último (o el reparto que corresponda), y `monto_iva` sumando
exactamente 57000 entre las 3.

- [ ] **Step 6: Limpiar las filas de prueba (soft-delete, no un DELETE real)**

Copiar los 3 `id` de la respuesta del paso anterior y ejecutar con
`mcp__claude_ai_Supabase__execute_sql`:
```sql
update ordenes_compra
set activo = false, eliminado_por = 'plan-cuotas-test', eliminado_en = now()
where id in ('<id-1>', '<id-2>', '<id-3>');
```
Expected: 3 filas actualizadas. Confirmar que ya no aparecen en el listado
activo con:
```sql
select numero_oc from ordenes_compra where id in ('<id-1>', '<id-2>', '<id-3>') and activo = true;
```
Expected: 0 filas.

---

### Task 4: `api/ordenes.js` — dividir al generar desde Borrador (PUT) + HES real al aprobar + endpoint de HES

**Files:**
- Modify: `api/ordenes.js` (handler PUT, handler GET)

- [ ] **Step 1: Agregar la función `dividirEnCuotasPUT` al final del archivo**

Agregar antes del `export default async function handler(req, res) {` (o
después del cierre de `handler`, cualquiera de los dos funciona por hoisting
de `function`, pero se deja **antes** de `handler` para que quede junto a los
imports al leer el archivo de arriba hacia abajo):

```js
// Convierte la fila actual (Borrador) en la cuota 1, e inserta las cuotas
// 2..N como filas nuevas -- todas comparten los mismos datos de "creacion"
// de la OC (proveedor, titulo, etc.) pero cada una con su propio numero_oc
// (sufijo), monto y ciclo de aprobacion/factura/pago independiente. Ver
// docs/superpowers/specs/2026-09-29-ordenes-en-cuotas-design.md
async function dividirEnCuotasPUT(db, id, body, res) {
  const { data: actual, error: actualError } = await db.from("ordenes_compra").select("*").eq("id", id).maybeSingle();
  if (actualError) return res.status(500).json({ error: actualError.message });
  if (!actual) return res.status(404).json({ error: "OC no encontrada" });
  if (!["Borrador", "Pendiente aprobación"].includes(actual.estado)) {
    return res.status(403).json({ error: "La OC ya fue aprobada y no se puede editar" });
  }

  const filasCuotas = calcularFilasCuotas({
    cuotas: body.cuotas,
    montoNeto: body.monto_neto !== undefined ? body.monto_neto : actual.monto_neto,
    montoIva: body.monto_iva !== undefined ? body.monto_iva : actual.monto_iva,
    numeroBase: actual.numero_oc,
  });

  const campo = (clave, transform) => {
    if (body[clave] === undefined) return actual[clave];
    return transform ? transform(body[clave]) : body[clave];
  };
  const camposComunes = {
    numero_cotizacion: campo("numero_cotizacion"),
    proyecto_id: campo("proyecto_id", (v) => v || null),
    titulo: campo("titulo"),
    descripcion: campo("descripcion"),
    condiciones: campo("condiciones"),
    motivo: campo("motivo"),
    proveedor_id: campo("proveedor_id"),
    centro_costo_codigo: campo("centro_costo_codigo", (v) => v || null),
    cuenta_contable_codigo: campo("cuenta_contable_codigo", (v) => v || null),
    tipo_orden: campo("tipo_orden"),
    tipo_compra: campo("tipo_compra"),
    moneda: campo("moneda"),
    fecha: campo("fecha"),
    archivo_url: campo("archivo_url"),
    archivo_nombre: campo("archivo_nombre"),
    creado_por: campo("creado_por"),
    empresa_id: actual.empresa_id,
    creado_por_usuario: actual.creado_por_usuario,
    gerencia: actual.gerencia,
    estado: "Pendiente aprobación",
    cuotas: [],
  };

  const selectCompleto = "*, proveedores(razon_social, rut, contacto_correo, banco, tipo_cuenta, numero_cuenta), empresas(correo_contabilidad), proyectos(nombre)";
  const [primera, ...resto] = filasCuotas;

  const { data: filaActualizada, error: updateError } = await db
    .from("ordenes_compra")
    .update({ ...camposComunes, ...primera, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(selectCompleto)
    .single();
  if (updateError) return res.status(500).json({ error: updateError.message });

  let filasNuevas = [];
  if (resto.length) {
    const { data: insertadas, error: insertError } = await db
      .from("ordenes_compra")
      .insert(resto.map((f) => ({ ...camposComunes, ...f })))
      .select(selectCompleto);
    if (insertError) return res.status(500).json({ error: insertError.message });
    filasNuevas = insertadas;
  }

  return res.status(200).json({ ordenes: [filaActualizada, ...filasNuevas] });
}
```

- [ ] **Step 2: Interceptar el caso de division al principio del handler PUT**

En `api/ordenes.js`, inmediatamente después de:
```js
  if (req.method === "PUT") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id es obligatorio" });
    const body = await readJsonBody(req);
```
Agregar:
```js

    if (body.estado === "Pendiente aprobación" && Array.isArray(body.cuotas) && body.cuotas.length > 1) {
      return dividirEnCuotasPUT(db, id, body, res);
    }
```

- [ ] **Step 3: Reemplazar el HES timestamp por el correlativo real al aprobar**

Buscar en el handler PUT (dentro del bloque `if (body.estado === "Aprobada") {`):
```js
        // El cliente puede generar y enviar su propio numero_hes junto con
        // el PDF ya regenerado con ese mismo HES (para que el correo de
        // aprobacion salga con el PDF correcto desde el primer envio, sin
        // un segundo paso). Si no lo manda, se genera aqui como antes.
        fields.numero_hes = body.numero_hes || Date.now().toString();
```
Reemplazar por:
```js
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
```

- [ ] **Step 4: Agregar el endpoint GET para pedir un HES antes de aprobar**

En el handler GET, que hoy es:
```js
  if (req.method === "GET") {
    const empresaId = Number(req.query.empresa_id) || 1;
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
Cambiar por:
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

- [ ] **Step 5: Validar sintaxis**

Run: `node --check api/ordenes.js`
Expected: sin salida (sintaxis OK).

- [ ] **Step 6: Commit y desplegar**

```bash
git add api/ordenes.js
git commit -m "feat: dividir en cuotas al generar desde Borrador (PUT), HES correlativo real al aprobar, endpoint siguiente_hes"
git push
```

- [ ] **Step 7: Verificar el endpoint `siguiente_hes` en vivo**

Esperar el redeploy y correr:
```powershell
curl.exe -sS "https://ocfast.vercel.app/api/ordenes?siguiente_hes=1&empresa_id=1"
```
Expected: `{"numero_hes":"17903343"}` (o el siguiente número que corresponda —
ya se consumieron `17903341` y `17903342` en la prueba con rollback del
Task 1, que no dejó estado, así que el primero real que se entregue en
producción será `17903341`; ajustar el número esperado según lo que
efectivamente devuelva).

- [ ] **Step 8: Verificar la división PUT (Borrador -> Pendiente con cuotas) en vivo**

Crear una OC en Borrador con 2 cuotas usando el mismo proveedor de prueba:
```powershell
$bodyBorrador = @{
  proveedor_id = "5d459c0e-8d9b-4af7-91b9-164fc9a53eca"
  empresa_id = 1
  estado = "Borrador"
  titulo = "Prueba plan cuotas (PUT)"
  moneda = "CLP"
  monto_neto = 200000
  monto_iva = 38000
  monto_total = 238000
} | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText("$env:TEMP\test_borrador_cuotas.json", $bodyBorrador, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -sS -X POST "https://ocfast.vercel.app/api/ordenes" -H "Content-Type: application/json" --data "@$env:TEMP\test_borrador_cuotas.json"
```
Anotar el `id` y `numero_oc` devueltos. Luego generar con 2 cuotas:
```powershell
$bodyGenerar = @{
  estado = "Pendiente aprobación"
  cuotas = @(
    @{ dias = 0; observacion = "1/2"; monto = 100000; porcentaje = 50 },
    @{ dias = 0; observacion = "2/2"; monto = 100000; porcentaje = 50 }
  )
  monto_neto = 200000
  monto_iva = 38000
} | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText("$env:TEMP\test_generar_cuotas.json", $bodyGenerar, (New-Object System.Text.UTF8Encoding($false)))
curl.exe -sS -X PUT "https://ocfast.vercel.app/api/ordenes?id=<id-del-borrador>" -H "Content-Type: application/json" --data "@$env:TEMP\test_generar_cuotas.json"
```
Expected: `{"ordenes":[...]}` con 2 filas. La primera debe tener el **mismo
`id`** que el Borrador original (se actualizó in-place) y `numero_oc` con
sufijo `-1`; la segunda es una fila nueva con sufijo `-2`. Ambas con
`monto_neto=100000`, `monto_iva=19000`, `cuota_total=2`.

- [ ] **Step 9: Limpiar las filas de prueba (soft-delete)**

Con los 2 `id` de este paso y los 3 del Task 3 (si no se limpiaron antes),
ejecutar con `mcp__claude_ai_Supabase__execute_sql`:
```sql
update ordenes_compra
set activo = false, eliminado_por = 'plan-cuotas-test', eliminado_en = now()
where id in ('<id-1>', '<id-2>');
```

---

### Task 5: PDF — anotación "Cuota X de N"

**Files:**
- Modify: `index.html` (función `generarPdfOC`)

- [ ] **Step 1: Ubicar la línea del encabezado y agregar la anotación**

Buscar en `index.html`:
```js
  doc.setFontSize(20); doc.setTextColor(140);
  doc.text("Orden de Compra #" + (orden.numero_oc_acquisys || orden.numero_oc), left, 82);
```
Reemplazar por:
```js
  doc.setFontSize(20); doc.setTextColor(140);
  doc.text("Orden de Compra #" + (orden.numero_oc_acquisys || orden.numero_oc), left, 82);
  if (orden.cuota_total) {
    doc.setFontSize(11); doc.setTextColor(140);
    doc.text("Cuota " + orden.cuota_numero + " de " + orden.cuota_total, right, 82, { align: "right" });
  }
```
(Se ubica a la derecha, en la misma línea de base que el título grande, para
no chocar con la línea del N° HES que va más abajo a la izquierda cuando la
OC ya está aprobada.)

- [ ] **Step 2: Validar sintaxis**

Run: `node "$env:TEMP\check_inline_ocsys.js" "C:\Users\ALEX MELENDEZ\Documents\GitHub\ocfast\index.html"`
Expected: `inline script 1: OK (...)`

- [ ] **Step 3: Commit y desplegar**

```bash
git add index.html
git commit -m "feat: anotar Cuota X de N en el PDF de la OC cuando corresponde"
git push
```

---

### Task 6: `NuevaOC.submit()` — manejar la respuesta en N filas

**Files:**
- Modify: `index.html` (función `submit` dentro de `NuevaOC`)

- [ ] **Step 1: Reemplazar el cuerpo de `submit`**

Buscar en `index.html`:
```js
      const { orden } = await api("ordenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form, estado, archivo_url, archivo_nombre, cuotas,
          empresa_id: empresaId,
        }),
        timeoutMs: 25000,
      });

      if (estado === "Pendiente aprobación") {
        const proveedor = proveedores.find((p) => p.id === form.proveedor_id);
        const pdfBlob = await generarPdfOC(orden, proveedor, cuotas, empresa);
        const pdfBase64 = await fileToBase64(new File([pdfBlob], "OC.pdf", { type: "application/pdf" }));
        const up = await api("upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: orden.numero_oc + ".pdf", base64: pdfBase64 }),
          timeoutMs: 25000,
        });
        await api("ordenes?id=" + orden.id, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archivo_oc_url: up.url, archivo_oc_nombre: orden.numero_oc + ".pdf" }),
          timeoutMs: 25000,
        });
      }

      notify("ok", (estado === "Borrador" ? "Borrador guardado: " : "OC generada: ") + orden.numero_oc);
      onCreated();
      limpiarFormulario();
```
Reemplazar por:
```js
      const respuesta = await api("ordenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form, estado, archivo_url, archivo_nombre, cuotas,
          empresa_id: empresaId,
        }),
        timeoutMs: 25000,
      });
      const ordenesCreadas = respuesta.ordenes || [respuesta.orden];

      if (estado === "Pendiente aprobación") {
        const proveedor = proveedores.find((p) => p.id === form.proveedor_id);
        for (const ordenFila of ordenesCreadas) {
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
        }
      }

      const primera = ordenesCreadas[0];
      const mensaje = ordenesCreadas.length > 1
        ? "OC generada en " + ordenesCreadas.length + " cuotas (" + ordenesCreadas.map((o) => o.numero_oc).join(", ") + ")"
        : (estado === "Borrador" ? "Borrador guardado: " : "OC generada: ") + primera.numero_oc;
      notify("ok", mensaje);
      onCreated();
      limpiarFormulario();
```

- [ ] **Step 2: Validar sintaxis**

Run: `node "$env:TEMP\check_inline_ocsys.js" "C:\Users\ALEX MELENDEZ\Documents\GitHub\ocfast\index.html"`
Expected: `inline script 1: OK (...)`

- [ ] **Step 3: Commit y desplegar**

```bash
git add index.html
git commit -m "feat: NuevaOC maneja la creacion en N filas cuando hay mas de 1 cuota"
git push
```

---

### Task 7: `EditarOrdenModal.generarOrden()` y `OrdenAccionModal.submit()` (HES real)

**Files:**
- Modify: `index.html` (función `generarOrden` dentro de `EditarOrdenModal`, bloque `isAprobar` dentro de `submit` en `OrdenAccionModal`)

- [ ] **Step 1: Reemplazar `generarOrden`**

Buscar en `index.html`:
```js
  const generarOrden = async () => {
    if (!form.proveedor_id) return notify("err", "Selecciona un proveedor");
    setSaving(true);
    try {
      const cuerpo = { ...form, cuotas, estado: "Pendiente aprobación" };
      const proveedor = proveedores.find((p) => p.id === form.proveedor_id);
      if (proveedor) {
        const datosParaPdf = { ...orden, ...cuerpo };
        const pdfBlob = await generarPdfOC(datosParaPdf, proveedor, cuotas, empresa);
        const pdfBase64 = await fileToBase64(new File([pdfBlob], "OC.pdf", { type: "application/pdf" }));
        const up = await api("upload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: orden.numero_oc + ".pdf", base64: pdfBase64 }),
          timeoutMs: 25000,
        });
        cuerpo.archivo_oc_url = up.url;
        cuerpo.archivo_oc_nombre = orden.numero_oc + ".pdf";
      }
      await api("ordenes?id=" + orden.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      notify("ok", "OC generada: " + orden.numero_oc);
      onSaved();
    } catch (e) {
      notify("err", e.message);
    } finally {
      setSaving(false);
    }
  };
```
Reemplazar por:
```js
  const generarOrden = async () => {
    if (!form.proveedor_id) return notify("err", "Selecciona un proveedor");
    setSaving(true);
    try {
      const proveedor = proveedores.find((p) => p.id === form.proveedor_id);

      if (cuotas.length > 1) {
        const respuesta = await api("ordenes?id=" + orden.id, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, cuotas, estado: "Pendiente aprobación" }),
        });
        const ordenesCreadas = respuesta.ordenes;
        if (proveedor) {
          for (const fila of ordenesCreadas) {
            const pdfBlob = await generarPdfOC(fila, proveedor, fila.cuotas || [], empresa);
            const pdfBase64 = await fileToBase64(new File([pdfBlob], "OC.pdf", { type: "application/pdf" }));
            const up = await api("upload", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ filename: fila.numero_oc + ".pdf", base64: pdfBase64 }),
              timeoutMs: 25000,
            });
            await api("ordenes?id=" + fila.id, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ archivo_oc_url: up.url, archivo_oc_nombre: fila.numero_oc + ".pdf" }),
              timeoutMs: 25000,
            });
          }
        }
        notify("ok", "OC generada en " + ordenesCreadas.length + " cuotas (" + ordenesCreadas.map((o) => o.numero_oc).join(", ") + ")");
        onSaved();
        return;
      }

      const cuerpo = { ...form, cuotas, estado: "Pendiente aprobación" };
      if (proveedor) {
        const datosParaPdf = { ...orden, ...cuerpo };
        const pdfBlob = await generarPdfOC(datosParaPdf, proveedor, cuotas, empresa);
        const pdfBase64 = await fileToBase64(new File([pdfBlob], "OC.pdf", { type: "application/pdf" }));
        const up = await api("upload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: orden.numero_oc + ".pdf", base64: pdfBase64 }),
          timeoutMs: 25000,
        });
        cuerpo.archivo_oc_url = up.url;
        cuerpo.archivo_oc_nombre = orden.numero_oc + ".pdf";
      }
      await api("ordenes?id=" + orden.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      notify("ok", "OC generada: " + orden.numero_oc);
      onSaved();
    } catch (e) {
      notify("err", e.message);
    } finally {
      setSaving(false);
    }
  };
```

- [ ] **Step 2: Reemplazar la generación del HES en `OrdenAccionModal.submit()`**

Buscar en `index.html`:
```js
        if (!orden.numero_oc_acquisys) {
          const proveedor = (proveedores || []).find((p) => p.id === orden.proveedor_id);
          if (proveedor) {
            const numeroHes = Date.now().toString();
            const pdfBlob = await generarPdfOC({ ...orden, numero_hes: numeroHes }, proveedor, orden.cuotas || [], empresa);
```
Reemplazar por:
```js
        if (!orden.numero_oc_acquisys) {
          const proveedor = (proveedores || []).find((p) => p.id === orden.proveedor_id);
          if (proveedor) {
            const { numero_hes: numeroHes } = await api("ordenes?siguiente_hes=1&empresa_id=" + orden.empresa_id, { timeoutMs: 15000 });
            const pdfBlob = await generarPdfOC({ ...orden, numero_hes: numeroHes }, proveedor, orden.cuotas || [], empresa);
```

- [ ] **Step 3: Validar sintaxis**

Run: `node "$env:TEMP\check_inline_ocsys.js" "C:\Users\ALEX MELENDEZ\Documents\GitHub\ocfast\index.html"`
Expected: `inline script 1: OK (...)`

- [ ] **Step 4: Commit y desplegar**

```bash
git add index.html
git commit -m "feat: generar OC en cuotas desde Editar OC (PUT) y pedir HES real antes de aprobar"
git push
```

---

### Task 8: Verificación final en el navegador

**Files:** ninguno (solo verificación manual).

- [ ] **Step 1: Probar el flujo completo en el navegador**

Abrir `https://ocfast.vercel.app`, entrar a **Nueva OC**, elegir el proveedor
de pruebas **"Alex Services (TEST)"**, cargar cualquier PDF/imagen de
cotización (o completar a mano), poner 3 cuotas y hacer clic en **Generar
OC**. Confirmar en pantalla:
- El mensaje final menciona las 3 OC generadas.
- En **Órdenes**, aparecen 3 filas nuevas con el mismo número base y sufijos
  `-1`/`-2`/`-3`, cada una con su propio monto (suman el total).
- Abrir el PDF de una de ellas (botón de descarga en el listado) y confirmar
  que dice "Cuota 2 de 3" (o el número que corresponda) junto al encabezado.

- [ ] **Step 2: Limpiar las 3 filas creadas en esta prueba manual**

Con los `numero_oc` vistos en pantalla, buscar sus `id` y aplicar el mismo
soft-delete del Task 3/Step 6 vía `mcp__claude_ai_Supabase__execute_sql`.
