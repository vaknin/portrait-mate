import { spawn } from 'bun';

console.log('🚀 Starting Dev Server...');

const server = spawn(['bun', 'src/server.ts'], {
    stdout: 'inherit', // Forward stdout directly (pino-pretty is now inside the app)
    stderr: 'pipe',    // Pipe stderr to filter warnings
    env: { ...process.env, FORCE_COLOR: '1' }, // Ensure colors are preserved
});

// Filter stderr
const decoder = new TextDecoder();
async function readStderr() {
    if (!server.stderr) return;
    const reader = server.stderr.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        const lines = text.split('\n');
        for (const line of lines) {
            if (line.trim() && !line.includes('[bun] Warning')) {
                process.stderr.write(line + '\n');
            }
        }
    }
}

readStderr();

// Handle input (hide ^C)
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', (key) => {
    // Ctrl+C is \u0003
    if (key.toString() === '\u0003') {
        server.kill('SIGINT');
    }
});

// Handle signals (from system, e.g. kill command)
const signals = ['SIGTERM'] as const; // SIGINT handled via stdin
for (const signal of signals) {
    process.on(signal, () => {
        server.kill(signal);
    });
}

// Wait for server to exit
const exitCode = await server.exited;
process.exit(exitCode);
