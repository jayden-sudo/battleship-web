import type * as Party from "partykit/server";

interface RoomInfo {
  type: 'room-info';
  userCount: number;
}

interface BroadcastMessage {
  type: 'message';
  from: string;
  data: unknown;
  timestamp: number;
}

interface GameStatus {
  gameId: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const LOBBY_ROOM_ID = "lobby";
const LOBBY_TTL = 5000; // 5 seconds
const MAX_GAMES = 500;

export default class Server implements Party.Server {
  // Lobby-specific: key: gameId, value: last active time
  private activeGames: Map<string, number> = new Map();
  private readonly isLobby: boolean;

  constructor(readonly room: Party.Room) {
    this.isLobby = room.id === LOBBY_ROOM_ID;
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    console.log(`[Room ${this.room.id}] User connected: ${conn.id}`);

    // Get current user count
    const userCount = [...this.room.getConnections()].length;

    // Send room info to the newly connected user
    const roomInfo: RoomInfo = {
      type: 'room-info',
      userCount: userCount
    };
    conn.send(JSON.stringify(roomInfo));

    // Notify all other users about the new user count
    this.broadcastRoomInfo();

    console.log(`[Room ${this.room.id}] Total users: ${userCount}`);
  }

  onClose(conn: Party.Connection) {
    console.log(`[Room ${this.room.id}] User disconnected: ${conn.id}`);

    // Notify remaining users about updated user count
    this.broadcastRoomInfo();
  }

  onMessage(message: string, sender: Party.Connection) {
    try {
      console.log(`[Room ${this.room.id}] Message from ${sender.id}: ${message}`);

      // Parse the incoming message
      const parsedMessage = JSON.parse(message);

      // Create broadcast message
      const broadcastMsg: BroadcastMessage = {
        type: 'message',
        from: sender.id,
        data: parsedMessage,
        timestamp: Date.now()
      };

      // Broadcast to all other connections
      this.room.broadcast(
        JSON.stringify(broadcastMsg),
        [sender.id] // Exclude sender
      );
    } catch (error) {
      console.error(`[Room ${this.room.id}] Error processing message:`, error);
    }
  }

  private broadcastRoomInfo() {
    const userCount = [...this.room.getConnections()].length;
    const roomInfo: RoomInfo = {
      type: 'room-info',
      userCount: userCount
    };
    this.room.broadcast(JSON.stringify(roomInfo));
  }


  async onRequest(req: Party.Request) {
    // Only lobby room handles HTTP requests
    if (!this.isLobby) {
      return new Response("Not found", { 
        status: 404, 
        headers: CORS_HEADERS 
      });
    }

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // Register active game
    if (req.method === "POST") {
      try {
        const body = await req.json() as GameStatus;
        if (!body.gameId) {
          return new Response('Invalid gameId', { 
            status: 400, 
            headers: CORS_HEADERS 
          });
        }
        
        this.activeGames.set(body.gameId.toLowerCase(), Date.now());
        console.log('[Lobby] Game registered:', body.gameId);
        
        return new Response('OK', {
          status: 200,
          headers: CORS_HEADERS,
        });
      } catch (error) {
        console.error('[Lobby] POST error:', error);
        return new Response('Invalid JSON', { 
          status: 400, 
          headers: CORS_HEADERS 
        });
      }
    }

    // Get active games
    if (req.method === "GET") {
      const now = Date.now();
      const cutoff = now - LOBBY_TTL;
      const activeGameIds: string[] = [];

      // Clean up expired games and collect active ones
      for (const [gameId, timestamp] of this.activeGames.entries()) {
        if (timestamp < cutoff) {
          this.activeGames.delete(gameId);
        } else {
          activeGameIds.push(gameId);
          if (activeGameIds.length >= MAX_GAMES) break;
        }
      }

      console.log(`[Lobby] Active games: ${activeGameIds.length}/${this.activeGames.size}`);
      
      return new Response(JSON.stringify(activeGameIds), {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
        },
      });
    }

    return new Response("Method not allowed", { 
      status: 405, 
      headers: CORS_HEADERS 
    });
  }
}

Server satisfies Party.Worker;
