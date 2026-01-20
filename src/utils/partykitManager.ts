import { EventEmitter } from "events";
import PartySocket from "partysocket";

interface RoomInfo {
  type: "room-info";
  userCount: number;
}

interface BroadcastMessage {
  type: "message";
  from: string;
  data: unknown;
}

interface PartykitEvents {
  roomInfo: (userCount: number) => void;
  message: (fromUserId: string, data: unknown) => void;
  connected: () => void;
  disconnected: () => void;
  error: (error: Error) => void;
}

export declare interface IPartykitManager {
  on<U extends keyof PartykitEvents>(
    event: U,
    listener: PartykitEvents[U],
  ): this;
  off<U extends keyof PartykitEvents>(
    event: U,
    listener: PartykitEvents[U],
  ): this;
  emit<U extends keyof PartykitEvents>(
    event: U,
    ...args: Parameters<PartykitEvents[U]>
  ): boolean;
}

export class PartykitManager extends EventEmitter implements IPartykitManager {
  private static instance: PartykitManager | null = null;
  private socket: PartySocket | null = null;
  private currentRoomId: string | null = null;
  private readonly host: string;
  private readonly lobbyHost: string;

  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // 2s
  private maxReconnectDelay = 30000; // 30s
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect = true;

  private constructor() {
    super();
    this.host = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";
    this.lobbyHost = `${this.host}/parties/main/lobby`;
  }

  static getInstance(): PartykitManager {
    return (PartykitManager.instance ??= new PartykitManager());
  }

  async getActiveGames(): Promise<Set<string>> {
    const set: Set<string> = new Set();
    try {
      const protocol = this.host.startsWith("localhost") ? "http" : "https";
      const response = await fetch(`${protocol}://${this.lobbyHost}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch active games: ${response.status}`);
      }

      const games = (await response.json()) as string[];
      console.log("[PartyKit Lobby] Active games:", games.length);
      for (const gameId of games) {
        set.add(gameId.toLowerCase());
      }
    } catch (error) {
      console.error("[PartyKit Lobby] Failed to get active games:", error);
    }
    return set;
  }

  async registerGame(gameId: string): Promise<boolean> {
    try {
      const protocol = this.host.startsWith("localhost") ? "http" : "https";
      const response = await fetch(`${protocol}://${this.lobbyHost}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId: gameId.toLowerCase() }),
      });

      if (!response.ok) {
        throw new Error(`Failed to register game: ${response.status}`);
      }

      console.log("[PartyKit Lobby] Game registered:", gameId);
      return true;
    } catch (error) {
      console.error("[PartyKit Lobby] Failed to register game:", error);
      return false;
    }
  }

  /**
   * Join or create a game room
   */
  joinRoom(gameId: string): void {
    if (this.socket) {
      console.warn(
        "[PartyKit] Already connected to a room, disconnecting first",
      );
      this.leave();
    }

    try {
      this.currentRoomId = gameId;
      this.shouldReconnect = true;
      this.reconnectAttempts = 0;

      // Create WebSocket connection to the room
      this.socket = new PartySocket({
        host: this.host,
        party: "main",
        room: gameId,
      });

      this.setupSocketHandlers();
      console.log("[PartyKit] Joining room:", gameId);
    } catch (error) {
      console.error("[PartyKit] Failed to join room:", error);
      this.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
      this.scheduleReconnect();
    }
  }

  leave(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();

    if (this.socket) {
      try {
        this.socket.close();
        console.log("[PartyKit] Left room:", this.currentRoomId);
      } catch (error) {
        console.error("[PartyKit] Error leaving room:", error);
      } finally {
        this.socket = null;
        this.currentRoomId = null;
      }
    }
  }

  send(data: unknown): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn("[PartyKit] Cannot send message: not connected");
      return false;
    }

    try {
      this.socket.send(JSON.stringify(data));
      console.log("[PartyKit] Message sent:", data);
      return true;
    } catch (error) {
      console.error("[PartyKit] Failed to send message:", error);
      this.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
      return false;
    }
  }

  getRoomId(): string | null {
    return this.currentRoomId;
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.addEventListener("open", () => {
      console.log("[PartyKit] Connected to room:", this.currentRoomId);
      this.reconnectAttempts = 0;
      this.emit("connected");
    });

    this.socket.addEventListener("close", () => {
      console.log("[PartyKit] Disconnected from room:", this.currentRoomId);
      this.emit("disconnected");
      this.socket = null;

      if (this.shouldReconnect && this.currentRoomId) {
        this.scheduleReconnect();
      }
    });

    this.socket.addEventListener("error", (event) => {
      console.error("[PartyKit] Socket error:", event);
      this.emit("error", new Error("WebSocket error"));
    });

    this.socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "room-info") {
          const roomInfo = message as RoomInfo;
          console.log("[PartyKit] Room info:", roomInfo.userCount, "users");
          this.emit("roomInfo", roomInfo.userCount);
        } else if (message.type === "message") {
          const broadcastMsg = message as BroadcastMessage;
          console.log("[PartyKit] Message received from", broadcastMsg.from);
          this.emit("data", broadcastMsg.from, broadcastMsg.data);
        }
      } catch (error) {
        debugger;
        console.error("[PartyKit] Failed to parse message:", error);
      }
    });
  }

  destroy(): void {
    this.clearReconnectTimer();
    this.leave();
    this.removeAllListeners();
    console.log("[PartyKit] Instance destroyed");
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(
        "[PartyKit] Max reconnection attempts reached:",
        this.maxReconnectAttempts,
      );
      this.emit("error", new Error("Max reconnection attempts reached"));
      return;
    }

    this.clearReconnectTimer();

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay,
    );

    this.reconnectAttempts++;
    console.log(
      `[PartyKit] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`,
    );

    this.reconnectTimer = setTimeout(() => {
      if (this.currentRoomId && this.shouldReconnect) {
        console.log(
          `[PartyKit] Attempting to reconnect to room: ${this.currentRoomId}`,
        );
        const roomId = this.currentRoomId;
        this.socket = null;

        try {
          this.socket = new PartySocket({
            host: this.host,
            party: "main",
            room: roomId,
          });
          this.setupSocketHandlers();
        } catch (error) {
          console.error("[PartyKit] Reconnection failed:", error);
          this.emit(
            "error",
            error instanceof Error ? error : new Error(String(error)),
          );
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
