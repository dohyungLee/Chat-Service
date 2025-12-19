import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { PrismaModule } from './prisma.module'
import { ChatGateway } from './chat.gateway'
import { ChatService } from './chat.service'
import { AuthModule } from './auth/auth.module'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AppController],
  providers: [AppService, ChatGateway, ChatService],
})
export class AppModule {}
