import { supabase } from "./_supabase.js";
import { readJsonBody } from "./_supabase.js";

export const config = {
  api: { bodyParser: false },
};

const EXT_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido" });
  }

  const body = await readJsonBody(req);
  const { filename, base64 } = body;
  if (!filename || !base64) {
    return res.status(400).json({ error: "filename y base64 son obligatorios" });
  }

  const ext = filename.split(".").pop().toLowerCase();
  const contentType = EXT_TYPES[ext];
  if (!contentType) {
    return res.status(400).json({ error: "Formato no permitido. Usa PDF, Word, Excel, JPG o PNG" });
  }

  const buffer = Buffer.from(base64, "base64");
  const path = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const db = supabase();
  const { error } = await db.storage.from("ocsys-archivos").upload(path, buffer, {
    contentType,
    upsert: false,
  });
  if (error) return res.status(500).json({ error: error.message });

  const { data: pub } = db.storage.from("ocsys-archivos").getPublicUrl(path);
  return res.status(200).json({ url: pub.publicUrl, path });
}
