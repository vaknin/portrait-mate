import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { Server as SocketIOServer } from 'socket.io';
import { readFile, rm } from 'fs/promises';
import type { SendProgressEvent, WhatsAppStatusEvent } from '../types/index.js';
import { logger } from '../logger.js';

interface WhatsAppServiceConfig {
  io: SocketIOServer;
  authDir?: string;
}

export class WhatsAppService {
  private sock: WASocket | null = null;
  private io: SocketIOServer;
  private authDir: string;
  private isConnected: boolean = false;
  private shouldReconnect: boolean = true;
  private qrAttempts: number = 0;
  private maxQRAttempts: number = 5;
  private latestQR: string | null = null; // Store latest QR for late-joining clients

  constructor(config: WhatsAppServiceConfig) {
    this.io = config.io;
    this.authDir = config.authDir || './auth_info';
  }

  /**
   * Initialize WhatsApp connection
   */
  async start(): Promise<void> {
    logger.debug('[WhatsApp] Starting WhatsApp service...');
    await this.connectToWhatsApp();
  }

  /**
   * Stop WhatsApp connection gracefully
   */
  async stop(): Promise<void> {
    // logger.info('[WhatsApp] Stopping WhatsApp service...');
    this.shouldReconnect = false;

    if (this.sock) {
      try {
        // Only attempt logout if we're still connected
        if (this.isConnected && this.sock.ws) {
          // Do NOT logout, just close the connection to preserve session
          this.sock.ws.close();
          // logger.info('[WhatsApp] Connection closed (session preserved)');
        } else {
          // Just close the socket without logout if already disconnected
          if (this.sock.ws) {
            this.sock.ws.close();
          }
        }
      } catch (error) {
        // Silently ignore connection errors during shutdown
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!errorMessage.includes('Connection Closed')) {
          logger.error(`[WhatsApp] Error during logout: ${error}`);
        }
      }
      this.sock = null;
    }

    this.isConnected = false;
    this.emitStatus(false);
  }

  /**
   * Get current connection status
   */
  getStatus(): { connected: boolean } {
    return { connected: this.isConnected };
  }

  /**
   * Get latest QR code (for late-joining clients)
   */
  getLatestQR(): { qr: string; attempt: number } | null {
    if (this.latestQR) {
      return { qr: this.latestQR, attempt: this.qrAttempts };
    }
    return null;
  }

  /**
   * Send photos to a WhatsApp JID (must be in format: 972504203492@s.whatsapp.net)
   */
  async sendPhotos(jid: string, photoPaths: string[]): Promise<boolean> {
    if (!this.sock || !this.isConnected) {
      logger.error('[WhatsApp] Cannot send photos: not connected');
      return false;
    }

    if (photoPaths.length === 0) {
      logger.error('[WhatsApp] No photos to send');
      return false;
    }

    const SEND_TIMEOUT = 30000; // 30 seconds per photo

    logger.info(`[WhatsApp] Sending ${photoPaths.length} photos to ${jid}...`);

    try {
      for (let i = 0; i < photoPaths.length; i++) {
        const photoPath = photoPaths[i];
        logger.info(`[WhatsApp] Sending photo ${i + 1}/${photoPaths.length}: ${photoPath}`);

        try {
          // Read photo file asynchronously
          if (!photoPath) continue;
          const imageBuffer = await readFile(photoPath);

          // Suppress verbose Baileys/libsignal crypto logs during send
          // We can't easily suppress console.log globally in a safe way with Pino,
          // but Baileys uses a logger we passed in, so it should be quiet.
          // However, some libs might still use console.log.
          // For now, we just proceed.

          // Send photo via WhatsApp with timeout
          await Promise.race([
            this.sock.sendMessage(jid, {
              image: imageBuffer,
              mimetype: 'image/jpeg',
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Send timeout')), SEND_TIMEOUT),
            ),
          ]);

          logger.info(`[WhatsApp] Photo ${i + 1}/${photoPaths.length} sent successfully`);

          // Emit progress event
          this.emitProgress(i + 1, photoPaths.length);

          // Small delay between sends to avoid rate limiting
          if (i < photoPaths.length - 1) {
            await this.delay(500);
          }
        } catch (error) {
          logger.error(`[WhatsApp] Error sending photo ${i + 1}: ${error}`);
          throw error;
        }
      }

      logger.info(`[WhatsApp] All ${photoPaths.length} photos sent successfully`);
      return true;
    } catch (error) {
      logger.error(`[WhatsApp] Failed to send photos: ${error}`);
      return false;
    }
  }

  /**
   * Connect to WhatsApp using Baileys
   */
  private async connectToWhatsApp(): Promise<void> {
    if (!this.shouldReconnect) return;

    try {
      logger.debug('[WhatsApp] Loading auth state...');
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      logger.debug('[WhatsApp] Fetching latest Baileys version...');
      const { version, isLatest } = await fetchLatestBaileysVersion();
      logger.debug(`[WhatsApp] Using Baileys version ${version.join('.')}, isLatest: ${isLatest}`);

      logger.debug('[WhatsApp] Creating WhatsApp socket...');

      // Custom logger to suppress verbose Baileys internal logs
      const baileysLogger = logger.child({ module: 'baileys' });
      baileysLogger.level = 'silent';

      this.sock = makeWASocket({
        version,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        logger: baileysLogger as any, // Suppress Baileys internal logs
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        printQRInTerminal: false, // We'll handle QR display manually
        browser: ['portrait-mate', 'Linux', '1.0.0'], // Custom browser name to prevent conflicts
        defaultQueryTimeoutMs: 60000,
      });

      // Handle credentials update (save auth state)
      this.sock.ev.on('creds.update', saveCreds);

      // Handle connection updates
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Display QR code if present
        if (qr) {
          this.qrAttempts++;
          this.latestQR = qr; // Store for late-joining clients
          logger.info(`[WhatsApp] QR Code received (Attempt ${this.qrAttempts}/${this.maxQRAttempts})`);

          // Emit QR code to frontend
          this.io.emit('whatsapp-qr', { qr, attempt: this.qrAttempts });

          if (this.qrAttempts >= this.maxQRAttempts) {
            logger.error('[WhatsApp] Max QR attempts reached. Restarting connection...');
            this.qrAttempts = 0;
            // Close current connection before retrying
            this.sock?.ws?.close();
            setTimeout(() => this.connectToWhatsApp(), 3000);
          }
        }

        // Handle connection state changes
        if (connection === 'close') {
          this.isConnected = false;
          this.emitStatus(false);

          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          // Log reason for disconnection
          if (statusCode === DisconnectReason.loggedOut) {
            logger.info('[WhatsApp] Logged out - session invalidated');
            logger.info('[WhatsApp] Clearing auth data and restarting...');

            // Clear auth directory
            try {
              await rm(this.authDir, { recursive: true, force: true });
              logger.debug('[WhatsApp] Auth directory cleared');
            } catch (err) {
              logger.error(`[WhatsApp] Error clearing auth dir: ${err}`);
            }

            // Force reconnect
            this.shouldReconnect = true;
            setTimeout(() => this.connectToWhatsApp(), 1000);
          } else if (statusCode === DisconnectReason.connectionReplaced) {
            logger.warn(
              '[WhatsApp] Connection replaced - another WhatsApp Web session is active',
            );
            logger.warn('[WhatsApp] Close other sessions or enable Multi-Device');
          } else if (statusCode === 428) {
            // connectionClosed
            logger.debug('[WhatsApp] Connection closed by server');
          } else if (statusCode) {
            logger.info(`[WhatsApp] Disconnected (${statusCode})`);
          } else {
            logger.info('[WhatsApp] Connection closed');
          }

          if (shouldReconnect && this.shouldReconnect) {
            // Exponential backoff: wait 3 seconds before reconnecting
            setTimeout(() => this.connectToWhatsApp(), 3000);
          }
        } else if (connection === 'open') {
          this.isConnected = true;
          this.qrAttempts = 0; // Reset QR attempts on successful connection
          this.latestQR = null; // Clear QR code on successful connection
          logger.info('[WhatsApp] Connection opened successfully');
          this.emitStatus(true);
        } else if (connection === 'connecting') {
          logger.debug('[WhatsApp] Connecting...');
        }
      });

      // Handle messages upsert (optional - for receiving messages)
      this.sock.ev.on('messages.upsert', async ({ messages: _messages, type: _type }) => {
        // We don't need to handle incoming messages for this use case
        // Silently ignore incoming messages
      });
    } catch (error) {
      logger.error(`[WhatsApp] Error connecting to WhatsApp: ${error}`);

      if (this.shouldReconnect) {
        logger.info('[WhatsApp] Retrying connection in 5 seconds...');
        setTimeout(() => this.connectToWhatsApp(), 5000);
      }
    }
  }

  /**
   * Emit WhatsApp connection status via Socket.io
   */
  private emitStatus(connected: boolean): void {
    const event: WhatsAppStatusEvent = { connected };
    this.io.emit('whatsapp-status', event);
    logger.debug(`[WhatsApp] Status emitted: ${connected ? 'connected' : 'disconnected'}`);
  }

  /**
   * Emit send progress via Socket.io
   */
  private emitProgress(current: number, total: number): void {
    const event: SendProgressEvent = { current, total };
    this.io.emit('send-progress', event);
    logger.info(`[WhatsApp] Progress: ${current}/${total}`);
  }

  /**
   * Utility: delay for milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
