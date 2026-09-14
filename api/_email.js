// Envío por Gmail API con OAuth2 (mismo patrón que facturacion-patagonica/api/recordatorio-pago.js),
// autenticado como una cuenta real de Google Workspace — no requiere verificar ningún dominio.

async function fetchAsBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("No se pudo descargar el archivo adjunto: " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.toString("base64");
}

async function getGmailToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("OAuth2 Gmail error: " + (await res.text()).slice(0, 300));
  const data = await res.json();
  if (!data.access_token) throw new Error("OAuth2 Gmail: sin access_token");
  return data.access_token;
}

function buildRawEmail(to, from, subject, htmlBody, attachment) {
  const boundary = "ocsys_" + Date.now().toString(36);
  const fromEncoded = `=?UTF-8?B?${Buffer.from("Patagónica Inmobiliaria").toString("base64")}?= <${from}>`;
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;

  const headers = [`From: ${fromEncoded}`, `To: ${to}`, `Subject: ${subjectEncoded}`, "MIME-Version: 1.0"];

  let body;
  if (attachment) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(htmlBody).toString("base64"),
      "",
      `--${boundary}`,
      `Content-Type: application/pdf; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "",
      attachment.content,
      "",
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    headers.push("Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64");
    body = Buffer.from(htmlBody).toString("base64");
  }

  const raw = headers.join("\r\n") + "\r\n\r\n" + body;
  return Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendGmail(token, to, from, subject, htmlBody, attachment) {
  const raw = buildRawEmail(to, from, subject, htmlBody, attachment);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gmail ${res.status}: ${err.error?.message || JSON.stringify(err).slice(0, 200)}`);
  }
  return res.json();
}

export async function enviarCorreoAprobacion(orden, aprobador) {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    throw new Error("Credenciales de Gmail no configuradas (GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN)");
  }
  const from = process.env.GMAIL_FROM || "facturacion@patagonica.cl";

  const proveedor = orden.proveedores || {};
  const to = proveedor.contacto_correo;
  if (!to) throw new Error("El proveedor no tiene correo de contacto configurado");

  const asunto = `${orden.numero_oc} / HES ${orden.numero_hes} ${orden.titulo || ""}`.trim();
  const notaUF = orden.moneda === "UF"
    ? `<p><i><u>Si el monto es en UF, facturar según el valor de la UF del día 30 del mes al que corresponde el servicio.</u></i></p>`
    : "";

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;font-size:14px">
    <p>Adjunto Orden de Compra y código HES para la facturación del servicio.</p>
    <p><b>${orden.numero_oc} / HES ${orden.numero_hes}</b> — ${orden.titulo || ""}</p>
    ${notaUF}
    <p><b><u>Nota: Incluir en referencia de la factura, el número de OC a la que hace referencia y código HES. Sin estos datos no serán procesadas las facturas.</u></b></p>
    <p>Saludos cordiales,</p>
    <p><b>${aprobador.nombre} ${aprobador.apellido}</b><br>
    Dpto. de Facturación<br>
    ${from}<br>
    Av. Américo Vespucio 2680, Piso 11, Conchalí</p>
  </body></html>`;

  let attachment = null;
  if (orden.archivo_oc_url) {
    try {
      const content = await fetchAsBase64(orden.archivo_oc_url);
      attachment = { filename: orden.archivo_oc_nombre || orden.numero_oc + ".pdf", content };
    } catch (e) { /* si falla el adjunto, se envía igual el correo sin él */ }
  }

  const token = await getGmailToken();
  await sendGmail(token, to, from, asunto, html, attachment);
}
