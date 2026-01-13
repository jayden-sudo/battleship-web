/**
 * Trystero P2P Mock Server
 * HTTP + Server-Sent Events
 * 
 * RUN: npx tsx simulateP2PEnv.ts
 */

import http from 'http';
import { randomUUID } from 'crypto';

const PORT = 3999;

interface Peer {
    id: string;
    res: http.ServerResponse;
}

interface Room {
    peers: Map<string, Peer>;
}

const rooms = new Map<string, Room>();

function sendSSE(res: http.ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastToRoom(roomId: string, event: string, data: unknown, excludePeerId?: string): void {
    const room = rooms.get(roomId);
    if (!room) return;

    for (const [peerId, peer] of room.peers) {
        if (peerId !== excludePeerId) {
            sendSSE(peer.res, event, data);
        }
    }
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                resolve({});
            }
        });
    });
}

function parseQuery(url: string): URLSearchParams {
    const idx = url.indexOf('?');
    return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : '');
}

const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    const method = req.method || 'GET';
    const path = url.split('?')[0];

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // GET /join?roomId=xxx&peerId=xxx
    if (method === 'GET' && path === '/join') {
        const query = parseQuery(url);
        const roomId = query.get('roomId');
        const peerId = query.get('peerId') || randomUUID();

        if (!roomId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'roomId required' }));
            return;
        }

        // SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });

        if (!rooms.has(roomId)) {
            rooms.set(roomId, { peers: new Map() });
        }
        const room = rooms.get(roomId)!;

        broadcastToRoom(roomId, 'peerJoin', { peerId });

        const existingPeers = [...room.peers.keys()];

        room.peers.set(peerId, { id: peerId, res });

        sendSSE(res, 'connected', { peerId, peers: existingPeers });

        console.log(`✅ [${roomId}] Peer joined: ${peerId}, total: ${room.peers.size}`);

        req.on('close', () => {
            room.peers.delete(peerId);
            broadcastToRoom(roomId, 'peerLeave', { peerId });
            console.log(`❌ [${roomId}] Peer left: ${peerId}, total: ${room.peers.size}`);

            if (room.peers.size === 0) {
                rooms.delete(roomId);
                console.log(`🗑️  Room deleted: ${roomId}`);
            }
        });

        return;
    }

    // POST /send { roomId, fromPeerId, toPeerId?, data }
    if (method === 'POST' && path === '/send') {
        const body = await parseBody(req);
        const { roomId, fromPeerId, toPeerId, data } = body as {
            roomId: string;
            fromPeerId: string;
            toPeerId?: string;
            data: unknown;
        };

        if (!roomId || !fromPeerId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'roomId and fromPeerId required' }));
            return;
        }

        const room = rooms.get(roomId);
        if (!room) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'room not found' }));
            return;
        }

        const message = { fromPeerId, data };

        if (toPeerId) {
            const peer = room.peers.get(toPeerId);
            if (peer) {
                sendSSE(peer.res, 'message', message);
            }
        } else {
            broadcastToRoom(roomId, 'message', message, fromPeerId);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // GET /peers?roomId=xxx
    if (method === 'GET' && path === '/peers') {
        const query = parseQuery(url);
        const roomId = query.get('roomId');

        if (!roomId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'roomId required' }));
            return;
        }

        const room = rooms.get(roomId);
        const peers = room ? [...room.peers.keys()] : [];

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ peers }));
        return;
    }

    if (method === 'GET' && path === '/') {
        const status = {
            rooms: [...rooms.entries()].map(([id, room]) => ({
                id,
                peers: [...room.peers.keys()],
            })),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status, null, 2));
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`
╔═══════════════╗
║           Trystero P2P                     ║
╠═══════════════╣
║  地址: http://localhost:${PORT}  ║
║                                                       ║
║  API:                                               ║
║    GET  /join?roomId=xxx&peerId=xxx  ║
║    POST /send                               ║
║    GET  /peers?roomId=xxx          ║
║    GET  /                                         ║
╚═══════════════╝
`);
});