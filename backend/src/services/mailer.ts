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

export async function sendVerificationEmail(to: string, link: string): Promise<void> {
  const t = getTransporter();
  if (!t) {
    // Email is disabled (EMAIL_ENABLED != true). Log the link so local dev can
    // still complete verification without an SMTP server.
    console.log(`[email disabled] Verification link for ${to}: ${link}`);
    return;
  }
  await t.sendMail({
    from: CONFIG.fromAddress,
    to,
    subject: 'Confirm your email for DocSend PDF',
    text: `Welcome to DocSend PDF!\n\nConfirm your email to unlock member conversions (up to ${CONFIG.memberTierMaxSlides} slides per document):\n\n${link}\n\nThis link expires in 24 hours.`,
    html: `<p>Welcome to DocSend PDF!</p>
<p>Confirm your email to unlock member conversions (up to <strong>${CONFIG.memberTierMaxSlides} slides</strong> per document):</p>
<p><a href="${link}">Confirm my email</a></p>
<p style="color:#888;font-size:12px">This link expires in 24 hours. If you did not create an account, you can ignore this email.</p>`,
  });
}
