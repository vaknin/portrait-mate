// Type definitions for the portrait-mate application

export interface Photo {
  filename: string;
  path: string;
  // Selected state is now managed by frontend only
}

// WebSocket event payloads (Server -> Client)
export interface PhotoCapturedEvent {
  filename: string;
  path: string;
}

export interface WhatsAppStatusEvent {
  connected: boolean;
}

export interface CameraStatusEvent {
  connected: boolean;
}

export interface SendProgressEvent {
  current: number;
  total: number;
}

export interface SendCompleteEvent {
  success: boolean;
  count: number;
  error?: string;
}

// WebSocket event payloads (Client -> Server)
export type ClientRequestPhotosEvent = Record<string, never>;

export interface ClientSendPhotosEvent {
  phone: string;
  photos: string[]; // Array of filenames
}

export type ClientResetSessionEvent = Record<string, never>;
