import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { Server as SocketIOServer } from 'socket.io';
import { readFile } from 'fs/promises';
import type { SendProgressEvent, WhatsAppStatusEvent } from '../types/index.ts';

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

  constructor(config: WhatsAppServiceConfig) {
    this.io = config.io;
    this.authDir = config.authDir || './auth_info';
  }

  /**
   * Initialize WhatsApp connection
   */
  async start(): Promise<void> {
    console.log('[WhatsApp] Starting WhatsApp service...');
    await this.connectToWhatsApp();
  }

  /**
   * Stop WhatsApp connection gracefully
   */
  async stop(): Promise<void> {
    console.log('[WhatsApp] Stopping WhatsApp service...');
    this.shouldReconnect = false;

    if (this.sock) {
      try {
        // Only attempt logout if we're still connected
        if (this.isConnected && this.sock.ws?.readyState === 1) {
          await this.sock.logout();
          console.log('[WhatsApp] Logged out successfully');
        } else {
          // Just close the socket without logout if already disconnected
          if (this.sock.ws) {
            this.sock.ws.close();
          }
          console.log('[WhatsApp] Connection closed');
        }
      } catch (error) {
        // Silently ignore connection errors during shutdown
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!errorMessage.includes('Connection Closed')) {
          console.error('[WhatsApp] Error during logout:', error);
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
   * Send photos to a WhatsApp JID (must be in format: 972504203492@s.whatsapp.net)
   */
  async sendPhotos(jid: string, photoPaths: string[]): Promise<boolean> {
    if (!this.sock || !this.isConnected) {
      console.error('[WhatsApp] Cannot send photos: not connected');
      return false;
    }

    if (photoPaths.length === 0) {
      console.error('[WhatsApp] No photos to send');
      return false;
    }

    const SEND_TIMEOUT = 30000; // 30 seconds per photo

    console.log(`[WhatsApp] Sending ${photoPaths.length} photos to ${jid}...`);

    try {
      for (let i = 0; i < photoPaths.length; i++) {
        const photoPath = photoPaths[i];
        console.log(`[WhatsApp] Sending photo ${i + 1}/${photoPaths.length}: ${photoPath}`);

        try {
          // Read photo file asynchronously
          const imageBuffer = await readFile(photoPath);

          // Suppress verbose Baileys/libsignal crypto logs during send
          const originalConsoleLog = console.log;
          console.log = () => {};

          try {
            // Send photo via WhatsApp with timeout
            await Promise.race([
              this.sock.sendMessage(jid, {
                image: imageBuffer,
                mimetype: 'image/jpeg',
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Send timeout')), SEND_TIMEOUT)
              ),
            ]);
          } finally {
            // Restore console.log
            console.log = originalConsoleLog;
          }

          console.log(`[WhatsApp] Photo ${i + 1}/${photoPaths.length} sent successfully`);

          // Emit progress event
          this.emitProgress(i + 1, photoPaths.length);

          // Small delay between sends to avoid rate limiting
          if (i < photoPaths.length - 1) {
            await this.delay(500);
          }
        } catch (error) {
          console.error(`[WhatsApp] Error sending photo ${i + 1}:`, error);
          throw error;
        }
      }

      console.log(`[WhatsApp] All ${photoPaths.length} photos sent successfully`);
      return true;
    } catch (error) {
      console.error('[WhatsApp] Failed to send photos:', error);
      return false;
    }
  }

  /**
   * Connect to WhatsApp using Baileys
   */
  private async connectToWhatsApp(): Promise<void> {
    try {
      console.log('[WhatsApp] Loading auth state...');
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      console.log('[WhatsApp] Fetching latest Baileys version...');
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`[WhatsApp] Using Baileys version ${version.join('.')}, isLatest: ${isLatest}`);

      console.log('[WhatsApp] Creating WhatsApp socket...');

      // Custom logger to suppress verbose Baileys internal logs
      const baileysLogger = {
        level: 'silent', // Suppress all logs
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        child: () => baileysLogger,
      };

      this.sock = makeWASocket({
        version,
        logger: baileysLogger as any, // Suppress Baileys internal logs
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        printQRInTerminal: false, // We'll handle QR display manually
        browser: Browsers.ubuntu('Chrome'), // Masquerade as Chrome on Ubuntu
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
          console.log('\n[WhatsApp] QR Code for authentication:');
          console.log('═'.repeat(50));
          qrcode.generate(qr, { small: true });
          console.log('═'.repeat(50));
          console.log('[WhatsApp] Scan this QR code with your phone\'s WhatsApp');
          console.log(`[WhatsApp] Attempt ${this.qrAttempts}/${this.maxQRAttempts}`);

          if (this.qrAttempts >= this.maxQRAttempts) {
            console.error('[WhatsApp] Max QR attempts reached. Restarting connection...');
            this.qrAttempts = 0;
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
            console.log('[WhatsApp] Logged out - session invalidated');
          } else if (statusCode === DisconnectReason.connectionReplaced) {
            console.log('[WhatsApp] ⚠️  Connection replaced - another WhatsApp Web session is active');
            console.log('[WhatsApp] Close other sessions or enable Multi-Device');
          } else if (statusCode === 428) { // connectionClosed
            console.log('[WhatsApp] Connection closed by server');
          } else if (statusCode) {
            console.log(`[WhatsApp] Disconnected (${statusCode})`);
          } else {
            console.log('[WhatsApp] Connection closed');
          }

          if (shouldReconnect && this.shouldReconnect) {
            // Exponential backoff: wait 3 seconds before reconnecting
            setTimeout(() => this.connectToWhatsApp(), 3000);
          }
        } else if (connection === 'open') {
          this.isConnected = true;
          this.qrAttempts = 0; // Reset QR attempts on successful connection
          console.log('[WhatsApp] Connection opened successfully');
          this.emitStatus(true);
        } else if (connection === 'connecting') {
          console.log('[WhatsApp] Connecting...');
        }
      });

      // Handle messages upsert (optional - for receiving messages)
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // We don't need to handle incoming messages for this use case
        // Silently ignore incoming messages
      });
    } catch (error) {
      console.error('[WhatsApp] Error connecting to WhatsApp:', error);

      if (this.shouldReconnect) {
        console.log('[WhatsApp] Retrying connection in 5 seconds...');
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
    console.log(`[WhatsApp] Status emitted: ${connected ? 'connected' : 'disconnected'}`);
  }

  /**
   * Emit send progress via Socket.io
   */
  private emitProgress(current: number, total: number): void {
    const event: SendProgressEvent = { current, total };
    this.io.emit('send-progress', event);
    console.log(`[WhatsApp] Progress: ${current}/${total}`);
  }

  /**
   * Utility: delay for milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
