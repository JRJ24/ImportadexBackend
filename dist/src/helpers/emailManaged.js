"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyImportadexEmailTransport = verifyImportadexEmailTransport;
exports.sendImportadexInternalNotification = sendImportadexInternalNotification;
exports.sendImportadexClientRegistrationEmails = sendImportadexClientRegistrationEmails;
exports.sendImportadexClientCommitmentEmail = sendImportadexClientCommitmentEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const promises_1 = require("dns/promises");
const mirex_users_service_1 = require("../services/mirex-users.service");
const brandOrange = "#E97E26";
const brandBlue = "#22729F";
const getSmtpPort = () => Number(process.env.SMTP_PORT || 465);
const getSmtpSecure = () => {
    const value = process.env.SMTP_SECURE;
    if (value === undefined)
        return getSmtpPort() === 465;
    return ["1", "true", "yes", "si", "sí"].includes(value.trim().toLowerCase());
};
const getSmtpUser = () => process.env.SMTP_USER || process.env.EMAILUSER;
const getSmtpPassword = () => process.env.SMTP_PASSWORD || process.env.EMAILPASS;
const getSmtpHost = () => process.env.SMTP_HOST ||
    (getSmtpUser()?.toLowerCase().endsWith("@gmail.com") ? "smtp.gmail.com" : undefined);
const getEmailFrom = () => process.env.EMAIL_FROM || getSmtpUser();
const transporter = nodemailer_1.default.createTransport({
    host: getSmtpHost(),
    port: getSmtpPort(),
    secure: getSmtpSecure(),
    auth: {
        user: getSmtpUser(),
        pass: getSmtpPassword(),
    },
});
const hasEmailConfig = () => Boolean(getSmtpHost() && getSmtpUser() && getSmtpPassword());
const isLocalRecipientAllowed = () => ["1", "true", "yes", "si", "sí"].includes((process.env.SMTP_ALLOW_LOCAL_RECIPIENTS ?? "").trim().toLowerCase());
const getRecipientDomain = (email) => email.split("@")[1]?.trim().toLowerCase() ?? "";
const isDeliverableRecipient = (email) => {
    const normalizedEmail = email.trim().toLowerCase();
    const domain = getRecipientDomain(normalizedEmail);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))
        return false;
    if (!isLocalRecipientAllowed() && domain.endsWith(".local"))
        return false;
    return true;
};
const normalizeRecipients = (to) => {
    const recipients = Array.isArray(to) ? to : [to];
    const unique = uniqueEmails(recipients);
    const deliverable = unique.filter(isDeliverableRecipient);
    const skipped = unique.filter((email) => !isDeliverableRecipient(email));
    return { deliverable, skipped };
};
const summarizeDomains = (emails) => emails.reduce((summary, email) => {
    const domain = getRecipientDomain(email) || "invalid";
    summary[domain] = (summary[domain] ?? 0) + 1;
    return summary;
}, {});
const maskEmail = (email) => {
    const [local = "", domain = ""] = email.split("@");
    const visible = local.length <= 2 ? local : local.slice(0, 2);
    return `${visible}***@${domain || "invalid"}`;
};
const getMailFrom = () => {
    const from = getEmailFrom();
    return from ? `Importadex <${from}>` : "Importadex";
};
const sendTransportMail = (mailOptions) => transporter.sendMail(mailOptions);
let dnsWarningLogged = false;
const getEmailDomain = (email) => email?.split("@")[1]?.trim().toLowerCase();
const checkSenderDns = async () => {
    if (dnsWarningLogged)
        return;
    dnsWarningLogged = true;
    const fromDomain = getEmailDomain(getEmailFrom());
    const smtpHost = getSmtpHost()?.toLowerCase() ?? "";
    if (!fromDomain || !smtpHost.includes("gmail"))
        return;
    try {
        const [spfRecords, dkimRecords] = await Promise.allSettled([
            (0, promises_1.resolveTxt)(fromDomain),
            (0, promises_1.resolveTxt)(`google._domainkey.${fromDomain}`),
        ]);
        const spfText = spfRecords.status === "fulfilled" ? spfRecords.value.flat().join(" ") : "";
        const hasGoogleSpf = spfText.includes("_spf.google.com");
        const hasGoogleDkim = dkimRecords.status === "fulfilled" && dkimRecords.value.flat().join(" ").includes("v=DKIM1");
        if (!hasGoogleSpf || !hasGoogleDkim) {
            console.warn("Importadex sender DNS may affect delivery", {
                fromDomain,
                smtpHost: getSmtpHost(),
                hasGoogleSpf,
                hasGoogleDkim,
                expectedSpf: "include:_spf.google.com",
                expectedDkimSelector: `google._domainkey.${fromDomain}`,
            });
        }
    }
    catch (error) {
        console.warn("Importadex sender DNS check failed", {
            fromDomain,
            smtpHost: getSmtpHost(),
            message: error instanceof Error ? error.message : "DNS check failed",
        });
    }
};
const escapeHtml = (value) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const displayValue = (value) => escapeHtml(value === undefined || value === null || value === "" ? "No registrado" : String(value));
const uniqueEmails = (emails) => Array.from(new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean)));
const parseEmailList = (value) => value?.split(/[,;\s]+/).map((email) => email.trim()).filter(Boolean) ?? [];
const getConfiguredInternalRecipients = () => uniqueEmails([
    ...parseEmailList(process.env.IMPORTADEX_NOTIFY_EMAILS),
    ...parseEmailList(process.env.IMPORTADEX_ADMIN_EMAILS),
]);
const buildRows = (rows) => {
    if (!rows?.length)
        return "";
    return `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:18px;border:1px solid #dbe7ed;border-radius:14px;overflow:hidden">
      <tbody>
        ${rows
        .map((row) => `
              <tr>
                <td style="width:38%;padding:11px 14px;background:#f5fafc;border-bottom:1px solid #dbe7ed;color:#45616f;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(row.label)}</td>
                <td style="padding:11px 14px;border-bottom:1px solid #dbe7ed;color:#102f3f;font-size:14px;font-weight:700">${displayValue(row.value)}</td>
              </tr>
            `)
        .join("")}
      </tbody>
    </table>
  `;
};
const buildDocumentLinks = (documents) => {
    if (!documents?.length)
        return "";
    return `
    <div style="margin-top:18px">
      <p style="margin:0 0 8px;color:#45616f;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.05em">Documentos</p>
      ${documents
        .map((document) => `
            <a href="${escapeHtml(document.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:9px 12px;border:1px solid #cbdfe8;border-radius:999px;color:${brandBlue};font-size:13px;font-weight:800;text-decoration:none">${escapeHtml(document.label)}</a>
          `)
        .join("")}
    </div>
  `;
};
const buildBrandedHtml = ({ title, summary, rows, actionUrl, actionLabel = "Ver detalle", extraHtml = "", }) => `
  <div style="margin:0;padding:0;background:#eef5f8;font-family:Inter,Arial,sans-serif;color:#102f3f">
    <div style="max-width:680px;margin:0 auto;padding:28px 16px">
      <div style="overflow:hidden;border-radius:22px;background:#ffffff;border:1px solid #dbe7ed;box-shadow:0 18px 42px rgba(34,114,159,.16)">
        <div style="height:8px;background:linear-gradient(90deg,${brandOrange},${brandBlue})"></div>
        <div style="padding:26px 28px 20px">
          <p style="margin:0 0 14px;color:${brandOrange};font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase">Importadex</p>
          <h1 style="margin:0;color:${brandBlue};font-size:25px;line-height:1.22;font-weight:900">${escapeHtml(title)}</h1>
          <p style="margin:14px 0 0;color:#45616f;font-size:15px;line-height:1.62">${escapeHtml(summary)}</p>
          ${buildRows(rows)}
          ${extraHtml}
          ${actionUrl ? `<a href="${escapeHtml(actionUrl)}" style="display:inline-block;margin-top:20px;padding:12px 16px;border-radius:12px;background:${brandBlue};color:#ffffff;font-size:14px;font-weight:900;text-decoration:none">${escapeHtml(actionLabel)}</a>` : ""}
        </div>
        <div style="padding:18px 28px;background:#f5fafc;border-top:1px solid #dbe7ed;color:#6b7f89;font-size:12px;line-height:1.5">
          Este mensaje fue generado automaticamente por el modulo Importadex.
        </div>
      </div>
    </div>
  </div>
`;
const buildPlainText = ({ title, summary, rows, actionUrl, }) => [
    "Importadex",
    title,
    "",
    summary,
    "",
    ...(rows?.map((row) => `${row.label}: ${row.value ?? "No registrado"}`) ?? []),
    actionUrl ? "" : undefined,
    actionUrl ? `Enlace: ${actionUrl}` : undefined,
    "",
    "Este mensaje fue generado automaticamente por el modulo Importadex.",
].filter((line) => line !== undefined).join("\n");
const sendMail = async ({ to, subject, html, text, attachments, privateRecipients = false, }) => {
    if (!hasEmailConfig()) {
        console.warn("Importadex email not sent: SMTP_HOST, SMTP_USER or SMTP_PASSWORD is missing.");
        return { sent: false, skipped: true, recipients: Array.isArray(to) ? to.length : 1 };
    }
    const recipients = normalizeRecipients(to);
    if (recipients.skipped.length) {
        console.warn("Importadex email recipients skipped", {
            skipped: recipients.skipped.length,
            domains: summarizeDomains(recipients.skipped),
        });
    }
    if (!recipients.deliverable.length) {
        console.warn("Importadex email not sent: no deliverable recipients.", {
            skipped: recipients.skipped.length,
            domains: summarizeDomains(recipients.skipped),
        });
        return { sent: false, skipped: true, recipients: 0, skippedRecipients: recipients.skipped.length };
    }
    try {
        const fromAddress = getEmailFrom() ?? getSmtpUser() ?? "";
        const fromHeader = getMailFrom();
        await checkSenderDns();
        const attachmentOptions = attachments?.map((attachment) => ({
            filename: attachment.filename,
            path: attachment.path,
            contentType: attachment.contentType ?? undefined,
        }));
        if (privateRecipients) {
            const results = await Promise.allSettled(recipients.deliverable.map((recipient) => sendTransportMail({
                from: fromHeader,
                sender: fromAddress,
                replyTo: fromAddress,
                to: recipient,
                subject,
                text,
                html,
                headers: {
                    "X-Importadex-Notification": "true",
                    "X-Auto-Response-Suppress": "OOF, AutoReply",
                },
                attachments: attachmentOptions,
                envelope: {
                    from: fromAddress,
                    to: recipient,
                },
            })));
            const accepted = results.reduce((total, result) => {
                if (result.status !== "fulfilled")
                    return total;
                return total + (Array.isArray(result.value.accepted) ? result.value.accepted.length : 0);
            }, 0);
            const rejected = results.reduce((total, result) => {
                if (result.status !== "fulfilled")
                    return total + 1;
                return total + (Array.isArray(result.value.rejected) ? result.value.rejected.length : 0);
            }, 0);
            const responses = results.map((result, index) => {
                const recipient = maskEmail(recipients.deliverable[index]);
                if (result.status === "fulfilled") {
                    return {
                        recipient,
                        accepted: Array.isArray(result.value.accepted) ? result.value.accepted.length : undefined,
                        rejected: Array.isArray(result.value.rejected) ? result.value.rejected.length : undefined,
                        response: result.value.response,
                        messageId: result.value.messageId,
                    };
                }
                const smtpError = result.reason;
                return {
                    recipient,
                    code: smtpError.code,
                    command: smtpError.command,
                    responseCode: smtpError.responseCode,
                    response: smtpError.response,
                    message: smtpError.message,
                };
            });
            console.info("Importadex email sent", {
                host: getSmtpHost(),
                port: getSmtpPort(),
                secure: getSmtpSecure(),
                user: getSmtpUser(),
                from: fromHeader,
                recipients: recipients.deliverable.length,
                skippedRecipients: recipients.skipped.length,
                accepted,
                rejected,
                deliveryMode: "individual",
                responses,
            });
            return {
                sent: accepted > 0,
                skipped: false,
                recipients: recipients.deliverable.length,
                skippedRecipients: recipients.skipped.length,
                accepted,
                rejected,
            };
        }
        const info = await sendTransportMail({
            from: fromHeader,
            sender: fromAddress,
            replyTo: fromAddress,
            to: Array.isArray(to) ? recipients.deliverable : recipients.deliverable[0],
            subject,
            text,
            html,
            headers: {
                "X-Importadex-Notification": "true",
                "X-Auto-Response-Suppress": "OOF, AutoReply",
            },
            attachments: attachmentOptions,
            envelope: {
                from: fromAddress,
                to: recipients.deliverable,
            },
        });
        console.info("Importadex email sent", {
            host: getSmtpHost(),
            port: getSmtpPort(),
            secure: getSmtpSecure(),
            user: getSmtpUser(),
            from: fromHeader,
            recipients: recipients.deliverable.length,
            skippedRecipients: recipients.skipped.length,
            accepted: Array.isArray(info.accepted) ? info.accepted.length : undefined,
            rejected: Array.isArray(info.rejected) ? info.rejected.length : undefined,
            acceptedRecipients: Array.isArray(info.accepted) ? info.accepted.map((recipient) => maskEmail(String(recipient))) : undefined,
            rejectedRecipients: Array.isArray(info.rejected) ? info.rejected.map((recipient) => maskEmail(String(recipient))) : undefined,
            response: info.response,
            messageId: info.messageId,
        });
        return {
            sent: true,
            skipped: false,
            recipients: recipients.deliverable.length,
            skippedRecipients: recipients.skipped.length,
            accepted: Array.isArray(info.accepted) ? info.accepted.length : undefined,
            rejected: Array.isArray(info.rejected) ? info.rejected.length : undefined,
        };
    }
    catch (error) {
        const smtpError = error;
        console.error("Importadex email delivery failed", {
            host: getSmtpHost(),
            port: getSmtpPort(),
            secure: getSmtpSecure(),
            user: getSmtpUser(),
            from: getMailFrom(),
            code: smtpError.code,
            command: smtpError.command,
            responseCode: smtpError.responseCode,
            response: smtpError.response,
            message: smtpError.message,
        });
        return { sent: false, skipped: false, recipients: recipients.deliverable.length, skippedRecipients: recipients.skipped.length };
    }
};
async function verifyImportadexEmailTransport() {
    if (!hasEmailConfig()) {
        return { ok: false, message: "SMTP_HOST, SMTP_USER or SMTP_PASSWORD is missing" };
    }
    try {
        await transporter.verify();
        return {
            ok: true,
            host: getSmtpHost(),
            port: getSmtpPort(),
            secure: getSmtpSecure(),
            user: getSmtpUser(),
        };
    }
    catch (error) {
        const smtpError = error;
        console.error("Importadex email transport verification failed", {
            host: getSmtpHost(),
            port: getSmtpPort(),
            secure: getSmtpSecure(),
            user: getSmtpUser(),
            code: smtpError.code,
            command: smtpError.command,
            responseCode: smtpError.responseCode,
            response: smtpError.response,
            message: smtpError.message,
        });
        return { ok: false, message: smtpError.message ?? "SMTP verification failed" };
    }
}
async function sendImportadexInternalNotification(payload) {
    let users = [];
    const configuredRecipients = getConfiguredInternalRecipients();
    try {
        users = await (0, mirex_users_service_1.getImportadexNotificationUsers)();
    }
    catch (error) {
        console.error("Importadex notification recipients lookup failed", error);
    }
    const recipients = uniqueEmails([...configuredRecipients, ...users.map((user) => user.email)]);
    if (!recipients.length) {
        return { sent: false, skipped: true, internalRecipients: 0 };
    }
    const result = await sendMail({
        to: recipients,
        subject: payload.subject,
        html: buildBrandedHtml(payload),
        text: buildPlainText(payload),
        privateRecipients: true,
    });
    return {
        ...result,
        internalRecipients: result.recipients,
        skippedInternalRecipients: result.skippedRecipients,
        configuredInternalRecipients: recipients.length,
        configuredEnvRecipients: configuredRecipients.length,
    };
}
async function sendImportadexClientRegistrationEmails(payload) {
    const documentLinks = payload.tokenDocuments?.length
        ? buildDocumentLinks(payload.tokenDocuments)
        : `<p style="margin:18px 0 0;color:#45616f;font-size:14px;line-height:1.5">El cliente indico que ya posee token DGA.</p>`;
    const clientResult = await sendMail({
        to: payload.clientEmail,
        subject: "Registro Importadex recibido",
        html: buildBrandedHtml({
            title: "Registro recibido en Importadex",
            summary: `Hola ${payload.clientName}, recibimos tu registro correctamente. Nuestro equipo revisara la informacion y se comunicara contigo si necesita algun dato adicional.`,
            rows: [
                { label: "Cliente", value: payload.clientName },
                { label: "Tipo", value: payload.clientType },
                { label: "Identificacion", value: payload.identification },
                { label: "Token DGA", value: payload.hasDgaToken ? "Ya posee token" : "Requiere gestion" },
            ],
        }),
        text: buildPlainText({
            title: "Registro recibido en Importadex",
            summary: `Hola ${payload.clientName}, recibimos tu registro correctamente. Nuestro equipo revisara la informacion y se comunicara contigo si necesita algun dato adicional.`,
            rows: [
                { label: "Cliente", value: payload.clientName },
                { label: "Tipo", value: payload.clientType },
                { label: "Identificacion", value: payload.identification },
                { label: "Token DGA", value: payload.hasDgaToken ? "Ya posee token" : "Requiere gestion" },
            ],
        }),
    });
    const internalResult = await sendImportadexInternalNotification({
        subject: "Nuevo cliente Importadex registrado",
        title: "Nuevo cliente Importadex registrado",
        summary: "Un cliente completo el registro publico de Importadex y requiere revision administrativa.",
        rows: [
            { label: "Cliente", value: payload.clientName },
            { label: "Correo", value: payload.clientEmail },
            { label: "Tipo", value: payload.clientType },
            { label: "Identificacion", value: payload.identification },
            { label: "Token DGA", value: payload.hasDgaToken ? "Ya posee token" : "Requiere gestion" },
        ],
        extraHtml: documentLinks,
    });
    return {
        sent: clientResult.sent || internalResult.sent,
        skipped: clientResult.skipped && internalResult.skipped,
        clientSent: clientResult.sent,
        internalSent: internalResult.sent,
        internalRecipients: internalResult.internalRecipients,
    };
}
async function sendImportadexClientCommitmentEmail(payload) {
    return sendMail({
        to: payload.clientEmail,
        subject: "Carta de compromiso Importadex",
        html: buildBrandedHtml({
            title: "Carta de compromiso Importadex",
            summary: `Hola ${payload.clientName}, adjuntamos la carta de compromiso de Importadex para tu expediente. Tambien puedes abrirla desde el enlace de respaldo.`,
            rows: [
                { label: "Cliente", value: payload.clientName },
                { label: "Documento", value: payload.documentName },
            ],
            actionUrl: payload.documentUrl,
            actionLabel: "Abrir carta de compromiso",
        }),
        text: buildPlainText({
            title: "Carta de compromiso Importadex",
            summary: `Hola ${payload.clientName}, adjuntamos la carta de compromiso de Importadex para tu expediente. Tambien puedes abrirla desde el enlace de respaldo.`,
            rows: [
                { label: "Cliente", value: payload.clientName },
                { label: "Documento", value: payload.documentName },
            ],
            actionUrl: payload.documentUrl,
        }),
        attachments: [
            {
                filename: payload.documentName,
                path: payload.documentUrl,
                contentType: payload.documentType || "application/pdf",
            },
        ],
    });
}
