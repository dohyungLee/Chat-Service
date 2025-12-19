import { Injectable } from '@nestjs/common'
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

  async saveMessage(params: { roomKey: string; senderId: string; text: string }) {
    const room = await this.getOrCreateRoom(params.roomKey)
    return this.prisma.message.create({
      data: { roomId: room.id, senderId: params.senderId, text: params.text },
      select: {
        id: true,
        senderId: true,
        text: true,
        createdAt: true,
        room: { select: { roomKey: true } },
      },
    })
  }

  async getMessages(params: { roomKey: string; size?: number; before?: string }) {
    const size = Math.min(Math.max(params.size ?? 50, 1), 100)

    const room = await this.prisma.room.findUnique({ where: { roomKey: params.roomKey } })
    if (!room) return []

    const query: any = {
      where: { roomId: room.id },
      orderBy: { createdAt: 'desc' as const },
      take: size,
      select: { id: true, senderId: true, text: true, createdAt: true },
    }

    if (params.before) {
      query.cursor = { id: params.before }
      query.skip = 1
    }

    const rows = await this.prisma.message.findMany(query)
    return rows.reverse()
  }
}
