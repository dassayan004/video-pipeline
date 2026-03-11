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
import { Logger } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/events' })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:job')
  handleSubscribeJob(
    @MessageBody() data: { jobId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`job:${data.jobId}`);
    this.logger.log(`Client ${client.id} subscribed to job ${data.jobId}`);
  }

  // ─── Emit job status updates ─────────────────────────────────────────────────
  emitJobStatus(jobId: string, payload: {
    status: string;
    progress?: number;
    message?: string;
    outputs?: Record<string, string>;
    error?: string;
  }) {
    this.server.to(`job:${jobId}`).emit('job:status', { jobId, ...payload });
  }
}
