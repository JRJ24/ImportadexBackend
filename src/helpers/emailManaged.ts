import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAILUSER,
    pass: process.env.EMAILPASS,
  },
});

interface RegistrationEmailPayload {
  clientName: string;
  clientEmail: string;
  clientType: string;
  identification: string;
  hasDgaToken: boolean;
  tokenDocuments?: Array<{ label: string; url: string }>;
}

const splitRecipients = (value?: string) =>
  (value ?? "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const uniqueRecipients = (...recipientGroups: string[][]) =>
  Array.from(new Set(recipientGroups.flat().map((recipient) => recipient.trim()).filter(Boolean)));

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildAdminHtml = (payload: RegistrationEmailPayload) => {
  const documents = payload.tokenDocuments?.length
    ? payload.tokenDocuments
        .map((document) => `<li><a href="${escapeHtml(document.url)}">${escapeHtml(document.label)}</a></li>`)
        .join("")
    : "<li>No aplica. El cliente indico que ya posee token DGA.</li>";

  return `
    <h2>Nuevo cliente Importadex registrado</h2>
    <p><strong>Cliente:</strong> ${escapeHtml(payload.clientName)}</p>
    <p><strong>Correo:</strong> ${escapeHtml(payload.clientEmail)}</p>
    <p><strong>Tipo:</strong> ${escapeHtml(payload.clientType)}</p>
    <p><strong>Identificacion:</strong> ${escapeHtml(payload.identification)}</p>
    <p><strong>Token DGA:</strong> ${payload.hasDgaToken ? "Ya posee token" : "Requiere gestion de token"}</p>
    <h3>Documentos</h3>
    <ul>${documents}</ul>
  `;
};

const buildClientHtml = (payload: RegistrationEmailPayload) => `
  <h2>Registro recibido en Importadex</h2>
  <p>Hola ${escapeHtml(payload.clientName)},</p>
  <p>Hemos recibido tu registro correctamente. Nuestro equipo revisara la informacion enviada y se comunicara contigo si necesita algun dato adicional.</p>
  <p><strong>Token DGA:</strong> ${payload.hasDgaToken ? "Indicaste que ya posees token DGA." : "Recibimos los documentos para gestionar tu token DGA."}</p>
  <p>Gracias por registrarte en Importadex.</p>
`;

export async function sendImportadexClientRegistrationEmails(payload: RegistrationEmailPayload) {
  if (!process.env.EMAILUSER || !process.env.EMAILPASS) {
    console.warn("Importadex email not sent: EMAILUSER or EMAILPASS is missing.");
    return { sent: false, skipped: true };
  }

  const adminRecipients = splitRecipients(
    process.env.IMPORTADEX_ADMIN_EMAILS || process.env.IMPORTADEX_NOTIFY_EMAILS,
  );
  const operatorRecipients = splitRecipients(
    process.env.IMPORTADEX_OPERATOR_EMAILS || process.env.IMPORTADEX_OPERATIONS_EMAILS,
  );
  const internalRecipients = uniqueRecipients(adminRecipients, operatorRecipients);

  const messages = [
    transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAILUSER,
      to: payload.clientEmail,
      subject: "Registro Importadex recibido",
      html: buildClientHtml(payload),
    }),
  ];

  if (internalRecipients.length) {
    messages.push(
      transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAILUSER,
        to: internalRecipients,
        subject: "Nuevo cliente Importadex registrado",
        html: buildAdminHtml(payload),
      }),
    );
  }

  const results = await Promise.allSettled(messages);
  const rejected = results.filter((result) => result.status === "rejected");

  if (rejected.length) {
    console.error("Importadex email delivery failed", rejected);
  }

  return {
    sent: rejected.length === 0,
    adminRecipients: adminRecipients.length,
    operatorRecipients: operatorRecipients.length,
    internalRecipients: internalRecipients.length,
  };
}

