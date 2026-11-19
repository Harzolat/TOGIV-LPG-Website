import { Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  async send(input: SendMailInput): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from =
      process.env.EMAIL_FROM?.trim() ||
      process.env.MAIL_FROM?.trim() ||
      "onboarding@resend.dev";

    if (apiKey) {
      const resend = new Resend(apiKey);

      const { error } = await resend.emails.send({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
      });

      if (error) {
        this.logger.error(`Resend email failed: ${error.message}`);
        throw new Error("Unable to send email.");
      }

      this.logger.log(`Email sent successfully to ${input.to} via Resend.`);
      return;
    }

    // Keep existing SMTP support as a fallback.
    const host = process.env.SMTP_HOST?.trim();
    const smtpFrom = (
      process.env.MAIL_FROM ??
      process.env.SMTP_FROM ??
      "no-reply@togiv.local"
    ).trim();

    if (host) {
      try {
        const nodemailer = require("nodemailer") as any;
        const port = Number(process.env.SMTP_PORT ?? 587);

        const transporter = nodemailer.createTransport({
          host,
          port: Number.isFinite(port) ? port : 587,
          secure:
            String(process.env.SMTP_SECURE ?? "").toLowerCase() === "true" ||
            port === 465,
          auth: process.env.SMTP_USER
            ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
              }
            : undefined,
        });

        await transporter.sendMail({
          from: smtpFrom,
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
        });

        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`SMTP email failed: ${msg}`);
        throw new Error("Unable to send email.");
      }
    }

    this.logger.warn(
      `[DEV EMAIL FALLBACK] to=${input.to} subject=${input.subject}\n${input.text}`,
    );
  }
}
