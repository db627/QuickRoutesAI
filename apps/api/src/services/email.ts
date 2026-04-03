import nodemailer from "nodemailer";
import { env } from "../config/env";

export const isEmailConfigured = !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

const transporter = isEmailConfigured
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER!,
        pass: env.SMTP_PASS!,
      },
    })
  : null;

export interface QuoteRequest {
  name: string;
  email: string;
  company: string;
  fleetSize: string;
  message?: string;
}

export async function sendQuoteEmail(data: QuoteRequest): Promise<void> {
  if (!transporter) {
    throw new Error("Email is not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS");
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #3b82f6, #6366f1); padding: 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">New Quote Request</h1>
        <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0;">QuickRoutesAI</p>
      </div>
      <div style="background: #f9fafb; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px; width: 140px;">Name</td>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #111827; font-size: 14px; font-weight: 600;">${escapeHtml(data.name)}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Email</td>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #111827; font-size: 14px; font-weight: 600;">
              <a href="mailto:${escapeHtml(data.email)}" style="color: #2563eb;">${escapeHtml(data.email)}</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Company</td>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #111827; font-size: 14px; font-weight: 600;">${escapeHtml(data.company)}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; ${data.message ? "border-bottom: 1px solid #e5e7eb;" : ""} color: #6b7280; font-size: 14px;">Fleet Size</td>
            <td style="padding: 12px 0; ${data.message ? "border-bottom: 1px solid #e5e7eb;" : ""} color: #111827; font-size: 14px; font-weight: 600;">${escapeHtml(data.fleetSize)}</td>
          </tr>
          ${
            data.message
              ? `<tr>
            <td style="padding: 12px 0; color: #6b7280; font-size: 14px; vertical-align: top;">Message</td>
            <td style="padding: 12px 0; color: #111827; font-size: 14px;">${escapeHtml(data.message)}</td>
          </tr>`
              : ""
          }
        </table>
        <div style="margin-top: 24px; padding: 16px; background: #eff6ff; border-radius: 8px; border: 1px solid #dbeafe;">
          <p style="margin: 0; font-size: 13px; color: #1e40af;">
            Reply directly to this email to respond to <strong>${escapeHtml(data.name)}</strong> at
            <a href="mailto:${escapeHtml(data.email)}" style="color: #2563eb;">${escapeHtml(data.email)}</a>
          </p>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"QuickRoutesAI" <${env.SMTP_USER}>`,
    to: env.QUOTE_RECIPIENT_EMAIL,
    replyTo: data.email,
    subject: `Quote Request from ${data.name} — ${data.company}`,
    html,
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
