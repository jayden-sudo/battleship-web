import { EventEmitter } from "events";

// ============== DEBUG==============
const USE_MOCK_P2P = process.env.NEXT_PUBLIC_USE_MOCK_P2P === 'true';
// NEXT_PUBLIC_USE_MOCK_P2P=true npm run dev

import * as realTrystero from 'trystero/supabase';
import * as mockTrystero from './mockTrystero';

const { joinRoom, selfId } = USE_MOCK_P2P ? mockTrystero : realTrystero;
type Room = ReturnType<typeof joinRoom>;
type ActionSender<T> = (data: T, targetPeerId?: string) => Promise<void[]>;
type DataPayload = unknown;

interface TrysteroManagerEvents {
    peerJoin: (peerId: string) => void;
    peerLeave: (peerId: string) => void;
    data: (peerId: string, data: unknown) => void;
    error: (error: Error) => void;
}

export declare interface ITrysteroManager {
    on<U extends keyof TrysteroManagerEvents>(event: U, listener: TrysteroManagerEvents[U]): this;
    off<U extends keyof TrysteroManagerEvents>(event: U, listener: TrysteroManagerEvents[U]): this;
    emit<U extends keyof TrysteroManagerEvents>(event: U, ...args: Parameters<TrysteroManagerEvents[U]>): boolean;
}

export class TrysteroManager extends EventEmitter implements ITrysteroManager {
    private static instance: TrysteroManager | null = null;
    private room: Room | null = null;
    private sendMessage: ActionSender<DataPayload> | null = null;
    private currentRoomId: string | null = null;
    private connectedPeers = new Set<string>();

    private constructor() {
        super();
        if (USE_MOCK_P2P) {
            console.log('🧪 [TrysteroManager] Using MOCK P2P server');
        }
    }

    static getInstance(): TrysteroManager {
        return (TrysteroManager.instance ??= new TrysteroManager());
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

    joinRoom(roomId: string): void {
        if (!roomId?.trim()) {
            this.emit('error', new Error('Room ID cannot be empty'));
            return;
        }

        if (this.currentRoomId === roomId && this.room) {
            console.log('📍 Already in room:', roomId);
            return;
        }

        this.leave();
        console.log('🚀 Joining room:', roomId);

        try {
            this.room = joinRoom({
                appId: 'https://cmxgbjwgyaomrgoabgod.supabase.co',
                supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNteGdiandneWFvbXJnb2FiZ29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxNzY3NjAsImV4cCI6MjA4Mzc1Mjc2MH0.pFr7QiXE23-DFaTwdtK9hPVL692ot6ZkPeG-QXuv7II',
                rtcConfig: {
                    iceServers: [
                        { urls: 'stun:stun.qq.com:3478' },
                        { urls: 'stun:stun.cloudflare.com:3478' },
                        { urls: 'stun:stun.l.google.com:19302' }
                    ],
                }
            }, roomId);
            this.currentRoomId = roomId;
            this.setupRoomHandlers();
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            console.error('❌ Failed to join room:', error);
            this.emit('error', error);
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

        console.log('🔌 Leaving room:', this.currentRoomId);
        try {
            this.room.leave();
        } catch (err) {
            console.warn('⚠️ Error while leaving room:', err);
        }

        this.cleanup();
        console.log('✅ Disconnected');
    }

    async send(data: unknown, targetPeerId?: string): Promise<boolean> {
        if (!this.sendMessage) {
            console.warn('⚠️ Cannot send: not connected to a room');
            return false;
        }
        const str = JSON.stringify(data);
        try {
            if (targetPeerId) {
                await this.sendMessage(str, targetPeerId);
                console.log('📤 Sent to', targetPeerId, ':', data);
            } else {
                await this.sendMessage(str);
                console.log('📢 Broadcast:', data);
            }
            return true;
        } catch (err) {
            console.error('❌ Send failed:', err);
            return false;
        }
    }

    private setupRoomHandlers(): void {
        if (!this.room) return;

        this.room.onPeerJoin((peerId) => {
            console.log('➕ Peer joined:', peerId);
            this.connectedPeers.add(peerId);
            this.emit('peerJoin', peerId);
        });

        this.room.onPeerLeave((peerId) => {
            console.log('➖ Peer left:', peerId);
            this.connectedPeers.delete(peerId);
            this.emit('peerLeave', peerId);
        });

        const [send, receive] = this.room.makeAction<DataPayload>('json');
        this.sendMessage = send;

        receive((data, peerId) => {
            console.log('📥 Received from', peerId, ':', data);
            if (typeof data === 'string') {
                try {
                    const obj = JSON.parse(data);
                    this.emit('data', peerId, obj);
                } catch (error) {
                    console.error('❌ Failed to parse received data:', error);
                }
            } else {
                debugger;
                console.error('❌ Received data is not a string:', data);
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