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

function buildRawEmail(to, from, subject, htmlBody, attachments, cc) {
  const boundary = "ocsys_" + Date.now().toString(36);
  const fromEncoded = `=?UTF-8?B?${Buffer.from("Patagónica Inmobiliaria").toString("base64")}?= <${from}>`;
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;

  const headers = [`From: ${fromEncoded}`, `To: ${to}`];
  if (cc) headers.push(`Cc: ${cc}`);
  headers.push(`Subject: ${subjectEncoded}`, "MIME-Version: 1.0");
  const lista = (attachments || []).filter(Boolean);

  let body;
  if (lista.length) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const partes = [
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(htmlBody).toString("base64"),
    ];
    lista.forEach((att) => {
      partes.push(
        "",
        `--${boundary}`,
        `Content-Type: application/pdf; name="${att.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${att.filename}"`,
        "",
        att.content,
      );
    });
    partes.push("", `--${boundary}--`);
    body = partes.join("\r\n");
  } else {
    headers.push("Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64");
    body = Buffer.from(htmlBody).toString("base64");
  }

  const raw = headers.join("\r\n") + "\r\n\r\n" + body;
  return Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendGmail(token, to, from, subject, htmlBody, attachments, cc) {
  const raw = buildRawEmail(to, from, subject, htmlBody, attachments, cc);
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

// Firma fija institucional -- todos los correos automáticos de OCSys la usan
// tal cual, sin importar qué usuario haya disparado la acción (aprobar,
// facturar, etc.), para que la comunicación con proveedores y el equipo de
// pagos sea siempre consistente.
const FIRMA_HTML = `
    <p style="margin:0 0 14px">Saludos Cordiales,</p>
    <p style="margin:0 0 14px"><b>Coordinación de Compras y Servicios Generales</b><br>
    Av. Américo Vespucio 2680, Piso 11, Conchalí.</p>
    <p style="color:#888888;font-size:11px;text-align:center;margin-top:24px">Correo generado automáticamente por OCSys</p>`;

export async function enviarCorreoAprobacion(orden, cc) {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    throw new Error("Credenciales de Gmail no configuradas (GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN)");
  }
  const from = process.env.GMAIL_FROM || "facturacion@patagonica.cl";

  const proveedor = orden.proveedores || {};
  const to = proveedor.contacto_correo;
  if (!to) throw new Error("El proveedor no tiene correo de contacto configurado");

  const numeroOc = orden.numero_oc_acquisys || orden.numero_oc;
  const asunto = `${numeroOc} / HES ${orden.numero_hes} ${orden.titulo || ""}`.trim();
  const notaUF = orden.moneda === "UF"
    ? `<p style="margin:0 0 14px"><i><u>Si el monto es en UF, facturar según el valor de la UF del día 30 del mes al que corresponde el servicio.</u></i></p>`
    : "";

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;font-size:14px">
    <p style="margin:0 0 14px">Adjunto Orden de Compra y código HES para la facturación del servicio.</p>
    <p style="margin:0 0 14px"><b>${numeroOc} / HES ${orden.numero_hes}</b> — ${orden.titulo || ""}</p>
    ${notaUF}
    <p style="margin:0 0 14px"><b><u>Nota: Incluir en referencia de la factura, el número de OC a la que hace referencia y código HES. Sin estos datos no serán procesadas las facturas.</u></b></p>
    ${FIRMA_HTML}
  </body></html>`;

  let attachment = null;
  if (orden.archivo_oc_url) {
    try {
      const content = await fetchAsBase64(orden.archivo_oc_url);
      attachment = { filename: orden.archivo_oc_nombre || numeroOc + ".pdf", content };
    } catch (e) { /* si falla el adjunto, se envía igual el correo sin él */ }
  }

  const token = await getGmailToken();
  await sendGmail(token, to, from, asunto, html, attachment ? [attachment] : [], cc);
}

// Correo interno (no al proveedor) avisando al equipo de pagos que una OC
// nativa quedó facturada y lista para pagar. El destinatario se resuelve en
// este orden: correo_contabilidad configurado en Administración para la
// empresa de la OC (editable sin redeploy) -> variable de entorno
// PAGO_EMAIL_TO -> wurfel.cl@gmail.com como último respaldo para no arriesgar
// mandarlo a alguien real si no hay nada configurado.
export async function enviarCorreoFactura(orden, cc) {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    throw new Error("Credenciales de Gmail no configuradas (GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN)");
  }
  const from = process.env.GMAIL_FROM || "facturacion@patagonica.cl";
  const to = (orden.empresas?.correo_contabilidad || process.env.PAGO_EMAIL_TO || "wurfel.cl@gmail.com")
    .split(",").map((s) => s.trim()).filter(Boolean).join(", ");

  const numeroOc = orden.numero_oc_acquisys || orden.numero_oc;
  const asunto = `Pago Factura ${orden.numero_factura} / ${numeroOc} / HES ${orden.numero_hes}` + (orden.titulo ? ` - ${orden.titulo}` : "");

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;font-size:14px">
    <p style="margin:0 0 14px">Buenos días</p>
    <p style="margin:0 0 14px">Favor incluir en proceso de pago</p>
    <p style="margin:0 0 14px">
      Factura N° ${orden.numero_factura}<br>
      ${numeroOc}<br>
      HES: ${orden.numero_hes || "—"}<br>
      Centro costo: ${orden.centro_costo_codigo || "—"}<br>
      Descripción: ${orden.descripcion || ""}
    </p>
    <p style="margin:0 0 14px">Se adjunta como respaldo OC y Factura</p>
    ${FIRMA_HTML}
  </body></html>`;

  const attachments = [];
  if (orden.archivo_oc_url) {
    try {
      const content = await fetchAsBase64(orden.archivo_oc_url);
      attachments.push({ filename: orden.archivo_oc_nombre || numeroOc + ".pdf", content });
    } catch (e) { /* si falla el adjunto, se envía igual el correo sin él */ }
  }
  if (orden.archivo_factura_url) {
    try {
      const content = await fetchAsBase64(orden.archivo_factura_url);
      attachments.push({ filename: orden.archivo_factura_nombre || "Factura " + orden.numero_factura + ".pdf", content });
    } catch (e) { /* si falla el adjunto, se envía igual el correo sin él */ }
  }

  const token = await getGmailToken();
  await sendGmail(token, to, from, asunto, html, attachments, cc);
}

// Correo al proveedor confirmando que se le pago, al subir el comprobante en
// el paso final "Registrar Pago" (estado -> Completada). Cierra el ciclo que
// empezo con enviarCorreoAprobacion.
export async function enviarCorreoPago(orden, cc) {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    throw new Error("Credenciales de Gmail no configuradas (GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN)");
  }
  const from = process.env.GMAIL_FROM || "facturacion@patagonica.cl";
  const proveedor = orden.proveedores || {};
  const to = proveedor.contacto_correo;
  if (!to) throw new Error("El proveedor no tiene correo de contacto configurado");

  const numeroOc = orden.numero_oc_acquisys || orden.numero_oc;
  const asunto = `Pago realizado - Factura ${orden.numero_factura} / ${numeroOc}`;

  const P = 'style="margin:0 0 14px"';
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;font-size:14px">
    <p ${P}>Estimado(a) ${proveedor.razon_social || ""},</p>
    <p ${P}>Junto con saludar, le confirmamos que Patagónica Inmobiliaria ha realizado el pago correspondiente a:</p>
    <p ${P}>
      Cotización N°: ${orden.numero_cotizacion || "—"}<br>
      Orden de Compra: ${numeroOc}<br>
      HES: ${orden.numero_hes || "—"}<br>
      Monto pagado: ${fmtMontoEmail(orden.monto_total, orden.moneda)}<br>
      Factura N° ${orden.numero_factura}
    </p>
    <p ${P}>Se adjunta el comprobante de la transferencia como respaldo.</p>
    <p ${P}>Muchas gracias por su servicio.</p>
    ${FIRMA_HTML}
  </body></html>`;

  let attachment = null;
  if (orden.archivo_comprobante_url) {
    try {
      const content = await fetchAsBase64(orden.archivo_comprobante_url);
      attachment = { filename: orden.archivo_comprobante_nombre || "Comprobante " + orden.numero_factura + ".pdf", content };
    } catch (e) { /* si falla el adjunto, se envía igual el correo sin él */ }
  }

  const token = await getGmailToken();
  await sendGmail(token, to, from, asunto, html, attachment ? [attachment] : [], cc);
}

function fmtMontoEmail(v, moneda) {
  const n = Number(v) || 0;
  if (moneda === "CLP" || !moneda) return "$" + n.toLocaleString("es-CL");
  return moneda + " " + n.toLocaleString("es-CL", { maximumFractionDigits: 2 });
}

export async function enviarCorreoResetPassword(usuario, resetUrl) {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    throw new Error("Credenciales de Gmail no configuradas (GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN)");
  }
  const from = process.env.GMAIL_FROM || "facturacion@patagonica.cl";
  const to = usuario.usuario; // el login es el correo corporativo

  const asunto = "Restablecer tu contraseña de OCSys";
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;font-size:14px">
    <p>Hola ${usuario.nombre},</p>
    <p>Recibimos una solicitud para restablecer tu contraseña de OCSys. Si fuiste tú, haz clic en el siguiente enlace (válido por 30 minutos):</p>
    <p><a href="${resetUrl}" style="background:#1c5ea8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Restablecer contraseña</a></p>
    <p>Si no solicitaste esto, puedes ignorar este correo — tu contraseña actual seguirá funcionando.</p>
    <p>Saludos,<br>OCSys — Patagónica Inmobiliaria</p>
  </body></html>`;

  const token = await getGmailToken();
  await sendGmail(token, to, from, asunto, html, []);
}
