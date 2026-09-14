import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "ocsys_token";

function b64url(buf) {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlToBuffer(str) {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function signToken(payload, secret) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token, secret) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expectedSig = createHmac("sha256", secret).update(`${header}.${body}`).digest();
  const gotSig = b64urlToBuffer(sig);
  if (expectedSig.length !== gotSig.length || !timingSafeEqual(expectedSig, gotSig)) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlToBuffer(body).toString("utf8"));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function nextMidnightEpochSeconds(tz = "America/Santiago") {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const p = dtf.formatToParts(now).reduce((a, x) => { if (x.type !== "literal") a[x.type] = x.value; return a; }, {});
  const tomorrowUTCGuess = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + 1, 0, 0, 0);
  const dtf2 = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p2 = dtf2.formatToParts(new Date(tomorrowUTCGuess)).reduce((a, x) => { if (x.type !== "literal") a[x.type] = x.value; return a; }, {});
  const asUTC = Date.UTC(Number(p2.year), Number(p2.month) - 1, Number(p2.day), Number(p2.hour), Number(p2.minute), Number(p2.second));
  const offsetMin = (asUTC - tomorrowUTCGuess) / 60000;
  return Math.floor((tomorrowUTCGuess - offsetMin * 60000) / 1000);
}

export function makeCookie(token, maxAgeSeconds) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}; Path=/`;
}

export function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`;
}

export function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? m[1] : null;
}

export { COOKIE_NAME };
