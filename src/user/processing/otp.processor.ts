import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailService } from '../services/mail.service';
import { OTP_QUEUE, OtpEmailJobPayload } from './otp.queue';

@Processor(OTP_QUEUE)
export class OtpProcessor extends WorkerHost {
  private readonly logger = new Logger(OtpProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<OtpEmailJobPayload>): Promise<void> {
    const { email, code, expiryMinutes } = job.data;
    try {
      await this.mailService.sendOtpEmail(email, code, expiryMinutes);
    } catch (err) {
      this.logger.error(`Failed to send OTP email to ${email}`, err);
      throw err;
    }
  }
}
