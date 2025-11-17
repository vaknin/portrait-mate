import { spawn, type ChildProcess } from 'node:child_process';
import { watch } from 'node:fs';
import { mkdir } from 'node:fs/promises';
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
    reconnectInterval?: number;
    onPhotoCapture?: (filename: string, path: string) => void;
}

export class CameraService {
    private io: SocketIOServer;
    private gphoto2Path: string;
    private reconnectInterval: number;
    private onPhotoCapture?: (filename: string, path: string) => void;
    private monitorProcess: ChildProcess | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private pollTimer: NodeJS.Timeout | null = null;
    private currentSessionId: string | null = null;
    private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
    private isShuttingDown = false;
    private downloadedFiles: Set<string> = new Set();
    private downloadQueue: string[] = []; // Queue of files to download
    private isProcessingQueue: boolean = false;
    private pollInterval: number = 1500; // 1.5 seconds
    private cameraFolderPath: string | null = null; // Dynamically discovered path
    private reconnectAttempts: number = 0;
    private maxReconnectInterval: number = 30000; // 30 seconds max

    constructor(config: CameraServiceConfig) {
        this.io = config.io;
        this.gphoto2Path = config.gphoto2Path || 'gphoto2';
        this.reconnectInterval = config.reconnectInterval || 5000; // 5 seconds
        this.onPhotoCapture = config.onPhotoCapture;
    }

    /**
     * Start monitoring the camera for new photos
     */
    async startSession(sessionId: string): Promise<void> {
        this.currentSessionId = sessionId;

        // Create session directory
        const sessionDir = join(process.cwd(), 'sessions', sessionId);
        await mkdir(sessionDir, { recursive: true });

        console.log(`[Camera] Starting session: ${sessionId}`);

        // Start camera monitoring
        await this.startCameraMonitor();
    }

    /**
     * Stop all active timers (centralized cleanup)
     */
    private stopAllTimers(): void {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * Stop the current session and camera monitoring
     */
    async stopSession(): Promise<void> {
        console.log('[Camera] Stopping session...');
        this.isShuttingDown = true;

        // Stop all timers
        this.stopAllTimers();

        // Stop camera monitor process
        if (this.monitorProcess) {
            this.monitorProcess.kill('SIGUSR2'); // Graceful shutdown
            this.monitorProcess = null;
        }

        // Reset state
        this.currentSessionId = null;
        this.connectionState = ConnectionState.DISCONNECTED;
        this.isShuttingDown = false;
        this.downloadedFiles.clear();
        this.downloadQueue = [];
        this.isProcessingQueue = false;
        this.cameraFolderPath = null;
        this.reconnectAttempts = 0;

        console.log('[Camera] Session stopped');
    }

    /**
     * Start the gphoto2 monitoring process using polling approach
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

        // Discover camera path if not cached
        if (!this.cameraFolderPath) {
            console.log('[Camera] Discovering camera folder structure...');
            this.cameraFolderPath = await this.discoverCameraPath();

            if (!this.cameraFolderPath) {
                console.error('[Camera] Failed to discover camera folder, will retry...');
                this.setConnectionState(ConnectionState.ERROR);
                this.scheduleReconnect();
                return;
            }
        }

        // Successfully connected
        this.setConnectionState(ConnectionState.CONNECTED);
        console.log('[Camera] ✅ Monitor started successfully');

        // Start polling for new photos
        this.startPolling();
    }

    /**
     * Start polling for new photos on the camera
     */
    private startPolling(): void {
        if (this.isShuttingDown || !this.currentSessionId) {
            return;
        }

        // Clear any existing timer to prevent duplicates
        this.stopAllTimers();

        this.pollTimer = setTimeout(async () => {
            await this.checkAndDownloadNewPhotos();
            this.startPolling(); // Schedule next poll
        }, this.pollInterval);
    }

    /**
     * Check for new photos on camera and add to download queue
     */
    private async checkAndDownloadNewPhotos(): Promise<void> {
        // Only check if connected - don't block during download
        if (!this.currentSessionId || this.connectionState !== ConnectionState.CONNECTED) {
            return;
        }

        try {
            // List files on camera
            const files = await this.listCameraFiles();

            // Filter out already downloaded files
            const newFiles = files.filter(file => !this.downloadedFiles.has(file));

            if (newFiles.length > 0) {
                console.log(`[Camera] Found ${newFiles.length} new photo(s), adding to queue`);

                // Add to queue
                for (const file of newFiles) {
                    if (!this.downloadQueue.includes(file)) {
                        this.downloadQueue.push(file);
                    }
                }

                // Start processing queue if not already running
                this.processDownloadQueue();
            }
        } catch (error) {
            console.error('[Camera] Error checking for new photos:', error);
            await this.handleCameraError(error);
        }
    }

    /**
     * Process the download queue asynchronously
     */
    private async processDownloadQueue(): Promise<void> {
        if (this.isProcessingQueue || this.downloadQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.downloadQueue.length > 0 && !this.isShuttingDown) {
            const file = this.downloadQueue.shift();
            if (!file) continue;

            try {
                await this.downloadFile(file);
                this.downloadedFiles.add(file);
            } catch (error) {
                console.error(`[Camera] Failed to download ${file}:`, error);
                // Don't re-add to queue - mark as downloaded to avoid infinite retries
                this.downloadedFiles.add(file);
            }
        }

        this.isProcessingQueue = false;
    }

    /**
     * Handle camera errors (distinguish temporary from fatal)
     */
    private async handleCameraError(error: unknown): Promise<void> {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Path-related errors - try re-discovering
        if (errorMsg.includes('folder') || errorMsg.includes('path') || errorMsg.includes('discover')) {
            console.log('[Camera] Path issue detected, will re-discover on next attempt');
            this.cameraFolderPath = null;
            return; // Don't disconnect, just retry
        }

        // Check if camera is still available
        const stillConnected = await this.checkCameraAvailable();
        if (!stillConnected) {
            console.log('[Camera] Camera disconnected, scheduling reconnection');
            this.setConnectionState(ConnectionState.DISCONNECTED);
            this.scheduleReconnect();
        } else {
            // Temporary error - keep polling
            console.log('[Camera] Temporary error, continuing to poll');
        }
    }

    /**
     * Dynamically discover the camera's DCIM folder path
     * Returns path like "/store_00020001/DCIM/103CANON" or null if not found
     */
    private async discoverCameraPath(): Promise<string | null> {
        return new Promise((resolve) => {
            console.log('[Camera] Discovering camera storage path...');

            const process = spawn(this.gphoto2Path, [
                '--list-folders',
                '--folder',
                '/'
            ]);

            let output = '';
            let errorOutput = '';

            process.stdout?.on('data', (data: Buffer) => {
                output += data.toString();
            });

            process.stderr?.on('data', (data: Buffer) => {
                errorOutput += data.toString();
            });

            process.on('close', (code) => {
                if (code !== 0) {
                    console.error('[Camera] Failed to list root folders:', errorOutput);
                    resolve(null);
                    return;
                }

                // Look for store folders (e.g., "store_00010001", "store_00020001")
                const storeMatch = output.match(/('|")?(\/store_\d+)/i);
                if (!storeMatch) {
                    console.error('[Camera] No storage folder found in output');
                    resolve(null);
                    return;
                }

                const storePath = storeMatch[2];
                console.log(`[Camera] Found storage: ${storePath}`);

                // Now look for DCIM folder
                this.findDCIMFolder(storePath).then(resolve);
            });

            process.on('error', (err) => {
                console.error('[Camera] Error discovering path:', err);
                resolve(null);
            });
        });
    }

    /**
     * Find DCIM folder within a storage path
     */
    private async findDCIMFolder(storePath: string): Promise<string | null> {
        return new Promise((resolve) => {
            const process = spawn(this.gphoto2Path, [
                '--list-folders',
                '--folder',
                storePath
            ]);

            let output = '';

            process.stdout?.on('data', (data: Buffer) => {
                output += data.toString();
            });

            process.on('close', (code) => {
                if (code !== 0) {
                    console.error('[Camera] Failed to list storage folders');
                    resolve(null);
                    return;
                }

                // Look for DCIM folder
                const dcimMatch = output.match(/('|")?(\/[^'"\n]*DCIM)/i);
                if (!dcimMatch) {
                    console.error('[Camera] No DCIM folder found');
                    resolve(null);
                    return;
                }

                const dcimPath = dcimMatch[2];
                console.log(`[Camera] Found DCIM: ${dcimPath}`);

                // Now look for Canon folder (e.g., 100CANON, 103CANON)
                this.findCanonFolder(dcimPath).then(resolve);
            });

            process.on('error', () => {
                resolve(null);
            });
        });
    }

    /**
     * Find Canon photo folder within DCIM
     */
    private async findCanonFolder(dcimPath: string): Promise<string | null> {
        return new Promise((resolve) => {
            const process = spawn(this.gphoto2Path, [
                '--list-folders',
                '--folder',
                dcimPath
            ]);

            let output = '';

            process.stdout?.on('data', (data: Buffer) => {
                output += data.toString();
            });

            process.on('close', (code) => {
                if (code !== 0) {
                    console.error('[Camera] Failed to list DCIM folders');
                    resolve(null);
                    return;
                }

                // Look for Canon folder (e.g., "100CANON", "103CANON", etc.)
                // Try to find the highest numbered one (most recent)
                const folderMatches = output.matchAll(/('|")?(\/[^'"\n]*\/(\d+)CANON)/gi);
                const folders: { path: string; number: number }[] = [];

                for (const match of folderMatches) {
                    folders.push({
                        path: match[2],
                        number: parseInt(match[3], 10)
                    });
                }

                if (folders.length === 0) {
                    console.error('[Camera] No Canon folder found in DCIM');
                    resolve(null);
                    return;
                }

                // Use the highest numbered folder (most recent)
                folders.sort((a, b) => b.number - a.number);
                const canonPath = folders[0].path;

                console.log(`[Camera] ✅ Discovered photo folder: ${canonPath}`);
                resolve(canonPath);
            });

            process.on('error', () => {
                resolve(null);
            });
        });
    }

    /**
     * List JPG files on camera SD card
     */
    private async listCameraFiles(): Promise<string[]> {
        // Discover path if not cached or if cached path might be stale
        if (!this.cameraFolderPath) {
            this.cameraFolderPath = await this.discoverCameraPath();
            if (!this.cameraFolderPath) {
                throw new Error('Failed to discover camera photo folder');
            }
        }

        return new Promise((resolve, reject) => {
            const process = spawn(this.gphoto2Path, [
                '--list-files',
                '--folder',
                this.cameraFolderPath!
            ]);

            let output = '';
            let errorOutput = '';

            process.stdout?.on('data', (data: Buffer) => {
                output += data.toString();
            });

            process.stderr?.on('data', (data: Buffer) => {
                errorOutput += data.toString();
            });

            process.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Failed to list files: ${errorOutput}`));
                    return;
                }

                // Parse output for JPG files
                // Format: "#1     IMG_1234.JPG               12345 KB   image/jpeg"
                const files: string[] = [];
                const lines = output.split('\n');

                for (const line of lines) {
                    const match = line.match(/#\d+\s+(\S+\.(?:jpg|JPG|jpeg|JPEG))/);
                    if (match && match[1]) {
                        files.push(match[1]);
                    }
                }

                resolve(files);
            });

            process.on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Download a specific file from camera
     */
    private async downloadFile(filename: string): Promise<void> {
        if (!this.currentSessionId || !this.cameraFolderPath) {
            return;
        }

        const sessionDir = join(process.cwd(), 'sessions', this.currentSessionId);
        const timestamp = new Date().toTimeString().split(' ')[0].replace(/:/g, '');
        const localFilename = `photo_${timestamp}.jpg`;
        const localPath = join(sessionDir, localFilename);

        return new Promise((resolve, reject) => {
            const process = spawn(this.gphoto2Path, [
                '--get-file',
                filename,
                '--folder',
                this.cameraFolderPath!,
                '--filename',
                localPath
            ]);

            let errorOutput = '';

            process.stderr?.on('data', (data: Buffer) => {
                errorOutput += data.toString();
            });

            process.on('close', (code) => {
                if (code !== 0) {
                    console.error(`[Camera] Failed to download ${filename}: ${errorOutput}`);
                    reject(new Error(`Download failed: ${errorOutput}`));
                    return;
                }

                console.log(`[Camera] Downloaded: ${filename} -> ${localFilename}`);

                const photoPath = `/photos/${this.currentSessionId}/${localFilename}`;

                // Call callback
                if (this.onPhotoCapture) {
                    this.onPhotoCapture(localFilename, photoPath);
                }

                // Emit Socket.io event
                this.io.emit('photo-captured', {
                    filename: localFilename,
                    path: photoPath,
                });

                resolve();
            });

            process.on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Check if camera is available by performing actual operation
     * Uses --summary which requires camera to be accessible
     */
    private async checkCameraAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            // Use --summary instead of --auto-detect for more reliable check
            const detect = spawn(this.gphoto2Path, ['--summary'], {
                timeout: 5000, // 5 second timeout
            });

            let output = '';
            let errorOutput = '';

            detect.stdout?.on('data', (data: Buffer) => {
                output += data.toString();
            });

            detect.stderr?.on('data', (data: Buffer) => {
                errorOutput += data.toString();
            });

            detect.on('close', (code) => {
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
            });

            detect.on('error', (err) => {
                console.error('[Camera] Detection error:', err);
                resolve(false);
            });

            // Handle timeout
            setTimeout(() => {
                if (!detect.killed) {
                    detect.kill();
                    console.log('[Camera] Detection timed out');
                    resolve(false);
                }
            }, 5000);
        });
    }

    /**
     * Schedule a reconnection attempt with exponential backoff
     */
    private scheduleReconnect(): void {
        // Stop all timers first to prevent duplicates
        this.stopAllTimers();

        // Calculate backoff time (exponential up to max)
        const backoffTime = Math.min(
            this.reconnectInterval * Math.pow(2, this.reconnectAttempts),
            this.maxReconnectInterval
        );

        this.reconnectAttempts++;
        console.log(`[Camera] Scheduling reconnect attempt #${this.reconnectAttempts} in ${backoffTime}ms`);

        this.reconnectTimer = setTimeout(async () => {
            if (this.isShuttingDown || !this.currentSessionId) {
                return;
            }

            console.log('[Camera] Attempting to reconnect...');
            await this.startCameraMonitor();
        }, backoffTime);
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

            // Reset reconnect attempts on successful connection
            if (state === ConnectionState.CONNECTED) {
                this.reconnectAttempts = 0;
            }
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
