import { EventEmitter } from "events";

// ============== DEBUG==============
const USE_MOCK_P2P = process.env.NEXT_PUBLIC_USE_MOCK_P2P === "true";
// NEXT_PUBLIC_USE_MOCK_P2P=true npm run dev

import * as realTrystero from "trystero/supabase";
import * as mockTrystero from "./mockTrystero";

const { joinRoom, selfId } = USE_MOCK_P2P ? mockTrystero : realTrystero;
type Room = ReturnType<typeof joinRoom>;

interface TrysteroManagerEvents {
  peerJoin: (peerId: string) => void;
  peerLeave: (peerId: string) => void;
  data: (peerId: string, data: unknown) => void;
  error: (error: Error) => void;
}

// P2P config
interface P2PConfig {
  appId: string;
  supabaseKey: string;
  rtcConfig: {
    iceServers: Array<{
      urls: string[];
      username?: string;
      credential?: string;
    }>;
  };
}

// default config as fallback
const DEFAULT_P2P_CONFIG: P2PConfig = {
  appId: "",
  supabaseKey: "",
  rtcConfig: {
    iceServers: [
      { urls: ["stun:stun.cloudflare.com:3478"] },
      { urls: ["stun:stun.l.google.com:19302"] },
    ],
  },
};

// localStorage cache config
const P2P_CONFIG_CACHE_KEY = "p2p_config_cache";
const P2P_CONFIG_CACHE_TTL = 6 * 60 * 60 * 1000; // 6H

interface CachedP2PConfig {
  config: P2PConfig;
  timestamp: number;
}

// from localStorage cache
function getCachedConfig(): { config: P2PConfig; isExpired: boolean } | null {
  if (typeof window === "undefined") return null;

  try {
    const cached = localStorage.getItem(P2P_CONFIG_CACHE_KEY);
    if (!cached) return null;

    const { config, timestamp }: CachedP2PConfig = JSON.parse(cached);
    const isExpired = Date.now() - timestamp > P2P_CONFIG_CACHE_TTL;

    return { config, isExpired };
  } catch (error) {
    console.warn("[P2P Config] Failed to read cache:", error);
    return null;
  }
}

// save to localStorage
function setCachedConfig(config: P2PConfig): void {
  if (typeof window === "undefined") return;

  try {
    const cached: CachedP2PConfig = {
      config,
      timestamp: Date.now(),
    };
    localStorage.setItem(P2P_CONFIG_CACHE_KEY, JSON.stringify(cached));
    console.log("[P2P Config] Cached to localStorage");
  } catch (error) {
    console.warn("[P2P Config] Failed to cache:", error);
  }
}

// fetch P2P config
async function fetchP2PConfig(): Promise<P2PConfig> {
  const cached = getCachedConfig();
  if (cached && !cached.isExpired) {
    console.log("[P2P Config] Using cached config");
    return cached.config;
  }

  try {
    const response = await fetch("/api/p2p-config", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch P2P config: ${response.status}`);
    }

    const config: P2PConfig = await response.json();
    console.log("[P2P Config] Successfully fetched from API");

    // save to localStorage
    setCachedConfig(config);

    return config;
  } catch (error) {
    console.error("[P2P Config] Failed to fetch from API:", error);

    // fallback
    if (cached) {
      console.log("[P2P Config] Using expired cached config as fallback");
      return cached.config;
    }

    console.log("[P2P Config] Using default config");
    return DEFAULT_P2P_CONFIG;
  }
}

export declare interface ITrysteroManager {
  on<U extends keyof TrysteroManagerEvents>(
    event: U,
    listener: TrysteroManagerEvents[U],
  ): this;
  off<U extends keyof TrysteroManagerEvents>(
    event: U,
    listener: TrysteroManagerEvents[U],
  ): this;
  emit<U extends keyof TrysteroManagerEvents>(
    event: U,
    ...args: Parameters<TrysteroManagerEvents[U]>
  ): boolean;
}

export class TrysteroManager extends EventEmitter implements ITrysteroManager {
  private static instance: TrysteroManager | null = null;
  private room: Room | null = null;
  private sendMessage:
    | ((
        data: string,
        targetPeerId?: string | string[] | null,
      ) => Promise<void[]>)
    | null = null;
  private currentRoomId: string | null = null;
  private connectedPeers = new Set<string>();
  private p2pConfig: P2PConfig | null = null;
  private configPromise: Promise<P2PConfig> | null = null;

  // private constructor() {
  //     super();
  //     if (USE_MOCK_P2P) {
  //         console.log('[TrysteroManager] Using MOCK P2P server');
  //     }
  // }

  // static getInstance(): TrysteroManager {
  //     return (TrysteroManager.instance ??= new TrysteroManager());
  // }
  public constructor() {
    super();
    if (USE_MOCK_P2P) {
      console.log("[TrysteroManager] Using MOCK P2P server");
    }
  }

  private async getConfig(): Promise<P2PConfig> {
    if (this.p2pConfig) {
      return this.p2pConfig;
    }

    if (!this.configPromise) {
      this.configPromise = fetchP2PConfig().then((config) => {
        this.p2pConfig = config;
        return config;
      });
    }

    return this.configPromise;
  }

  async refreshConfig(): Promise<P2PConfig> {
    this.p2pConfig = null;
    this.configPromise = null;

    // clear localStorage
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(P2P_CONFIG_CACHE_KEY);
        console.log("[P2P Config] Cache cleared");
      } catch (error) {
        console.warn("[P2P Config] Failed to clear cache:", error);
      }
    }

    return this.getConfig();
  }

  get peerId(): string {
    return selfId;
  }

  get roomId(): string | null {
    return this.currentRoomId;
  }

  get isConnected(): boolean {
    return this.room !== null;
  }

  get peers(): string[] {
    return [...this.connectedPeers];
  }

  async joinRoom(roomId: string): Promise<void> {
    if (!roomId?.trim()) {
      this.emit("error", new Error("Room ID cannot be empty"));
      return;
    }

    if (this.currentRoomId === roomId && this.room) {
      console.log("Already in room:", roomId);
      return;
    }

    this.leave();
    console.log("Joining room:", roomId);

    try {
      const config = await this.getConfig();

      if (!config.appId || !config.supabaseKey) {
        throw new Error(
          "Invalid P2P configuration: missing appId or supabaseKey",
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.room = joinRoom(config as any, roomId);
      // this.room = joinRoom({
      //     appId: "https://cmxgbjwgyaomrgoabgod.supabase.co",
      //     supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNteGdiandneWFvbXJnb2FiZ29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxNzY3NjAsImV4cCI6MjA4Mzc1Mjc2MH0.pFr7QiXE23-DFaTwdtK9hPVL692ot6ZkPeG-QXuv7II",
      //     rtcConfig: {
      //         iceServers: [
      //             {
      //                 urls: [
      //                     "stun:stun.cloudflare.com:3478",
      //                     "stun:stun.cloudflare.com:53"
      //                 ]
      //             },
      //             {
      //                 urls: [
      //                     "turn:turn.cloudflare.com:3478?transport=udp",
      //                     "turn:turn.cloudflare.com:3478?transport=tcp",
      //                     // "turns:turn.cloudflare.com:5349?transport=tcp",
      //                     "turn:turn.cloudflare.com:53?transport=udp",
      //                     "turn:turn.cloudflare.com:80?transport=tcp",
      //                     // "turns:turn.cloudflare.com:443?transport=tcp"
      //                 ],
      //                 username: "g00af2b34ec06d55845d8a668f4a5effefe1549e2060d3fe00f6e291caf7339f",
      //                 credential: "27fd73b3e7733ea971d7028afe16fd941dede9b0d43659c659c13028185f80d9"
      //             }
      //         ]
      //     }

      // }, roomId);
      this.currentRoomId = roomId;
      this.setupRoomHandlers();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("Failed to join room:", error);
      this.emit("error", error);
    }
  }

  getPeers() {
    if (this.room) {
      return this.room.getPeers();
    }
    throw new Error("Not connected to any room");
  }

  leave(): void {
    if (!this.room) return;

    console.log("🔌 Leaving room:", this.currentRoomId);
    try {
      this.room.leave();
    } catch (err) {
      console.warn("⚠️ Error while leaving room:", err);
    }

    this.cleanup();
    console.log("✅ Disconnected");
  }

  async send(data: unknown, targetPeerId?: string): Promise<boolean> {
    if (!this.sendMessage) {
      console.warn("⚠️ Cannot send: not connected to a room");
      return false;
    }
    const str = JSON.stringify(data);
    try {
      if (targetPeerId) {
        await this.sendMessage(str, targetPeerId);
        console.log("📤 Sent to", targetPeerId, ":", data);
      } else {
        await this.sendMessage(str);
        console.log("📢 Broadcast:", data);
      }
      return true;
    } catch (err) {
      console.error("❌ Send failed:", err);
      return false;
    }
  }

  private setupRoomHandlers(): void {
    if (!this.room) return;

    this.room.onPeerJoin((peerId) => {
      console.log("➕ Peer joined:", peerId);
      this.connectedPeers.add(peerId);
      this.emit("peerJoin", peerId);
    });

    this.room.onPeerLeave((peerId) => {
      console.log("➖ Peer left:", peerId);
      this.connectedPeers.delete(peerId);
      this.emit("peerLeave", peerId);
    });

    type MakeActionType = <T>(
      namespace: string,
    ) => [
      (
        data: T,
        targetPeers?: string | string[] | null,
        metadata?: unknown,
        progress?: (percent: number, peerId: string) => void,
      ) => Promise<void[]>,
      (receiver: (data: T, peerId: string, metadata?: unknown) => void) => void,
      (
        progressHandler: (
          percent: number,
          peerId: string,
          metadata?: unknown,
        ) => void,
      ) => void,
    ];

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [send, receive, _progress] = (this.room.makeAction as MakeActionType)(
      "json",
    );
    this.sendMessage = send;

    receive((data, peerId) => {
      console.log("📥 Received from", peerId, ":", data);
      if (typeof data === "string") {
        try {
          const obj = JSON.parse(data);
          this.emit("data", peerId, obj);
        } catch (error) {
          console.error("❌ Failed to parse received data:", error);
        }
      } else {
        debugger;
        console.error("❌ Received data is not a string:", data);
      }
    });
  }

  private cleanup(): void {
    this.room = null;
    this.sendMessage = null;
    this.currentRoomId = null;
    this.connectedPeers.clear();
  }

  static destroy(): void {
    TrysteroManager.instance?.leave();
    TrysteroManager.instance = null;
  }
}
