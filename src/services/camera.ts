import { spawn, type ChildProcess } from 'node:child_process';
import { watch } from 'node:fs';
import { mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Server as SocketIOServer } from 'socket.io';

// Connection states
enum ConnectionState {
    DISCONNECTED = 'DISCONNECTED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    ERROR = 'ERROR',
}

interface CameraServiceConfig {
    io: SocketIOServer;
    gphoto2Path?: string;
    onPhotoCapture?: (filename: string, path: string) => void;
}

export class CameraService {
    private io: SocketIOServer;
    private gphoto2Path: string;
    private onPhotoCapture?: (filename: string, path: string) => void;
    private monitorProcess: ChildProcess | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private currentSessionId: string | null = null;
    private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
    private isShuttingDown = false;
    private readonly reconnectInterval: number = 3000; // Fixed 3 second interval

    constructor(config: CameraServiceConfig) {
        this.io = config.io;
        this.gphoto2Path = config.gphoto2Path || 'gphoto2';
        this.onPhotoCapture = config.onPhotoCapture;
    }

    /**
     * Start monitoring the camera (called once on server startup)
     */
    async start(): Promise<void> {
        this.currentSessionId = 'session';

        // Create session directory
        const sessionDir = join(process.cwd(), 'session');
        await mkdir(sessionDir, { recursive: true });

        console.log(`[Camera] Starting camera monitoring`);

        // Start camera monitoring
        await this.startCameraMonitor();
    }

    /**
     * Stop all active timers (centralized cleanup)
     */
    private stopAllTimers(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * Stop camera monitoring (called only on server shutdown)
     */
    async stop(): Promise<void> {
        console.log('[Camera] Stopping camera monitoring...');
        this.isShuttingDown = true;

        // Stop all timers
        this.stopAllTimers();

        // Stop camera monitor process
        if (this.monitorProcess) {
            // Try SIGUSR2 for graceful shutdown, fallback to SIGTERM
            this.monitorProcess.kill('SIGUSR2');

            // If process doesn't exit in 5s, force kill
            setTimeout(() => {
                if (this.monitorProcess && !this.monitorProcess.killed) {
                    console.log('[Camera] Process did not exit gracefully, forcing SIGTERM');
                    this.monitorProcess.kill('SIGTERM');
                }
            }, 5000);

            this.monitorProcess = null;
        }

        // Reset state
        this.currentSessionId = null;
        this.connectionState = ConnectionState.DISCONNECTED;
        this.isShuttingDown = false;

        console.log('[Camera] Camera monitoring stopped');
    }

    /**
     * Start the gphoto2 monitoring process using event-based approach
     */
    private async startCameraMonitor(): Promise<void> {
        if (!this.currentSessionId) {
            console.error('[Camera] Cannot start monitor: No active session');
            return;
        }

        // Update state to CONNECTING
        this.setConnectionState(ConnectionState.CONNECTING);

        // Check if camera is available
        const cameraAvailable = await this.checkCameraAvailable();
        if (!cameraAvailable) {
            console.log('[Camera] Camera not detected, will retry...');
            this.setConnectionState(ConnectionState.DISCONNECTED);
            this.scheduleReconnect();
            return;
        }

        // Start event-based monitoring (includes capturetarget config)
        await this.startEventMonitor();
    }

    /**
     * Start event-based monitoring with gphoto2 --wait-event-and-download
     */
    private async startEventMonitor(): Promise<void> {
        if (!this.currentSessionId) {
            console.error('[Camera] Cannot start event monitor: No active session');
            return;
        }

        // Build filename pattern with session directory
        const sessionDir = join(process.cwd(), 'session');
        const filenamePattern = join(sessionDir, 'photo_%H%M%S.jpg');

        const args = [
            '--set-config', 'capturetarget=1',  // Save to SD card
            '--capture-tethered',               // Wait for shutter release and download
            '--keep',                           // Keep files on SD after downloading
            '--filename', filenamePattern       // Download JPG to local session/ folder
        ];

        console.log(`[Camera] Starting event monitor: ${this.gphoto2Path} ${args.join(' ')}`);

        // Spawn long-running gphoto2 process
        this.monitorProcess = spawn(this.gphoto2Path, args);

        // Monitor stdout for "Saving file as" events
        this.monitorProcess.stdout?.on('data', (data: Buffer) => {
            const output = data.toString();
            const lines = output.split('\n');

            for (const line of lines) {
                if (line.includes('Saving file as')) {
                    this.parsePhotoEvent(line);
                }
            }
        });

        // Monitor stderr for errors
        this.monitorProcess.stderr?.on('data', (data: Buffer) => {
            const error = data.toString();

            // Log errors but don't spam console with normal gphoto2 debug output
            if (error.includes('ERROR') || error.includes('WARNING')) {
                console.error('[Camera] stderr:', error);
            }

            // Check for specific errors
            if (error.toLowerCase().includes('no space left')) {
                console.error('[Camera] ❌ SD card full!');
                this.io.emit('camera-error', { error: 'SD card full' });
            }
        });

        // Handle process exit (camera disconnected or error)
        this.monitorProcess.on('close', (code) => {
            console.log(`[Camera] Monitor process exited with code ${code}`);

            if (!this.isShuttingDown) {
                console.log('[Camera] Camera disconnected or process crashed, scheduling reconnect');
                this.setConnectionState(ConnectionState.DISCONNECTED);
                this.scheduleReconnect();
            }
        });

        // Handle process errors
        this.monitorProcess.on('error', (err) => {
            console.error('[Camera] Monitor process error:', err);
            if (!this.isShuttingDown) {
                this.setConnectionState(ConnectionState.ERROR);
                this.scheduleReconnect();
            }
        });

        // Successfully started
        this.setConnectionState(ConnectionState.CONNECTED);
        console.log('[Camera] ✅ Event monitor started successfully');
    }

    /**
     * Parse photo capture event from gphoto2 stdout
     * Example: "Saving file as sessions/session_123/photo_143052.jpg"
     */
    private parsePhotoEvent(line: string): void {
        // Extract filename from gphoto2 output
        const match = line.match(/Saving file as (.+\.jpe?g)/i);

        if (!match) {
            return;
        }

        const fullPath = match[1];
        const filename = fullPath.split('/').pop() || '';

        // Filter: only process JPG files (skip RAW if camera shoots RAW+JPG)
        if (!/\.jpe?g$/i.test(filename)) {
            console.log(`[Camera] Skipping non-JPG file: ${filename}`);
            return;
        }

        const photoPath = `/photos/current/${filename}`;

        console.log(`[Camera] 📷 Photo captured: ${filename}`);

        // Wait for file to be fully written before notifying
        this.waitForFileAndNotify(fullPath, filename, photoPath);
    }

    /**
     * Wait for file to be fully written, then notify frontend
     */
    private async waitForFileAndNotify(fullPath: string, filename: string, photoPath: string): Promise<void> {
        const maxRetries = 10;
        const retryDelay = 100; // ms

        for (let i = 0; i < maxRetries; i++) {
            try {
                await access(fullPath);
                // File exists and is accessible

                // Call callback (adds to session array in server.ts)
                if (this.onPhotoCapture) {
                    this.onPhotoCapture(filename, photoPath);
                }

                // Emit Socket.io event (notifies frontend)
                this.io.emit('photo-captured', {
                    filename,
                    path: photoPath,
                });

                return;
            } catch {
                // File not ready yet, wait and retry
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }

        console.error(`[Camera] Timeout waiting for file: ${fullPath}`);
    }

    /**
     * Handle camera errors (simplified for event-based monitoring)
     */
    private async handleCameraError(error: unknown): Promise<void> {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[Camera] Error occurred:', errorMsg);

        // Check if camera is still available
        const stillConnected = await this.checkCameraAvailable();
        if (!stillConnected) {
            console.log('[Camera] Camera disconnected, scheduling reconnection');
            this.setConnectionState(ConnectionState.DISCONNECTED);
            this.scheduleReconnect();
        } else {
            // Temporary error - log and continue
            console.log('[Camera] Temporary error, camera still connected');
        }
    }

    /**
     * Check if camera is available by performing actual operation
     * Uses --summary which requires camera to be accessible
     */
    private async checkCameraAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            // Use --summary instead of --auto-detect for more reliable check
            const detect = spawn(this.gphoto2Path, ['--summary']);

            let output = '';
            let errorOutput = '';
            let resolved = false;

            // Handle timeout
            const timeout = setTimeout(() => {
                if (!resolved && !detect.killed) {
                    resolved = true;
                    detect.kill();
                    console.log('[Camera] Detection timed out');
                    resolve(false);
                }
            }, 5000);

            detect.stdout?.on('data', (data: Buffer) => {
                output += data.toString();
            });

            detect.stderr?.on('data', (data: Buffer) => {
                errorOutput += data.toString();
            });

            detect.on('close', (code) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);

                    // Check if command succeeded and returned camera info
                    const hasCamera = code === 0 && output.length > 0;

                    if (hasCamera) {
                        console.log('[Camera] ✅ Camera detected and accessible');
                    } else {
                        console.log('[Camera] ❌ Camera not detected or not accessible');
                        if (errorOutput) {
                            console.log(`[Camera] Error: ${errorOutput.substring(0, 200)}`);
                        }
                    }

                    resolve(hasCamera);
                }
            });

            detect.on('error', (err) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    console.error('[Camera] Detection error:', err);
                    resolve(false);
                }
            });
        });
    }

    /**
     * Schedule a reconnection attempt with fixed interval
     */
    private scheduleReconnect(): void {
        // Stop all timers first to prevent duplicates
        this.stopAllTimers();

        console.log(`[Camera] Will retry connection in ${this.reconnectInterval / 1000}s`);

        this.reconnectTimer = setTimeout(async () => {
            if (this.isShuttingDown || !this.currentSessionId) {
                return;
            }

            console.log('[Camera] Attempting to reconnect...');
            await this.startCameraMonitor();
        }, this.reconnectInterval);
    }

    /**
     * Update connection state and emit to clients
     */
    private setConnectionState(state: ConnectionState): void {
        if (this.connectionState !== state) {
            const oldState = this.connectionState;
            this.connectionState = state;
            console.log(`[Camera] State: ${oldState} → ${state}`);

            // Emit to clients
            this.io.emit('camera-status', {
                connected: state === ConnectionState.CONNECTED,
                state: state,
            });
        }
    }

    /**
     * Get current connection status
     */
    public getStatus(): { connected: boolean; sessionId: string | null; state: string } {
        return {
            connected: this.connectionState === ConnectionState.CONNECTED,
            sessionId: this.currentSessionId,
            state: this.connectionState,
        };
    }
}
