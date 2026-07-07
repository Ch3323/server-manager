import { Resend } from "resend";

type AuthEmailKind = "verify-email" | "reset-password";

let resendClient: Resend | null = null;

function getBaseUrl() {
  return process.env.NEXTAUTH_URL?.replace(/\/+$/, "") || "http://localhost:3001";
}

function getResendClient(apiKey: string) {
  resendClient ??= new Resend(apiKey);
  return resendClient;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildAuthLink(kind: AuthEmailKind, token: string) {
  const path = kind === "verify-email" ? "/auth/verify-email" : "/auth/reset-password";
  const url = new URL(path, getBaseUrl());
  url.searchParams.set("token", token);
  return url.toString();
}

function buildAuthEmailContent(kind: AuthEmailKind, link: string, expiresAt: Date) {
  const action = kind === "verify-email" ? "Verify email" : "Reset password";
  const intro = kind === "verify-email"
    ? "Use the button below to verify your Server Manager email."
    : "Use the button below to reset your Server Manager password.";
  const escapedLink = escapeHtml(link);
  const expiresText = expiresAt.toISOString();

  return {
    text: [
      intro,
      "",
      `${action}: ${link}`,
      "",
      `This link expires at ${expiresText}.`,
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
        <p>${escapeHtml(intro)}</p>
        <p>
          <a href="${escapedLink}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:6px">
            ${escapeHtml(action)}
          </a>
        </p>
        <p style="font-size:14px;color:#4b5563">This link expires at ${escapeHtml(expiresText)}.</p>
        <p style="font-size:14px;color:#4b5563">If you did not request this, you can ignore this email.</p>
      </div>
    `,
  };
}

export async function sendAuthEmail(options: {
  to: string;
  kind: AuthEmailKind;
  token: string;
  expiresAt: Date;
}) {
  const link = buildAuthLink(options.kind, options.token);
  const subject = options.kind === "verify-email"
    ? "Verify your Server Manager email"
    : "Reset your Server Manager password";
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const resendFromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  const webhookUrl = process.env.AUTH_EMAIL_WEBHOOK_URL?.trim();

  if (resendApiKey && resendFromEmail) {
    const { html, text } = buildAuthEmailContent(options.kind, link, options.expiresAt);
    const { error } = await getResendClient(resendApiKey).emails.send({
      from: resendFromEmail,
      to: options.to,
      subject,
      html,
      text,
    });

    if (error) {
      throw new Error(error.message);
    }

    return;
  }

  if (webhookUrl) {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: options.to,
        subject,
        link,
        kind: options.kind,
        expiresAt: options.expiresAt.toISOString(),
      }),
    });
    return;
  }

  console.log(`[auth-email] ${subject} for ${options.to}: ${link}`);
}
