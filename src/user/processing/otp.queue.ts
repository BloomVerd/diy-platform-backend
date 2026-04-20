export const OTP_QUEUE = 'user-otp';

export interface OtpEmailJobPayload {
  email: string;
  code: string;
  expiryMinutes: number;
}
