import { UserRole } from '../entities/user.entity';

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
}
