import { GoogleGenAI } from "@google/genai";

// Cadena de respaldo para la lectura de documentos con IA (cotizaciones y
// facturas): Gemini -> Groq (Llama Vision) -> OpenRouter (Qwen-VL, modelo
// gratuito). Si el primero falla (Gemini se ha visto saturado o caido en la
// practica), se sigue probando con el resto antes de rendirse. Groq y
// OpenRouter son APIs "chat completions" estilo OpenAI que no leen PDF de
// forma nativa como Gemini -- si el documento es PDF, se extrae el texto
// (sin renderizar a imagen: probamos pdf-to-img en producción y falla en
// el entorno serverless de Vercel con "DOMMatrix is not defined", una API
// de navegador que pdfjs-dist necesita solo para renderizar/canvas, no
// para extraer texto).

function esErrorSaturacionGemini(e) {
  return /UNAVAILABLE|"code":503|high demand|overloaded/i.test(e.message || "");
}

async function leerConGemini({ prompt, mimeType, base64, schema, model }) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no configurada");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  let ultimoError;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const response = await ai.models.generateContent({
        model: model || "gemini-3.6-flash",
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }] }],
        config: { responseMimeType: "application/json", responseSchema: schema },
      });
      return JSON.parse(response.text);
    } catch (e) {
      ultimoError = e;
      if (esErrorSaturacionGemini(e) && intento < 3) {
        await new Promise((r) => setTimeout(r, 1500 * intento));
        continue;
      }
      break;
    }
  }
  throw ultimoError;
}

// Extrae el texto de un PDF (sin renderizar paginas a imagen) -- suficiente
// para cotizaciones/facturas digitales, que son texto real y no escaneos.
async function extraerTextoPdf(base64Pdf) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(Buffer.from(base64Pdf, "base64"));
  const documento = await pdfjsLib.getDocument({ data, disableFontFace: true, useSystemFonts: false, isEvalSupported: false }).promise;
  let texto = "";
  for (let i = 1; i <= documento.numPages; i++) {
    const pagina = await documento.getPage(i);
    const contenido = await pagina.getTextContent();
    texto += contenido.items.map((it) => it.str).join(" ") + "\n";
  }
  texto = texto.trim();
  if (!texto) throw new Error("No se pudo extraer texto del PDF (podría ser un escaneo sin texto seleccionable)");
  return texto;
}

async function leerConChatVision({ baseUrl, apiKey, model, prompt, mimeType, base64 }) {
  let content;
  if (mimeType === "application/pdf") {
    const texto = await extraerTextoPdf(base64);
    content = prompt + "\n\n--- Contenido extraído del PDF ---\n" + texto.slice(0, 15000);
  } else {
    content = [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
    ];
  }
  const res = await fetch(baseUrl + "/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status + ": " + (await res.text()).slice(0, 300));
  const data = await res.json();
  const textoRespuesta = data.choices?.[0]?.message?.content;
  if (!textoRespuesta) throw new Error("Respuesta vacía del modelo");
  return JSON.parse(textoRespuesta);
}

async function leerConGroq(args) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY no configurada");
  return leerConChatVision({
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b",
    ...args,
  });
}

async function leerConOpenRouter(args) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY no configurada");
  return leerConChatVision({
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_VISION_MODEL || "google/gemma-4-31b-it:free",
    ...args,
  });
}

// promptGemini: prompt + responseSchema para el modo de salida estructurada de Gemini.
// promptGenerico: mismo pedido pero en texto plano (le pide el JSON explicitamente),
// para los modelos de respaldo que no tienen "structured output" real.
export async function leerDocumentoConFallback({ promptGemini, promptGenerico, mimeType, base64, geminiSchema, geminiModel, onProgress }) {
  const errores = [];
  const avisar = (motorCorto) => { if (onProgress) onProgress(motorCorto); };

  avisar("Gemini");
  try {
    const datos = await leerConGemini({ prompt: promptGemini, mimeType, base64, schema: geminiSchema, model: geminiModel });
    return { datos, motor: "Gemini" };
  } catch (e) { errores.push("Gemini: " + e.message); }

  avisar("Groq");
  try {
    const datos = await leerConGroq({ prompt: promptGenerico, mimeType, base64 });
    return { datos, motor: "Groq (Llama Vision, respaldo)" };
  } catch (e) { errores.push("Groq: " + e.message); }

  avisar("OpenRouter");
  try {
    const datos = await leerConOpenRouter({ prompt: promptGenerico, mimeType, base64 });
    return { datos, motor: "OpenRouter (Qwen-VL, respaldo)" };
  } catch (e) { errores.push("OpenRouter: " + e.message); }

  throw new Error("Los 3 motores de lectura con IA fallaron — " + errores.join(" | "));
}
