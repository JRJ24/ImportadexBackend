import nodemailer from "nodemailer";
import { resolveTxt } from "dns/promises";
import { randomUUID } from "crypto";
import { prisma } from "../config/connectionDB";
import { decrypt } from "./encrypted";
import { getImportadexNotificationUsers } from "../services/mirex-users.service";

const brandOrange = "#E97E26";
const brandBlue = "#22729F";

const parseEmailList = (value?: string) => value?.split(/[,;\s]+/).map((email) => email.trim()).filter(Boolean) ?? [];

const truthyValues = ["1", "true", "yes", "si", "sí"];

const parseBoolean = (value: string | undefined, defaultValue: boolean) => {
  if (value === undefined) return defaultValue;
  return truthyValues.includes(value.trim().toLowerCase());
};

const numberEnv = (key: string, fallback: number) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const getSmtpPort = () => Number(process.env.SMTP_PORT || 465);
const getSmtpSecure = () => {
  const value = process.env.SMTP_SECURE;
  if (value === undefined) return getSmtpPort() === 465;

  return parseBoolean(value, getSmtpPort() === 465);
};
const getSmtpUser = () => process.env.SMTP_USER || process.env.EMAILUSER;
const getSmtpPassword = () => process.env.SMTP_PASSWORD || process.env.EMAILPASS;
const getSmtpHost = () =>
  process.env.SMTP_HOST ||
  (getSmtpUser()?.toLowerCase().endsWith("@gmail.com") ? "smtp.gmail.com" : undefined);
const getEmailFrom = () => process.env.EMAIL_FROM || getSmtpUser();

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  source: string;
};

type SmtpAttempt = {
  host: string;
  port: number;
  secure: boolean;
  source: string;
  ok: boolean;
  code?: string;
  command?: string;
  responseCode?: number;
  response?: string;
  message?: string;
};

const smtpTimeouts = () => ({
  connectionTimeout: numberEnv("SMTP_CONNECTION_TIMEOUT_MS", 10_000),
  greetingTimeout: numberEnv("SMTP_GREETING_TIMEOUT_MS", 10_000),
  socketTimeout: numberEnv("SMTP_SOCKET_TIMEOUT_MS", 20_000),
});

const formatSmtpConfig = (config?: Pick<SmtpConfig, "host" | "port" | "secure" | "source"> | null) =>
  config ? `${config.host}:${config.port}:${config.secure ? "secure" : "starttls"}:${config.source}` : null;

const getPrimarySmtpConfig = (): SmtpConfig | null => {
  const host = getSmtpHost();
  const user = getSmtpUser();
  const pass = getSmtpPassword();
  if (!host || !user || !pass) return null;

  return {
    host,
    port: getSmtpPort(),
    secure: getSmtpSecure(),
    user,
    pass,
    source: "primary",
  };
};

const parseSmtpFallback = (value: string, base: SmtpConfig): SmtpConfig | null => {
  const [host, portValue, secureValue] = value.split(":").map((part) => part.trim());
  if (!host) return null;
  const port = Number(portValue) || base.port;

  return {
    host,
    port,
    secure: parseBoolean(secureValue, port === 465),
    user: base.user,
    pass: base.pass,
    source: "env-fallback",
  };
};

const getSmtpConfigs = () => {
  const primary = getPrimarySmtpConfig();
  if (!primary) return [];

  const configs: SmtpConfig[] = [primary];
  if (primary.port !== 587) {
    configs.push({ ...primary, port: 587, secure: false, source: "fallback-587" });
  }
  if (primary.host.toLowerCase() === "mail.importadex.do") {
    configs.push({ ...primary, host: "box2419.bluehost.com", port: 465, secure: true, source: "bluehost-box-465" });
    configs.push({ ...primary, host: "box2419.bluehost.com", port: 587, secure: false, source: "bluehost-box-587" });
  }

  for (const fallback of parseEmailList(process.env.SMTP_FALLBACK_HOSTS)) {
    const parsed = parseSmtpFallback(fallback, primary);
    if (parsed) configs.push(parsed);
  }

  const seen = new Set<string>();
  return configs.filter((config) => {
    const key = `${config.host.toLowerCase()}:${config.port}:${config.secure}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const createTransporter = (config: SmtpConfig) =>
  nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    name: "importadex.do",
    auth: {
      user: config.user,
      pass: config.pass,
    },
    ...smtpTimeouts(),
  });

interface RegistrationEmailPayload {
  clientId?: string | null;
  clientName: string;
  clientEmail: string;
  clientType: string;
  identification: string;
  hasDgaToken: boolean;
  tokenDocuments?: Array<{ label: string; url: string }>;
}

interface CommitmentEmailPayload {
  clientId?: string | null;
  clientName: string;
  clientEmail: string;
  documentName: string;
  documentUrl: string;
  documentType?: string | null;
}

interface OperationEmailPayload {
  operationId?: string | null;
  clientId?: string | null;
  clientName: string;
  clientEmail: string;
  operationCode: string;
  operationType?: string | null;
  transportMode?: string | null;
  status?: string | null;
  origin?: string | null;
  destination?: string | null;
}

interface ClientReviewEmailPayload {
  clientId?: string | null;
  clientName: string;
  clientEmail: string;
  status: "APPROVED" | "REJECTED";
  feedBack?: string | null;
}

interface OperationUpdateEmailPayload {
  operationId?: string | null;
  clientId?: string | null;
  clientEmail: string;
  operationCode: string;
  title: string;
  summary: string;
  rows?: Array<{ label: string; value: string | number | null | undefined }>;
}

export interface ImportadexInternalNotificationPayload {
  operationId?: string | null;
  clientId?: string | null;
  subject: string;
  title: string;
  summary: string;
  rows?: Array<{ label: string; value: string | number | null | undefined }>;
  actionUrl?: string | null;
  actionLabel?: string;
  extraHtml?: string;
}

type EmailAttachment = {
  filename: string;
  path: string;
  contentType?: string | null;
};

type SentMessageInfo = {
  accepted?: unknown[];
  rejected?: unknown[];
  response?: string;
  messageId?: string;
  smtpConfig?: SmtpConfig;
  smtpAttempts?: SmtpAttempt[];
};

type EmailStatus = "QUEUED" | "ACCEPTED" | "FAILED" | "SKIPPED";

type EmailLogRecord = {
  id: string;
  recipient: string;
};

type EmailLogParams = {
  id?: string;
  status: EmailStatus;
  audience: string;
  subject: string;
  recipient: string;
  operationId?: string | null;
  clientId?: string | null;
  smtpHost?: string | null;
  messageId?: string | null;
  smtpResponse?: string | null;
  accepted?: number;
  rejected?: number;
  skipped?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
};

const hasEmailConfig = () => Boolean(getPrimarySmtpConfig());

const isLocalRecipientAllowed = () =>
  ["1", "true", "yes", "si", "sí"].includes((process.env.SMTP_ALLOW_LOCAL_RECIPIENTS ?? "").trim().toLowerCase());

const getRecipientDomain = (email: string) => email.split("@")[1]?.trim().toLowerCase() ?? "";

const safeDecryptRecipient = (recipient: string) => {
  try {
    return decrypt(recipient).trim();
  } catch {
    return recipient.trim();
  }
};

const isDeliverableRecipient = (email: string) => {
  const normalizedEmail = email.trim().toLowerCase();
  const domain = getRecipientDomain(normalizedEmail);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return false;
  if (!isLocalRecipientAllowed() && domain.endsWith(".local")) return false;

  return true;
};

const normalizeRecipients = (to: string | string[]) => {
  const recipients = (Array.isArray(to) ? to : [to]).map(safeDecryptRecipient);
  const unique = uniqueEmails(recipients);
  const deliverable = unique.filter(isDeliverableRecipient);
  const skipped = unique.filter((email) => !isDeliverableRecipient(email));

  return { deliverable, skipped };
};

const summarizeDomains = (emails: string[]) =>
  emails.reduce<Record<string, number>>((summary, email) => {
    const domain = getRecipientDomain(email) || "invalid";
    summary[domain] = (summary[domain] ?? 0) + 1;
    return summary;
  }, {});

const maskEmail = (email: string) => {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.length <= 2 ? local : local.slice(0, 2);
  return `${visible}***@${domain || "invalid"}`;
};

const getMailFrom = () => {
  const from = getEmailFrom();
  return from ? `Importadex <${from}>` : "Importadex";
};

const toSmtpAttempt = (config: SmtpConfig, error?: unknown): SmtpAttempt => {
  const smtpError = error as { code?: string; command?: string; responseCode?: number; response?: string; message?: string };
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    source: config.source,
    ok: !error,
    code: smtpError?.code,
    command: smtpError?.command,
    responseCode: smtpError?.responseCode,
    response: smtpError?.response,
    message: smtpError?.message,
  };
};

const attachSmtpAttempts = (error: unknown, attempts: SmtpAttempt[]) => {
  const smtpError = error as { smtpAttempts?: SmtpAttempt[]; smtpConfig?: SmtpConfig };
  smtpError.smtpAttempts = attempts;
  const lastAttempt = attempts[attempts.length - 1];
  if (lastAttempt) {
    smtpError.smtpConfig = {
      host: lastAttempt.host,
      port: lastAttempt.port,
      secure: lastAttempt.secure,
      user: getSmtpUser() ?? "",
      pass: getSmtpPassword() ?? "",
      source: lastAttempt.source,
    };
  }
  return error;
};

const getErrorSmtpHost = (error: unknown) => {
  const smtpError = error as { smtpConfig?: SmtpConfig; smtpAttempts?: SmtpAttempt[] };
  if (smtpError.smtpConfig) return formatSmtpConfig(smtpError.smtpConfig);
  const lastAttempt = smtpError.smtpAttempts?.[smtpError.smtpAttempts.length - 1];
  return lastAttempt ? formatSmtpConfig(lastAttempt) : null;
};

const sendTransportMail = async (mailOptions: Record<string, unknown>): Promise<SentMessageInfo> => {
  const configs = getSmtpConfigs();
  const attempts: SmtpAttempt[] = [];
  let lastError: unknown = new Error("SMTP_HOST, SMTP_USER or SMTP_PASSWORD is missing");

  for (const config of configs) {
    try {
      const transporter = createTransporter(config);
      const info = await (transporter.sendMail as unknown as (options: Record<string, unknown>) => Promise<SentMessageInfo>)(mailOptions);
      attempts.push(toSmtpAttempt(config));
      return { ...info, smtpConfig: config, smtpAttempts: attempts };
    } catch (error) {
      attempts.push(toSmtpAttempt(config, error));
      lastError = error;
    }
  }

  throw attachSmtpAttempts(lastError, attempts);
};

const getMaxConcurrentSends = () => numberEnv("SMTP_MAX_CONCURRENT_SENDS", 2);

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await task(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

let dnsWarningLogged = false;

const getEmailDomain = (email?: string) => email?.split("@")[1]?.trim().toLowerCase();

const checkSenderDns = async () => {
  if (dnsWarningLogged) return;
  dnsWarningLogged = true;

  const fromDomain = getEmailDomain(getEmailFrom());
  const smtpHost = getSmtpHost()?.toLowerCase() ?? "";
  if (!fromDomain || !smtpHost.includes("gmail")) return;

  try {
    const [spfRecords, dkimRecords] = await Promise.allSettled([
      resolveTxt(fromDomain),
      resolveTxt(`google._domainkey.${fromDomain}`),
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
  } catch (error) {
    console.warn("Importadex sender DNS check failed", {
      fromDomain,
      smtpHost: getSmtpHost(),
      message: error instanceof Error ? error.message : "DNS check failed",
    });
  }
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const displayValue = (value: string | number | null | undefined) =>
  escapeHtml(value === undefined || value === null || value === "" ? "No registrado" : String(value));

const uniqueEmails = (emails: string[]) =>
  Array.from(new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean)));

const normalizeEmailArray = (emails?: unknown[]) => uniqueEmails(emails?.map((email) => safeDecryptRecipient(String(email))) ?? []);

const hasEmail = (emails: string[], email: string) => emails.some((item) => item.toLowerCase() === email.toLowerCase());

let emailLogWarningLogged = false;

const logEmailWarning = (error: unknown) => {
  if (emailLogWarningLogged) return;
  emailLogWarningLogged = true;
  console.warn("Importadex email log persistence failed", {
    message: error instanceof Error ? error.message : "Email log persistence failed",
  });
};

const insertEmailLog = async ({
  id = randomUUID(),
  status,
  audience,
  subject,
  recipient,
  operationId,
  clientId,
  smtpHost,
  messageId,
  smtpResponse,
  accepted = 0,
  rejected = 0,
  skipped = false,
  errorCode,
  errorMessage,
}: EmailLogParams) => {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO importadex_email_logs (
        id, status, audience, subject, recipient_masked, recipient_domain,
        operation_id, client_id, smtp_host, smtp_user, message_id, smtp_response,
        accepted, rejected, skipped, error_code, error_message, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id,
      status,
      audience,
      subject,
      maskEmail(recipient),
      getRecipientDomain(recipient) || null,
      operationId ?? null,
      clientId ?? null,
      smtpHost ?? formatSmtpConfig(getPrimarySmtpConfig()),
      getSmtpUser() ?? null,
      messageId ?? null,
      smtpResponse ?? null,
      accepted,
      rejected,
      skipped,
      errorCode ?? null,
      errorMessage ?? null,
    );
  } catch (error) {
    logEmailWarning(error);
  }
};

const updateEmailLog = async (id: string, params: Omit<EmailLogParams, "id" | "audience" | "subject" | "recipient" | "operationId" | "clientId">) => {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE importadex_email_logs
       SET status = $2,
           message_id = $3,
           smtp_response = $4,
           accepted = $5,
           rejected = $6,
           skipped = $7,
           error_code = $8,
           error_message = $9,
           smtp_host = COALESCE($10, smtp_host),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      id,
      params.status,
      params.messageId ?? null,
      params.smtpResponse ?? null,
      params.accepted ?? 0,
      params.rejected ?? 0,
      params.skipped ?? false,
      params.errorCode ?? null,
      params.errorMessage ?? null,
      params.smtpHost ?? null,
    );
  } catch (error) {
    logEmailWarning(error);
  }
};

const createQueuedLogs = async ({
  recipients,
  audience,
  subject,
  operationId,
  clientId,
}: {
  recipients: string[];
  audience: string;
  subject: string;
  operationId?: string | null;
  clientId?: string | null;
}) => {
  const records = recipients.map((recipient) => ({ id: randomUUID(), recipient }));
  await Promise.all(records.map((record) => insertEmailLog({
    id: record.id,
    status: "QUEUED",
    audience,
    subject,
    recipient: record.recipient,
    operationId,
    clientId,
  })));
  return records;
};

const createSkippedLogs = async ({
  recipients,
  audience,
  subject,
  operationId,
  clientId,
  reason,
}: {
  recipients: string[];
  audience: string;
  subject: string;
  operationId?: string | null;
  clientId?: string | null;
  reason: string;
}) => {
  await Promise.all(recipients.map((recipient) => insertEmailLog({
    status: "SKIPPED",
    audience,
    subject,
    recipient,
    operationId,
    clientId,
    skipped: true,
    errorMessage: reason,
  })));
};

const getAuditBccRecipients = () => normalizeRecipients(parseEmailList(process.env.IMPORTADEX_EMAIL_AUDIT_BCC));

const buildRows = (rows?: ImportadexInternalNotificationPayload["rows"]) => {
  if (!rows?.length) return "";

  return `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:18px;border:1px solid #dbe7ed;border-radius:14px;overflow:hidden">
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td style="width:38%;padding:11px 14px;background:#f5fafc;border-bottom:1px solid #dbe7ed;color:#45616f;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(row.label)}</td>
                <td style="padding:11px 14px;border-bottom:1px solid #dbe7ed;color:#102f3f;font-size:14px;font-weight:700">${displayValue(row.value)}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
};

const buildDocumentLinks = (documents?: Array<{ label: string; url: string }>) => {
  if (!documents?.length) return "";

  return `
    <div style="margin-top:18px">
      <p style="margin:0 0 8px;color:#45616f;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.05em">Documentos</p>
      ${documents
        .map(
          (document) => `
            <a href="${escapeHtml(document.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:9px 12px;border:1px solid #cbdfe8;border-radius:999px;color:${brandBlue};font-size:13px;font-weight:800;text-decoration:none">${escapeHtml(document.label)}</a>
          `,
        )
        .join("")}
    </div>
  `;
};

const buildBrandedHtml = ({
  title,
  summary,
  rows,
  actionUrl,
  actionLabel = "Ver detalle",
  extraHtml = "",
}: Omit<ImportadexInternalNotificationPayload, "subject">) => `
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

const buildPlainText = ({
  title,
  summary,
  rows,
  actionUrl,
}: Omit<ImportadexInternalNotificationPayload, "subject" | "extraHtml" | "actionLabel">) => [
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
].filter((line): line is string => line !== undefined).join("\n");

const sendMail = async ({
  to,
  subject,
  html,
  text,
  attachments,
  audience = "general",
  operationId,
  clientId,
  privateRecipients = false,
}: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  audience?: string;
  operationId?: string | null;
  clientId?: string | null;
  privateRecipients?: boolean;
}) => {
  const recipients = normalizeRecipients(to);
  const auditRecipients = getAuditBccRecipients();

  if (auditRecipients.skipped.length) {
    console.warn("Importadex email audit BCC recipients skipped", {
      audience,
      skipped: auditRecipients.skipped.length,
      domains: summarizeDomains(auditRecipients.skipped),
    });
  }

  if (recipients.skipped.length) {
    console.warn("Importadex email recipients skipped", {
      audience,
      skipped: recipients.skipped.length,
      domains: summarizeDomains(recipients.skipped),
    });
    await createSkippedLogs({
      recipients: recipients.skipped,
      audience,
      subject,
      operationId,
      clientId,
      reason: "Recipient is invalid or local-only",
    });
  }

  if (!hasEmailConfig()) {
    console.warn("Importadex email not sent: SMTP_HOST, SMTP_USER or SMTP_PASSWORD is missing.", { audience });
    await Promise.all(recipients.deliverable.map((recipient) => insertEmailLog({
      status: "FAILED",
      audience,
      subject,
      recipient,
      operationId,
      clientId,
      errorMessage: "SMTP_HOST, SMTP_USER or SMTP_PASSWORD is missing",
    })));
    return { sent: false, skipped: true, recipients: recipients.deliverable.length, skippedRecipients: recipients.skipped.length };
  }

  if (!recipients.deliverable.length) {
    console.warn("Importadex email not sent: no deliverable recipients.", {
      audience,
      skipped: recipients.skipped.length,
      domains: summarizeDomains(recipients.skipped),
    });
    return { sent: false, skipped: true, recipients: 0, skippedRecipients: recipients.skipped.length };
  }

  const queuedLogs = await createQueuedLogs({
    recipients: recipients.deliverable,
    audience,
    subject,
    operationId,
    clientId,
  });

  try {
    const fromAddress = getEmailFrom() ?? getSmtpUser() ?? "";
    const fromHeader = getMailFrom();
    const auditBcc = auditRecipients.deliverable;
    await checkSenderDns();
    const attachmentOptions = attachments?.map((attachment) => ({
      filename: attachment.filename,
      path: attachment.path,
      contentType: attachment.contentType ?? undefined,
    }));

    if (privateRecipients) {
      const results = await mapWithConcurrency(
        recipients.deliverable,
        getMaxConcurrentSends(),
        (recipient) =>
          sendTransportMail({
            from: fromHeader,
            sender: fromAddress,
            replyTo: fromAddress,
            to: recipient,
            bcc: auditBcc.length ? auditBcc : undefined,
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
              to: uniqueEmails([recipient, ...auditBcc]),
            },
          }),
      );

      const logUpdates: Array<Promise<void>> = [];
      const deliveryResults = results.map((result, index) => {
        const recipient = recipients.deliverable[index];
        const log = queuedLogs[index];

        if (result.status === "fulfilled") {
          const acceptedList = normalizeEmailArray(result.value.accepted);
          const rejectedList = normalizeEmailArray(result.value.rejected);
          const mainAccepted = acceptedList.length ? hasEmail(acceptedList, recipient) : !hasEmail(rejectedList, recipient);
          const status: EmailStatus = mainAccepted ? "ACCEPTED" : "FAILED";
          logUpdates.push(updateEmailLog(log.id, {
            status,
            smtpHost: formatSmtpConfig(result.value.smtpConfig),
            messageId: result.value.messageId,
            smtpResponse: result.value.response,
            accepted: mainAccepted ? 1 : 0,
            rejected: mainAccepted ? 0 : 1,
            skipped: false,
            errorMessage: mainAccepted ? null : "Recipient was rejected by SMTP server",
          }));

          return {
            recipient,
            accepted: mainAccepted ? 1 : 0,
            rejected: mainAccepted ? 0 : 1,
            smtpAccepted: acceptedList.length,
            smtpRejected: rejectedList.length,
            response: result.value.response,
            messageId: result.value.messageId,
          };
        }

        const smtpError = result.reason as { code?: string; command?: string; responseCode?: number; response?: string; message?: string };
        logUpdates.push(updateEmailLog(log.id, {
          status: "FAILED",
          smtpHost: getErrorSmtpHost(smtpError),
          smtpResponse: smtpError.response,
          accepted: 0,
          rejected: 1,
          skipped: false,
          errorCode: smtpError.code,
          errorMessage: smtpError.message,
        }));

        return {
          recipient,
          accepted: 0,
          rejected: 1,
          code: smtpError.code,
          command: smtpError.command,
          responseCode: smtpError.responseCode,
          response: smtpError.response,
          message: smtpError.message,
        };
      });

      const accepted = deliveryResults.reduce((total, result) => total + result.accepted, 0);
      const rejected = deliveryResults.reduce((total, result) => total + result.rejected, 0);
      await Promise.all(logUpdates);
      const responses = results.map((result, index) => {
        const recipient = maskEmail(recipients.deliverable[index]);
        if (result.status === "fulfilled") {
          const deliveryResult = deliveryResults[index];
          return {
            recipient,
            accepted: deliveryResult.accepted,
            rejected: deliveryResult.rejected,
            smtpAccepted: deliveryResult.smtpAccepted,
            smtpRejected: deliveryResult.smtpRejected,
            response: result.value.response,
            messageId: result.value.messageId,
          };
        }

        const smtpError = result.reason as { code?: string; command?: string; responseCode?: number; response?: string; message?: string };
        return {
          recipient,
          code: smtpError.code,
          command: smtpError.command,
          responseCode: smtpError.responseCode,
          response: smtpError.response,
          message: smtpError.message,
        };
      });

      const logPayload = {
        audience,
        host: getSmtpHost(),
        port: getSmtpPort(),
        secure: getSmtpSecure(),
        user: getSmtpUser(),
        from: fromHeader,
        recipients: recipients.deliverable.length,
        skippedRecipients: recipients.skipped.length,
        auditBccRecipients: auditBcc.length,
        accepted,
        rejected,
        deliveryMode: "individual",
        responses,
      };

      if (accepted > 0) {
        console.info("Importadex email sent", logPayload);
      } else {
        console.error("Importadex email delivery failed", logPayload);
      }

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
      bcc: auditBcc.length ? auditBcc : undefined,
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
        to: uniqueEmails([...recipients.deliverable, ...auditBcc]),
      },
    });

    const rejectedList = normalizeEmailArray(info.rejected);
    const acceptedList = normalizeEmailArray(info.accepted);
    const logUpdates: Array<Promise<void>> = [];
    const deliveryResults = recipients.deliverable.map((recipient, index) => {
      const mainAccepted = acceptedList.length ? hasEmail(acceptedList, recipient) : !hasEmail(rejectedList, recipient);
      const log = queuedLogs[index];
      logUpdates.push(updateEmailLog(log.id, {
        status: mainAccepted ? "ACCEPTED" : "FAILED",
        smtpHost: formatSmtpConfig(info.smtpConfig),
        messageId: info.messageId,
        smtpResponse: info.response,
        accepted: mainAccepted ? 1 : 0,
        rejected: mainAccepted ? 0 : 1,
        skipped: false,
        errorMessage: mainAccepted ? null : "Recipient was rejected by SMTP server",
      }));
      return { recipient, accepted: mainAccepted ? 1 : 0, rejected: mainAccepted ? 0 : 1 };
    });

    const accepted = deliveryResults.reduce((total, result) => total + result.accepted, 0);
    const rejected = deliveryResults.reduce((total, result) => total + result.rejected, 0);
    await Promise.all(logUpdates);

    const logPayload = {
      audience,
      host: getSmtpHost(),
      port: getSmtpPort(),
      secure: getSmtpSecure(),
      user: getSmtpUser(),
      from: fromHeader,
      recipients: recipients.deliverable.length,
      skippedRecipients: recipients.skipped.length,
      auditBccRecipients: auditBcc.length,
      accepted,
      rejected,
      smtpAccepted: acceptedList.length,
      smtpRejected: rejectedList.length,
      acceptedRecipients: Array.isArray(info.accepted) ? info.accepted.map((recipient: unknown) => maskEmail(String(recipient))) : undefined,
      rejectedRecipients: Array.isArray(info.rejected) ? info.rejected.map((recipient: unknown) => maskEmail(String(recipient))) : undefined,
      response: info.response,
      messageId: info.messageId,
    };

    if (accepted > 0) {
      console.info("Importadex email sent", logPayload);
    } else {
      console.error("Importadex email delivery failed", logPayload);
    }

    return {
      sent: accepted > 0,
      skipped: false,
      recipients: recipients.deliverable.length,
      skippedRecipients: recipients.skipped.length,
      accepted,
      rejected,
    };
  } catch (error) {
    const smtpError = error as { code?: string; command?: string; responseCode?: number; response?: string; message?: string };
    await Promise.all(queuedLogs.map((log) => updateEmailLog(log.id, {
      status: "FAILED",
      smtpHost: getErrorSmtpHost(smtpError),
      smtpResponse: smtpError.response,
      accepted: 0,
      rejected: 1,
      skipped: false,
      errorCode: smtpError.code,
      errorMessage: smtpError.message,
    })));
    console.error("Importadex email delivery failed", {
      audience,
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

export async function verifyImportadexEmailTransport() {
  return checkImportadexEmailHealth();
}

export async function checkImportadexEmailHealth() {
  if (!hasEmailConfig()) {
    return { ok: false, message: "SMTP_HOST, SMTP_USER or SMTP_PASSWORD is missing", attempts: [] };
  }

  const attempts: SmtpAttempt[] = [];
  for (const config of getSmtpConfigs()) {
    try {
      const transporter = createTransporter(config);
      await transporter.verify();
      attempts.push(toSmtpAttempt(config));
      return {
        ok: true,
        host: config.host,
        port: config.port,
        secure: config.secure,
        source: config.source,
        user: config.user,
        timeouts: smtpTimeouts(),
        attempts,
      };
    } catch (error) {
      attempts.push(toSmtpAttempt(config, error));
    }
  }

  const lastAttempt = attempts[attempts.length - 1];
  console.error("Importadex email transport verification failed", {
    host: lastAttempt?.host ?? getSmtpHost(),
    port: lastAttempt?.port ?? getSmtpPort(),
    secure: lastAttempt?.secure ?? getSmtpSecure(),
    user: getSmtpUser(),
    code: lastAttempt?.code,
    command: lastAttempt?.command,
    responseCode: lastAttempt?.responseCode,
    response: lastAttempt?.response,
    message: lastAttempt?.message,
    attempts,
  });

  return {
    ok: false,
    host: lastAttempt?.host ?? getSmtpHost(),
    port: lastAttempt?.port ?? getSmtpPort(),
    secure: lastAttempt?.secure ?? getSmtpSecure(),
    user: getSmtpUser(),
    code: lastAttempt?.code,
    command: lastAttempt?.command,
    responseCode: lastAttempt?.responseCode,
    response: lastAttempt?.response,
    message: lastAttempt?.message ?? "SMTP verification failed",
    timeouts: smtpTimeouts(),
    attempts,
  };
}

export async function sendImportadexInternalNotification(payload: ImportadexInternalNotificationPayload) {
  let users: Awaited<ReturnType<typeof getImportadexNotificationUsers>> = [];
  try {
    users = await getImportadexNotificationUsers();
  } catch (error) {
    console.error("Importadex notification recipients lookup failed", error);
    return { sent: false, skipped: true, internalRecipients: 0 };
  }
  const recipients = uniqueEmails(users.map((user) => user.email));

  if (!recipients.length) {
    return { sent: false, skipped: true, internalRecipients: 0 };
  }

  const result = await sendMail({
    to: recipients,
    subject: payload.subject,
    html: buildBrandedHtml(payload),
    text: buildPlainText(payload),
    audience: "internal",
    operationId: payload.operationId,
    clientId: payload.clientId,
    privateRecipients: true,
  });

  return {
    ...result,
    internalRecipients: result.recipients,
    skippedInternalRecipients: result.skippedRecipients,
    resolvedInternalRecipients: recipients.length,
  };
}

export async function sendImportadexClientRegistrationEmails(payload: RegistrationEmailPayload) {
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
    audience: "client",
    clientId: payload.clientId,
  });

  const internalResult = await sendImportadexInternalNotification({
    clientId: payload.clientId,
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

export async function sendImportadexClientOperationEmail(payload: OperationEmailPayload) {
  const rows = [
    { label: "Operacion", value: payload.operationCode },
    { label: "Estado", value: payload.status },
    { label: "Tipo", value: payload.operationType },
    { label: "Transporte", value: payload.transportMode },
    { label: "Origen", value: payload.origin },
    { label: "Destino", value: payload.destination },
  ];

  return sendMail({
    to: payload.clientEmail,
    subject: `Operacion Importadex creada ${payload.operationCode}`,
    html: buildBrandedHtml({
      title: "Operacion Importadex creada",
      summary: `Hola ${payload.clientName}, se creo una operacion Importadex asociada a tu cuenta. Nuestro equipo dara seguimiento al proceso y te contactara si necesita informacion adicional.`,
      rows,
    }),
    text: buildPlainText({
      title: "Operacion Importadex creada",
      summary: `Hola ${payload.clientName}, se creo una operacion Importadex asociada a tu cuenta. Nuestro equipo dara seguimiento al proceso y te contactara si necesita informacion adicional.`,
      rows,
    }),
    audience: "client",
    operationId: payload.operationId,
    clientId: payload.clientId,
  });
}

export async function sendImportadexTestEmail(to: string, actor?: string | null) {
  const subject = `Prueba SMTP Importadex ${new Date().toISOString()}`;
  return sendMail({
    to,
    subject,
    html: buildBrandedHtml({
      title: "Prueba SMTP Importadex",
      summary: "Este mensaje confirma que el backend Importadex puede entregar correos mediante la configuracion SMTP activa.",
      rows: [
        { label: "Remitente", value: getEmailFrom() },
        { label: "SMTP", value: getSmtpHost() },
        { label: "Solicitado por", value: actor },
      ],
    }),
    text: buildPlainText({
      title: "Prueba SMTP Importadex",
      summary: "Este mensaje confirma que el backend Importadex puede entregar correos mediante la configuracion SMTP activa.",
      rows: [
        { label: "Remitente", value: getEmailFrom() },
        { label: "SMTP", value: getSmtpHost() },
        { label: "Solicitado por", value: actor },
      ],
    }),
    audience: "test",
  });
}

export async function sendImportadexClientCommitmentEmail(payload: CommitmentEmailPayload) {
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
    audience: "client",
    clientId: payload.clientId,
  });
}

export async function sendImportadexClientReviewEmail(payload: ClientReviewEmailPayload) {
  const approved = payload.status === "APPROVED";
  const title = approved ? "Registro Importadex aprobado" : "Registro Importadex rechazado";
  const summary = approved
    ? `Hola ${payload.clientName}, tu registro en Importadex fue aprobado. Ya puedes iniciar operaciones desde la plataforma.`
    : `Hola ${payload.clientName}, tu registro en Importadex fue rechazado.${payload.feedBack ? "" : " Contacta a nuestro equipo si necesitas mas informacion."}`;
  const rows = [
    { label: "Estado", value: approved ? "Aprobado" : "Rechazado" },
    ...(payload.feedBack ? [{ label: "Motivo", value: payload.feedBack }] : []),
  ];

  return sendMail({
    to: payload.clientEmail,
    subject: title,
    html: buildBrandedHtml({ title, summary, rows }),
    text: buildPlainText({ title, summary, rows }),
    audience: "client",
    clientId: payload.clientId,
  });
}

export async function sendImportadexClientOperationUpdateEmail(payload: OperationUpdateEmailPayload) {
  return sendMail({
    to: payload.clientEmail,
    subject: `${payload.title} ${payload.operationCode}`,
    html: buildBrandedHtml({ title: payload.title, summary: payload.summary, rows: payload.rows }),
    text: buildPlainText({ title: payload.title, summary: payload.summary, rows: payload.rows }),
    audience: "client",
    operationId: payload.operationId,
    clientId: payload.clientId,
  });
}
