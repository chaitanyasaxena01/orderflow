import type { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: AuthUser;
      rawBody?: string;
    }
  }
}

export {};
