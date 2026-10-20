import tls from "node:tls";
import { randomUUID, timingSafeEqual } from "node:crypto";

const FROM = "anthony@form-frame.co.uk";
const HOST = "mail.privateemail.com";
const validEmail = /^[^\s@\r\n<>]+@[^\s@\r\n<>]+\.[^\s@\r\n<>]+$/;

function smtpSend({ to, subject, html, password }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: HOST, port: 465, servername: HOST, rejectUnauthorized: true });
    socket.setTimeout(15000);
    let buffer = "", multiline = [], phase = 0, finished = false;
    const fail = err => { if (finished) return; finished = true; socket.destroy(); reject(err); };
    const commands = [
      ["EHLO form-frame.co.uk", 250],
      ["AUTH LOGIN", 334],
      [Buffer.from(FROM).toString("base64"), 334],
      [Buffer.from(password).toString("base64"), 235],
      [`MAIL FROM:<${FROM}>`, 250],
      [`RCPT TO:<${to}>`, 250],
      ["DATA", 354]
    ];
    const htmlBase64 = Buffer.from(html, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();
    const mime = [
      `From: Form & Frame <${FROM}>`,
      `To: <${to}>`,
      `Reply-To: ${FROM}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      `Message-ID: <${randomUUID()}@form-frame.co.uk>`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "", htmlBase64
    ].join("\r\n").replace(/\r\n\./g, "\r\n..");
    commands.push([mime + "\r\n.", 250], ["QUIT", 221]);
    socket.on("secureConnect", () => {});
    socket.on("timeout", () => fail(new Error("SMTP timeout")));
    socket.on("error", fail);
    socket.on("close", () => { if (!finished) fail(new Error("SMTP connection closed")); });
    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
        if (!/^\d{3}[ -]/.test(line)) continue;
        multiline.push(line);
        if (line[3] === "-") continue;
        const status = Number(line.slice(0, 3));
        const expected = phase === 0 ? 220 : commands[phase - 1]?.[1];
        multiline = [];
        if (status !== expected) return fail(new Error(`SMTP rejected step ${phase} (status ${status})`));
        if (phase === commands.length) { finished = true; socket.end(); resolve(); return; }
        socket.write(commands[phase++][0] + "\r\n");
      }
    });
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const key = process.env.QUOTE_RELAY_SECRET || "";
  const supplied = (req.headers.authorization || "").replace(/^Bearer /i, "");
  if (!key || !supplied || Buffer.byteLength(key) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(key), Buffer.from(supplied))) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const password = process.env.NAMECHEAP_SMTP_PASSWORD;
  if (!password) return res.status(503).json({ error: "SMTP credentials not configured" });
  const { to, subject, html } = req.body || {};
  if (typeof to !== "string" || !validEmail.test(to) || typeof subject !== "string" || subject.length > 200 || /[\r\n]/.test(subject) || typeof html !== "string" || html.length > 100000) {
    return res.status(400).json({ error: "Invalid email payload" });
  }
  try {
    await smtpSend({ to, subject, html, password });
    return res.status(200).json({ status: "sent" });
  } catch (error) {
    console.error("Quotation SMTP delivery failed:", error.message);
    return res.status(502).json({ error: "SMTP delivery failed" });
  }
}
