import { readJsonBody } from "./_supabase.js";
import { leerDocumentoConFallback } from "./_ia-lectura.js";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    numero_cotizacion: { type: "string", description: "Número o folio de la cotización tal como aparece impreso en el documento (ej. 'N° 39512', 'Cotización N° 245', 'Folio 12'). Si el documento no indica un número, deja este campo como cadena vacía \"\" — no lo inventes." },
    proveedor_rut: { type: "string", description: "RUT del proveedor/emisor de la cotización, formato XX.XXX.XXX-X" },
    proveedor_razon_social: { type: "string", description: "Razón social o nombre del proveedor/emisor" },
    contacto_nombre: { type: "string", description: "Nombre de pila de la persona de contacto que firma o emite la cotización" },
    contacto_apellido: { type: "string", description: "Apellido de la persona de contacto" },
    contacto_telefono: { type: "string", description: "Teléfono fijo de contacto, si se indica" },
    contacto_celular: { type: "string", description: "Celular/móvil de contacto, si se indica" },
    contacto_correo: { type: "string", description: "Correo electrónico de contacto del proveedor" },
    banco: { type: "string", description: "Nombre del banco en los datos bancarios" },
    tipo_cuenta: { type: "string", description: "Tipo de cuenta bancaria (Cuenta Corriente, Cuenta Vista, Cuenta de Ahorro)" },
    numero_cuenta: { type: "string", description: "Número de cuenta bancaria" },
    descripcion: { type: "string", description: "Descripción detallada de lo cotizado: qué incluye, alcance, ítems o condiciones relevantes. NO incluyas aquí montos, banco ni número de cuenta — esos ya tienen sus propios campos." },
    condiciones: { type: "string", description: "Condiciones comerciales explícitas del documento: plazos de entrega, condiciones o forma de pago, validez de la cotización, garantía, u otros términos similares. Si el documento NO indica ninguna condición de este tipo, deja este campo como cadena vacía \"\" — no lo inventes ni repitas aquí la descripción." },
    motivo: { type: "string", description: "Motivo o justificación de la compra/contratación, SOLO si el documento lo menciona explícitamente (por ejemplo, una nota del proveedor sobre para qué se solicita el servicio). Si el documento NO lo indica explícitamente, este campo debe quedar como cadena vacía \"\" — no expliques por qué está vacío, no escribas nada." },
    titulo: { type: "string", description: "Encabezado de MÁXIMO 8 palabras que resuma la descripción de arriba, como el asunto de un correo. PROHIBIDO incluir montos, nombres de banco, números de cuenta, u oraciones explicativas. Ejemplo correcto: 'Automatización de flujos de trabajo'. Ejemplo incorrecto (no hagas esto): una oración larga o con cifras." },
    moneda: { type: "string", enum: ["CLP", "USD", "UF"] },
    monto_neto: { type: "number", description: "Monto neto (sin IVA)" },
    monto_iva: { type: "number", description: "Monto de IVA, si se indica" },
    monto_total: { type: "number", description: "Monto total (con IVA)" },
  },
  propertyOrdering: [
    "numero_cotizacion",
    "proveedor_rut", "proveedor_razon_social",
    "contacto_nombre", "contacto_apellido", "contacto_telefono", "contacto_celular", "contacto_correo",
    "banco", "tipo_cuenta", "numero_cuenta",
    "descripcion", "condiciones", "motivo", "titulo",
    "moneda", "monto_neto", "monto_iva", "monto_total",
  ],
  required: ["moneda", "monto_neto", "monto_total"],
};

const INSTRUCCIONES = "Esta es una cotización enviada por un proveedor a Patagónica Inmobiliaria, Campo Mar SPA o Evox/Sánchez Hermanos SpA (una de estas es la EMPRESA CLIENTE que recibe la cotización). IMPORTANTE sobre proveedor_rut y proveedor_razon_social: el documento normalmente muestra DOS entidades — el PROVEEDOR que emite/vende (generalmente en el encabezado o membrete, con su logo y datos de contacto propios) y el CLIENTE al que va dirigida la cotización (frecuentemente bajo etiquetas como 'Señor(es):', 'Para:', 'Cliente:', 'Dirigido a:'). Extrae proveedor_rut y proveedor_razon_social SOLO de quien EMITE/VENDE — NUNCA el RUT o nombre que aparece junto a 'Señor(es)'/'Para'/'Cliente', aunque esté etiquetado simplemente como 'RUT:' cerca de esos datos del cliente. Si el proveedor no imprime su propio RUT en el documento, deja proveedor_rut como cadena vacía \"\" — no uses el RUT del cliente como reemplazo. Extrae TODOS los datos solicitados, incluyendo el número o folio de la cotización (tal como aparece impreso en el documento, ej. 'N° 39512'), los datos bancarios (banco, tipo de cuenta, número de cuenta), los datos de contacto (nombre, teléfono, celular, correo) y las condiciones comerciales explícitas (plazos de entrega, condiciones de pago, validez de la oferta, garantía, etc.) si aparecen en el documento — no los omitas. Cada dato va SOLO en su propio campo: los montos van en monto_neto/monto_iva/monto_total, el banco y la cuenta van en banco/tipo_cuenta/numero_cuenta, nunca los repitas como texto dentro de titulo, descripcion o motivo. El titulo es un encabezado de máximo 8 palabras, sin cifras ni datos bancarios. El motivo debe quedar como cadena vacía si el documento no indica explícitamente para qué se solicita la compra — no escribas frases como 'no se indica motivo', simplemente déjalo vacío. Si un dato no aparece en el documento, usa cadena vacía \"\" — no lo inventes.";

const PROMPT_GENERICO = `${INSTRUCCIONES}

Responde ÚNICAMENTE con un objeto JSON (sin texto adicional, sin bloques de código markdown) con exactamente estas claves:
{
  "numero_cotizacion": string, "proveedor_rut": string, "proveedor_razon_social": string,
  "contacto_nombre": string, "contacto_apellido": string, "contacto_telefono": string, "contacto_celular": string, "contacto_correo": string,
  "banco": string, "tipo_cuenta": string, "numero_cuenta": string,
  "descripcion": string, "condiciones": string, "motivo": string, "titulo": string,
  "moneda": "CLP" | "USD" | "UF", "monto_neto": number, "monto_iva": number, "monto_total": number
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
    return res.status(400).json({ error: "La lectura con IA solo funciona con PDF, JPG o PNG. Word/Excel debes completarlos manualmente." });
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
