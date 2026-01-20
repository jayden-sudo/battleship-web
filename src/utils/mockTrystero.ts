/**
 * Mock Trystero
 * simulateP2PEnv.ts
 */

import { randomUUID } from "crypto";

const MOCK_SERVER_URL = "http://localhost:3999";

export const selfId =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : randomUUID();

export type DataPayload = unknown;

export interface ActionSender<T> {
  (
    data: T,
    targetPeers?: string | string[] | null,
    metadata?: unknown,
    progress?: (percent: number, peerId: string) => void,
  ): Promise<void[]>;
}

export interface ActionReceiver<T> {
  (receiver: (data: T, peerId: string, metadata?: unknown) => void): void;
}

export interface ActionProgress {
  (
    progressHandler: (
      percent: number,
      peerId: string,
      metadata?: unknown,
    ) => void,
  ): void;
}

export interface Room {
  leave: () => void;
  getPeers: () => string[];
  onPeerJoin: (callback: (peerId: string) => void) => void;
  onPeerLeave: (callback: (peerId: string) => void) => void;
  makeAction: <T extends DataPayload>(
    namespace: string,
  ) => [ActionSender<T>, ActionReceiver<T>, ActionProgress];
}

interface RoomConfig {
  appId?: string;
  [key: string]: unknown;
}

export function joinRoom(_config: RoomConfig, roomId: string): Room {
  const peerId = selfId;
  const peers = new Set<string>();

  const peerJoinCallbacks: ((peerId: string) => void)[] = [];
  const peerLeaveCallbacks: ((peerId: string) => void)[] = [];
  const messageCallbacks = new Map<
    string,
    ((data: unknown, peerId: string) => void)[]
  >();

  let eventSource: EventSource | null = null;
  let isConnected = false;

  const connectSSE = () => {
    const url = `${MOCK_SERVER_URL}/join?roomId=${encodeURIComponent(roomId)}&peerId=${encodeURIComponent(peerId)}`;

    if (typeof EventSource !== "undefined") {
      eventSource = new EventSource(url);

      eventSource.addEventListener("connected", (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        data.peers.forEach((id: string) => {
          peers.add(id);
          peerJoinCallbacks.forEach((cb) => cb(id));
        });
        isConnected = true;
        console.log(
          `[MockTrystero] Connected to room: ${roomId}, existing peers:`,
          data.peers,
        );
      });

      eventSource.addEventListener("peerJoin", (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        peers.add(data.peerId);
        peerJoinCallbacks.forEach((cb) => cb(data.peerId));
      });

      eventSource.addEventListener("peerLeave", (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        peers.delete(data.peerId);
        peerLeaveCallbacks.forEach((cb) => cb(data.peerId));
      });

      eventSource.addEventListener("message", (e) => {
        const { fromPeerId, data } = JSON.parse((e as MessageEvent).data);
        const actionName = data?.action || "json";
        const callbacks = messageCallbacks.get(actionName);
        if (callbacks) {
          callbacks.forEach((cb) => cb(data?.payload, fromPeerId));
        }
      });

      eventSource.onerror = (err) => {
        console.error("[MockTrystero] SSE error:", err);
      };
    } else {
      import("http").then((http) => {
        const urlObj = new URL(url);
        const req = http.request(
          {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: "GET",
          },
          (res) => {
            let buffer = "";
            res.on("data", (chunk) => {
              buffer += chunk.toString();
              const blocks = buffer.split("\n\n");
              buffer = blocks.pop() || "";

              for (const block of blocks) {
                if (!block.trim()) continue;
                const eventMatch = block.match(/^event: (.+)$/m);
                const dataMatch = block.match(/^data: (.+)$/m);

                if (eventMatch && dataMatch) {
                  const event = eventMatch[1];
                  const data = JSON.parse(dataMatch[1]);

                  if (event === "connected") {
                    data.peers.forEach((id: string) => {
                      peers.add(id);
                      peerJoinCallbacks.forEach((cb) => cb(id));
                    });
                    isConnected = true;
                    console.log(`[MockTrystero] Connected to room: ${roomId}`);
                  } else if (event === "peerJoin") {
                    peers.add(data.peerId);
                    peerJoinCallbacks.forEach((cb) => cb(data.peerId));
                  } else if (event === "peerLeave") {
                    peers.delete(data.peerId);
                    peerLeaveCallbacks.forEach((cb) => cb(data.peerId));
                  } else if (event === "message") {
                    const actionName = data.data?.action || "json";
                    const callbacks = messageCallbacks.get(actionName);
                    if (callbacks) {
                      callbacks.forEach((cb) =>
                        cb(data.data?.payload, data.fromPeerId),
                      );
                    }
                  }
                }
              }
            });
          },
        );
        req.on("error", (err) => {
          console.error("[MockTrystero] Connection error:", err);
        });
        req.end();
      });
    }
  };

  connectSSE();

  const room: Room = {
    leave() {
      eventSource?.close();
      isConnected = false;
      console.log(`[MockTrystero] Left room: ${roomId}`);
    },

    getPeers() {
      return [...peers];
    },

    onPeerJoin(callback) {
      peerJoinCallbacks.push(callback);
      if (isConnected) {
        peers.forEach((id) => callback(id));
      }
    },

    onPeerLeave(callback) {
      peerLeaveCallbacks.push(callback);
    },

    makeAction<T extends DataPayload>(
      actionName: string,
    ): [ActionSender<T>, ActionReceiver<T>, ActionProgress] {
      const send: ActionSender<T> = async (
        data: T,
        targetPeers?: string | string[] | null,
        _metadata?: unknown,
        _progressCallback?: (percent: number, peerId: string) => void,
      ): Promise<void[]> => {
        const targetPeerId = Array.isArray(targetPeers)
          ? targetPeers[0]
          : targetPeers || undefined;

        const response = await fetch(`${MOCK_SERVER_URL}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            fromPeerId: peerId,
            toPeerId: targetPeerId,
            data: { action: actionName, payload: data },
          }),
        });

        if (!response.ok) {
          throw new Error(`Send failed: ${response.statusText}`);
        }

        return [];
      };

      const receive: ActionReceiver<T> = (
        receiver: (data: T, peerId: string, metadata?: unknown) => void,
      ) => {
        if (!messageCallbacks.has(actionName)) {
          messageCallbacks.set(actionName, []);
        }
        messageCallbacks
          .get(actionName)!
          .push((data: unknown, peerId: string) => {
            receiver(data as T, peerId);
          });
      };

      const progress: ActionProgress = (
        _progressHandler: (
          percent: number,
          peerId: string,
          metadata?: unknown,
        ) => void,
      ) => {
        // Mock implementation - no progress tracking needed
      };

      return [send, receive, progress];
    },
  };

  return room;
}
