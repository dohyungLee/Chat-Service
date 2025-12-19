import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(private chatService: ChatService) {}

  handleConnection(client: Socket) {
    console.log('[WS] connected:', client.id);
  }

  handleDisconnect(client: Socket) {
    console.log('[WS] disconnected:', client.id);
  }

  @SubscribeMessage('room:join')
  async onJoin(
    @MessageBody() body: { roomId: string; nickname?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const roomKey = (body?.roomId || '').trim();
    if (!roomKey)
      return client.emit('room:error', { code: 'ROOM_ID_REQUIRED' });

    await client.join(roomKey);
    const size = this.server.sockets.adapter.rooms.get(roomKey)?.size ?? 0;

    client.emit('room:joined', { roomId: roomKey, clientId: client.id, size });
    client
      .to(roomKey)
      .emit('room:user-joined', { roomId: roomKey, clientId: client.id, size });
  }

  @SubscribeMessage('room:leave')
  async onLeave(
    @MessageBody() body: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const roomKey = (body?.roomId || '').trim();
    if (!roomKey)
      return client.emit('room:error', { code: 'ROOM_ID_REQUIRED' });

    await client.leave(roomKey);
    const size = this.server.sockets.adapter.rooms.get(roomKey)?.size ?? 0;

    client.emit('room:left', { roomId: roomKey, clientId: client.id, size });
    client
      .to(roomKey)
      .emit('room:user-left', { roomId: roomKey, clientId: client.id, size });
  }

  // ✅ DB 저장 후 방 전체 브로드캐스트
  @SubscribeMessage('message:send')
  async onSend(
    @MessageBody() body: { roomId: string; text: string },
    @ConnectedSocket() client: Socket,
  ) {
    const roomKey = (body?.roomId || '').trim();
    const text = (body?.text || '').trim();

    if (!roomKey)
      return client.emit('message:error', { code: 'ROOM_ID_REQUIRED' });
    if (!text) return client.emit('message:error', { code: 'TEXT_REQUIRED' });

    const saved = await this.chatService.saveMessage({
      roomKey,
      senderId: client.id,
      text,
    });

    this.server.to(roomKey).emit('message:new', {
      roomId: saved.room.roomKey,
      messageId: saved.id,
      from: saved.senderId,
      text: saved.text,
      ts: saved.createdAt.getTime(),
    });
  }

  // ✅ 최신/이전 메시지 페이징 조회
  @SubscribeMessage('message:history')
  async onHistory(
    @MessageBody() body: { roomId: string; size?: number; before?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const roomKey = (body?.roomId || '').trim();
    if (!roomKey)
      return client.emit('message:error', { code: 'ROOM_ID_REQUIRED' });

    const items = await this.chatService.getMessages({
      roomKey: roomKey, // roomKey 변수명 사용
      size: body.size,
      before: body.before,
    });

    client.emit('message:history', {
      roomId: roomKey,
      items: items.map((m) => ({
        messageId: m.id,
        from: m.senderId,
        text: m.text,
        ts: m.createdAt.getTime(),
      })),
      nextBefore: items.length ? items[0].id : null, // 가장 오래된 id
    });
  }
}
