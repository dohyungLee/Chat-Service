import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async signup(email: string, password: string, nickname?: string) {
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new BadRequestException('EMAIL_ALREADY_EXISTS');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, nickname: nickname ?? null },
      select: { id: true, email: true, nickname: true },
    });

    return { user, token: this.signToken(user.id, user.email) };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('INVALID_CREDENTIALS');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('INVALID_CREDENTIALS');

    return {
      user: { id: user.id, email: user.email, nickname: user.nickname },
      token: this.signToken(user.id, user.email),
    };
  }

  signToken(userId: string, email: string): string {
    return this.jwt.sign({ sub: userId, email });
  }

  verifyToken(token: string): {
    sub: string;
    email: string;
    iat?: number;
    exp?: number;
  } {
    return this.jwt.verify<{
      sub: string;
      email: string;
      iat?: number;
      exp?: number;
    }>(token);
  }
}
