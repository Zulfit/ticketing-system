import { Role } from '../generated/prisma/client.js';

export type AuthUser = {
  userId: number;
  email: string;
  role: Role;
};
