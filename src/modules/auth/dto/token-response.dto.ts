import { UserRole } from '../../../database/entities/user.entity';

export class TokenResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
  };
}
