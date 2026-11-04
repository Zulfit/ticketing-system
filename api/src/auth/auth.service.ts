import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

const publicUser = {
  id: true,
  name: true,
  email: true,
  role: true,
  department: { select: { id: true, name: true } },
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const password = await hash(dto.password, 10);
    try {
      return await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          password,
          role: Role.REPORTER,
        },
        select: publicUser,
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !(await compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const access_token = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return { access_token };
  }

  async me(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: publicUser,
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
