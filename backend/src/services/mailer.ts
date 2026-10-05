import nodemailer, { Transporter } from 'nodemailer';
import { CONFIG } from '../config.js';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!CONFIG.emailEnabled) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: CONFIG.smtpHost,
    port: CONFIG.smtpPort,
    secure: CONFIG.smtpPort === 465,
    auth:
      CONFIG.smtpUser && CONFIG.smtpPass
        ? { user: CONFIG.smtpUser, pass: CONFIG.smtpPass }
        : undefined,
  });
  return transporter;
}

const BRAND = '#635bff';

/**
 * Build the verification email body. Email clients ignore <style> blocks in
 * some cases, so all critical styling is inline and the layout uses tables for
 * the broadest client support (Gmail, Outlook, Apple Mail).
 */
function verificationEmailHtml(link: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>Confirm your email</title>
</head>
<body style="margin:0;padding:0;background:#f4f5fb;-webkit-font-smoothing:antialiased;">
  <!-- Preheader (hidden preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    One click to unlock member conversions — up to ${CONFIG.memberTierMaxSlides} slides per document.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5fb;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(26,31,54,0.08);">

          <!-- Header band -->
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND} 0%,#5048e7 100%);padding:28px 32px;" align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right:10px;vertical-align:middle;">
                    <span style="display:inline-block;width:34px;height:34px;line-height:34px;background:#ffffff;border-radius:9px;text-align:center;font:700 18px/34px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${BRAND};">D</span>
                  </td>
                  <td style="font:700 19px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#ffffff;letter-spacing:-0.02em;vertical-align:middle;">
                    DocSend&nbsp;PDF
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 8px;">
              <h1 style="margin:0 0 12px;font:700 24px/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1f36;letter-spacing:-0.02em;">
                Welcome — you're almost in
              </h1>
              <p style="margin:0 0 16px;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#4b5563;">
                Confirm your email to unlock <strong style="color:#1a1f36;">member conversions</strong> — turn any DocSend link into a pixel-perfect PDF with up to
                <strong style="color:${BRAND};">${CONFIG.memberTierMaxSlides.toLocaleString()}</strong> slides per document.
              </p>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;">
                <tr>
                  <td align="center" style="border-radius:12px;background:${BRAND};">
                    <a href="${link}" style="display:inline-block;padding:14px 34px;font:600 15px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#ffffff;text-decoration:none;border-radius:12px;">
                      Confirm my email
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 6px;font:400 13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#6b7280;">
                Button not working? Copy this link into your browser:
              </p>
              <p style="margin:0 0 4px;word-break:break-all;">
                <a href="${link}" style="font:400 12px/1.6 'SF Mono',ui-monospace,Menlo,Consolas,monospace;color:${BRAND};text-decoration:none;">${link}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:22px 32px 30px;border-top:1px solid #eef0f6;margin-top:8px;">
              <p style="margin:0 0 8px;font:400 12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#9ca3af;">
                This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
              </p>
              <p style="margin:0;font:400 12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#9ca3af;">
                &copy; 2026 <a href="${CONFIG.publicUrl}" style="color:#9ca3af;text-decoration:underline;">DocSend PDF</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendVerificationEmail(to: string, link: string): Promise<void> {
  const t = getTransporter();
  if (!t) {
    // Email is disabled (EMAIL_ENABLED != true). Log the link so local dev can
    // still complete verification without an SMTP server.
    console.log(`[email disabled] Verification link for ${to}: ${link}`);
    return;
  }
  await t.sendMail({
    from: { name: 'DocSend PDF', address: CONFIG.fromAddress },
    to,
    subject: 'Confirm your email for DocSend PDF',
    text:
      `Welcome to DocSend PDF!\n\n` +
      `Confirm your email to unlock member conversions (up to ${CONFIG.memberTierMaxSlides.toLocaleString()} slides per document):\n\n` +
      `${link}\n\n` +
      `This link expires in 24 hours. If you did not create an account, you can ignore this email.`,
    html: verificationEmailHtml(link),
  });
}
