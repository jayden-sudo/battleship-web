"use client";
import { TrysteroManager } from "@/utils/trysteroManager";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

export default function P2PTestPage() {
  const searchParams = useSearchParams();
  const roomId = searchParams.get("roomid");
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const managerRef = useRef<TrysteroManager | null>(null);

  useEffect(() => {
    if (!roomId) {
      console.error("[P2P Test] No roomid parameter provided");
      return;
    }

    console.log("[P2P Test] Starting test with roomId:", roomId);

    const manager = new TrysteroManager();
    managerRef.current = manager;

    const handlePeerJoin = (peerId: string) => {
      console.log("[P2P Test] Peer joined:", peerId);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      intervalRef.current = setInterval(() => {
        manager.send({
          type: "p2p_test_ping",
        });
        console.log("[P2P Test] Sent ping");
      }, 500);
    };

    const handlePeerLeave = (peerId: string) => {
      console.log("[P2P Test] Peer left:", peerId);

      // Stop broadcasting if no peers left
      if (manager.peers.length === 0) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          console.log("[P2P Test] Stopped pinging (no peers)");
        }
      }
    };

    const handleData = (peerId: string, data: unknown) => {
      console.log("[P2P Test] Received data from", peerId, ":", data);
    };

    manager.on("peerJoin", handlePeerJoin);
    manager.on("peerLeave", handlePeerLeave);
    manager.on("data", handleData);

    manager
      .joinRoom(roomId)
      .then(() => {
        console.log("[P2P Test] Successfully joined room:", roomId);
        if (manager.peers.length > 0) {
          console.log("[P2P Test] Found existing peers:", manager.peers);
          handlePeerJoin(manager.peers[0]);
        }
      })
      .catch((error) => {
        console.error("[P2P Test] Failed to join room:", error);
      });

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      manager.off("peerJoin", handlePeerJoin);
      manager.off("peerLeave", handlePeerLeave);
      manager.off("data", handleData);

      manager.leave();
    };
  }, [roomId]);

  return null;
}
