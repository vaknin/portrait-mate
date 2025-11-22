import type { Request, Response } from 'express';
import { networkInterfaces } from 'os';
import QRCode from 'qrcode';
import { config } from '../config.js';

export class ConnectController {
    public async handleConnect(req: Request, res: Response): Promise<void> {
        const ip = this.getLocalIP();
        const port = config.PORT || 3000;
        const url = `http://${ip}:${port}`;

        try {
            const qrDataURL = await QRCode.toDataURL(url, { width: 400, margin: 2 });

            const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Connect to Portrait Mate</title>
            <style>
                body {
                    background-color: #0a0a0a;
                    color: #ffffff;
                    font-family: system-ui, -apple-system, sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                }
                .container {
                    text-align: center;
                    padding: 2rem;
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 24px;
                    backdrop-filter: blur(10px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }
                h1 { margin-bottom: 1rem; font-weight: 600; }
                p { color: #888; margin-bottom: 2rem; }
                .qr-code {
                    border-radius: 12px;
                    overflow: hidden;
                    margin-bottom: 1.5rem;
                    background: white;
                    padding: 1rem;
                }
                img { display: block; max-width: 100%; height: auto; }
                .url {
                    font-family: monospace;
                    background: rgba(0, 0, 0, 0.3);
                    padding: 0.5rem 1rem;
                    border-radius: 8px;
                    color: #fff;
                    font-size: 1.2rem;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Portrait Mate</h1>
                <p>Scan to connect your phone</p>
                <div class="qr-code">
                    <img src="${qrDataURL}" alt="Connection QR Code">
                </div>
                <div class="url">${url}</div>
            </div>
        </body>
        </html>
      `;

            res.send(html);
        } catch (error) {
            res.status(500).send('Error generating QR code');
        }
    }

    private getLocalIP(): string {
        const nets = networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]!) {
                // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
                if (net.family === 'IPv4' && !net.internal) {
                    return net.address;
                }
            }
        }
        return 'localhost';
    }
}
