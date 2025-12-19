import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { Prisma } from '@prisma/client'

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  async getOrCreateRoom(roomKey: string) {
    const existing = await this.prisma.room.findUnique({ where: { roomKey } })
    if (existing) return existing

    try {
      return await this.prisma.room.create({ data: { roomKey } })
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const room = await this.prisma.room.findUnique({ where: { roomKey } })
        if (room) return room
      }
      throw e
    }
  }

  async joinRoom(roomKey: string, userId: string) {
    const room = await this.getOrCreateRoom(roomKey)

    await this.prisma.roomMember.upsert({
      where: { roomId_userId: { roomId: room.id, userId } },
      update: {},
      create: { roomId: room.id, userId },
    })

    return room
  }

  async leaveRoom(roomKey: string, userId: string) {
    const room = await this.prisma.room.findUnique({ where: { roomKey } })
    if (!room) return

    await this.prisma.roomMember.deleteMany({
      where: { roomId: room.id, userId },
    })
  }

  private async assertMember(roomId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    })
    if (!user) throw new ForbiddenException('SENDER_NOT_FOUND')

    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { id: true },
    })
    if (!member) throw new ForbiddenException('NOT_A_MEMBER')
  }

  async saveMessage(params: { roomKey: string; senderId: string; text: string }) {
    const room = await this.prisma.room.findUnique({ where: { roomKey: params.roomKey } })
    if (!room) throw new NotFoundException('ROOM_NOT_FOUND')

    await this.assertMember(room.id, params.senderId)

    return this.prisma.message.create({
      data: { roomId: room.id, senderId: params.senderId, text: params.text },
      select: {
        id: true,
        senderId: true,
        text: true,
        createdAt: true,
        sender: { select: { nickname: true, email: true } }, // ✅ 닉네임
        room: { select: { roomKey: true } },
      },
    })
  }

  async getMessages(params: { roomKey: string; userId: string; size?: number; before?: string }) {
    const size = Math.min(Math.max(params.size ?? 50, 1), 100)

    const room = await this.prisma.room.findUnique({ where: { roomKey: params.roomKey } })
    if (!room) return []

    await this.assertMember(room.id, params.userId)

    const query: any = {
      where: { roomId: room.id },
      orderBy: { createdAt: 'desc' as const },
      take: size,
      select: {
        id: true,
        senderId: true,
        text: true,
        createdAt: true,
        sender: { select: { nickname: true, email: true } }, // ✅ 닉네임
      },
    }

    if (params.before) {
      query.cursor = { id: params.before }
      query.skip = 1
    }

    const rows = await this.prisma.message.findMany(query)
    return rows.reverse()
  }
}
