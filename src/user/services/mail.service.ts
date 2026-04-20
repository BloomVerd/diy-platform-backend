import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter;
  private from: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.from = this.configService.getOrThrow<string>('SMTP_FROM');
    this.transporter = nodemailer.createTransport({
      host: this.configService.getOrThrow<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT', 587),
      secure: this.configService.get<boolean>('SMTP_SECURE', false),
      auth: {
        user: this.configService.getOrThrow<string>('SMTP_USER'),
        pass: this.configService.getOrThrow<string>('SMTP_PASSWORD'),
      },
    });
  }

  async sendOtpEmail(to: string, code: string, expiryMinutes: number): Promise<void> {
    const subject = 'Your login code';
    const text = `Your login code is ${code}. It expires in ${expiryMinutes} minutes. If you did not request this, ignore this email.`;
    const html = `
      <p>Your login code is:</p>
      <p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${code}</p>
      <p>It expires in ${expiryMinutes} minutes.</p>
      <p style="color:#666;font-size:12px;">If you did not request this, ignore this email.</p>
    `;

    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      text,
      html,
    });

    this.logger.log(`OTP email sent to ${to}`);
  }
}
