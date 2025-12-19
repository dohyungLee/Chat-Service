import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { ChatService } from './chat.service'
import { JwtService } from '@nestjs/jwt'

@WebSocketGateway({
  cors: { origin: 'http://localhost:3000', credentials: true },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server

  constructor(
    private chatService: ChatService,
    private jwt: JwtService,
  ) {}

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token
      if (!token) throw new Error('TOKEN_REQUIRED')

      const payload = this.jwt.verify(token) as { sub?: string; userId?: string }
      const userId = payload.sub ?? payload.userId
      if (!userId) throw new Error('INVALID_TOKEN')

      client.data.userId = userId
      console.log('[WS] connected:', { socketId: client.id, userId })
    } catch {
      client.emit('auth:error', { code: 'UNAUTHORIZED' }) // ✅ 유지
      client.disconnect()
    }
  }

  handleDisconnect(client: Socket) {
    console.log('[WS] disconnected:', { socketId: client.id, userId: client.data.userId })
  }

  @SubscribeMessage('room:join')
  async onJoin(@MessageBody() body: { roomId: string }, @ConnectedSocket() client: Socket) {
    const userId = client.data.userId as string | undefined
    if (!userId) return client.disconnect()

    const roomKey = (body?.roomId || '').trim()
    if (!roomKey) return client.emit('room:error', { code: 'ROOM_ID_REQUIRED' })

    await this.chatService.joinRoom(roomKey, userId)

    await client.join(roomKey)
    const size = this.server.sockets.adapter.rooms.get(roomKey)?.size ?? 0

    client.emit('room:joined', { roomId: roomKey, size })
    client.to(roomKey).emit('room:user-joined', { roomId: roomKey, size })
  }

  @SubscribeMessage('room:leave')
  async onLeave(@MessageBody() body: { roomId: string }, @ConnectedSocket() client: Socket) {
    const userId = client.data.userId as string | undefined
    if (!userId) return client.disconnect()

    const roomKey = (body?.roomId || '').trim()
    if (!roomKey) return client.emit('room:error', { code: 'ROOM_ID_REQUIRED' })

    await this.chatService.leaveRoom(roomKey, userId)

    await client.leave(roomKey)
    const size = this.server.sockets.adapter.rooms.get(roomKey)?.size ?? 0

    client.emit('room:left', { roomId: roomKey, size })
    client.to(roomKey).emit('room:user-left', { roomId: roomKey, size })
  }

  @SubscribeMessage('message:send')
  async onSend(
    @MessageBody() body: { roomId: string; text: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId as string | undefined
    if (!userId) return client.disconnect()

    const roomKey = (body?.roomId || '').trim()
    const text = (body?.text || '').trim()

    if (!roomKey) return client.emit('message:error', { code: 'ROOM_ID_REQUIRED' })
    if (!text) return client.emit('message:error', { code: 'TEXT_REQUIRED' })

    try {
      const saved = await this.chatService.saveMessage({
        roomKey,
        senderId: userId,
        text,
      })

      const from =
        saved.sender?.nickname ??
        saved.sender?.email?.split('@')[0] ??
        'Unknown'

      this.server.to(roomKey).emit('message:new', {
        roomId: roomKey,
        messageId: saved.id,
        from, // ✅ 닉네임 표시
        text: saved.text,
        ts: saved.createdAt.getTime(),
      })
    } catch {
      client.emit('message:error', { code: 'FORBIDDEN' })
    }
  }

  @SubscribeMessage('message:history')
  async onHistory(
    @MessageBody() body: { roomId: string; size?: number; before?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId as string | undefined
    if (!userId) return client.disconnect()

    const roomKey = (body?.roomId || '').trim()
    if (!roomKey) return client.emit('message:error', { code: 'ROOM_ID_REQUIRED' })

    try {
      const items = await this.chatService.getMessages({
        roomKey,
        userId,
        size: body.size,
        before: body.before,
      })

      client.emit('message:history', {
        roomId: roomKey,
        items: items.map((m) => ({
          messageId: m.id,
          from: m.sender?.nickname ?? m.sender?.email?.split('@')[0] ?? 'Unknown',
          text: m.text,
          ts: m.createdAt.getTime(),
        })),
        nextBefore: items.length ? items[0].id : null,
      })
    } catch {
      client.emit('message:error', { code: 'FORBIDDEN' })
    }
  }
}
