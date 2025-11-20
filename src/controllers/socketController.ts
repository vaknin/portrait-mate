import { Server, Socket } from 'socket.io';
import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { CameraService } from '../services/camera.js';
import { WhatsAppService } from '../services/whatsapp.js';
import type { ClientSendPhotosEvent } from '../types/index.js';

// Validation Schemas
const SendPhotosSchema = z.object({
    phone: z.string().min(10),
    photos: z.array(z.string()),
});

/**
 * Convert phone number to WhatsApp JID format
 */
function convertToWhatsAppJID(phone: string): string {
    const cleaned = phone.replace(/[\s-]/g, '');

    if (cleaned.startsWith('0') && cleaned.length === 10) {
        return `972${cleaned.slice(1)}@s.whatsapp.net`;
    }

    if (cleaned.startsWith('+')) {
        return `${cleaned.slice(1)}@s.whatsapp.net`;
    }

    return `${cleaned}@s.whatsapp.net`;
}

export class SocketController {
    constructor(
        private io: Server,
        private cameraService: CameraService,
        private whatsappService: WhatsAppService,
    ) { }

    public handleConnection(socket: Socket): void {
        logger.debug(`[WebSocket] Client connected: ${socket.id}`);

        // Send initial status
        this.sendInitialStatus(socket);

        // Register Event Handlers
        socket.on('client:request-photos', () => this.handleRequestPhotos(socket));
        socket.on('client:send-photos', (data) => this.handleSendPhotos(socket, data));
        socket.on('client:reset-session', () => this.handleResetSession(socket));

        socket.on('disconnect', () => {
            logger.debug(`[WebSocket] Client disconnected: ${socket.id}`);
        });
    }

    private sendInitialStatus(socket: Socket): void {
        const cameraStatus = this.cameraService.getStatus();
        socket.emit('camera-status', { connected: cameraStatus.connected });

        const whatsappStatus = this.whatsappService.getStatus();
        socket.emit('whatsapp-status', { connected: whatsappStatus.connected });

        // Send latest QR code if available
        const latestQR = this.whatsappService.getLatestQR();
        if (latestQR) {
            socket.emit('whatsapp-qr', latestQR);
            logger.debug(`[WebSocket] Sent existing QR code to ${socket.id}`);
        }
    }

    private async handleRequestPhotos(socket: Socket): Promise<void> {
        try {
            const files = await readdir(config.PHOTOS_DIR);
            const jpgFiles = files.filter(
                (f) => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.jpeg'),
            );

            // Send each photo as an event
            for (const filename of jpgFiles) {
                socket.emit('photo-captured', {
                    filename,
                    path: `/photos/${filename}`,
                });
            }
            logger.debug(`[WebSocket] Sent ${jpgFiles.length} existing photos to ${socket.id}`);
        } catch (error) {
            logger.error(`[WebSocket] Error listing photos: ${error}`);
        }
    }

    private async handleSendPhotos(socket: Socket, data: ClientSendPhotosEvent): Promise<void> {
        const validation = SendPhotosSchema.safeParse(data);

        if (!validation.success) {
            logger.warn(`[WebSocket] Invalid send request: ${JSON.stringify(validation.error.format())}`);
            socket.emit('send-complete', {
                success: false,
                count: 0,
                error: 'Invalid request parameters',
            });
            return;
        }

        const { phone, photos } = validation.data;

        if (photos.length === 0) {
            socket.emit('send-complete', { success: false, count: 0, error: 'No photos selected' });
            return;
        }

        const jid = convertToWhatsAppJID(phone);
        logger.info(`[Send] Sending ${photos.length} photos to ${phone}`);

        const photoPaths = photos.map((filename) => join(process.cwd(), 'session', filename));

        try {
            const success = await this.whatsappService.sendPhotos(jid, photoPaths);

            if (!success) {
                socket.emit('send-complete', {
                    success: false,
                    count: 0,
                    error: 'Failed to send photos',
                });
                return;
            }

            socket.emit('send-complete', { success: true, count: photos.length });
        } catch (error) {
            logger.error(`[Send] Error: ${error}`);
            socket.emit('send-complete', { success: false, count: 0, error: 'Internal server error' });
        }
    }

    private async handleResetSession(socket: Socket): Promise<void> {
        try {
            logger.info(`[Reset] Request from ${socket.id}`);
            this.cameraService.pause();

            const files = await readdir(config.PHOTOS_DIR);
            const jpgFiles = files.filter(
                (f) => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.jpeg'),
            );

            await Promise.all(jpgFiles.map((file) => unlink(join(config.PHOTOS_DIR, file))));

            logger.info(`[Reset] Deleted ${jpgFiles.length} photos`);
            this.cameraService.resume();
            this.cameraService.resetSession();

            // Broadcast reset to all clients
            this.io.emit('session-reset');
        } catch (error) {
            logger.error(`[Reset] Error: ${error}`);
            this.cameraService.resume();
        }
    }
}
