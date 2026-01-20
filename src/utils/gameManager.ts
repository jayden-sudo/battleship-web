"use client";

import {
  GameData,
  P2PMessage,
  Action,
  NextTurnState,
  ROUND_TIME_LIMIT,
  REVEAL_RANDOMNESS_LIMIT,
  DEFAULT_GRID_SIZE,
  ActionData_SignCreatorSignature,
  ActionData_Join,
  ActionData_SelfReport,
  ActionData_Shot,
  ShotResult,
  ActionData_Report,
  ActionData_EnemySurrender,
  ActionData_GameEnd,
  ActionData_ReportCheating,
  ActionData_ShootAt,
  PosStatus,
  HashChainData,
  ActionData_Actor,
  PosShipStatus,
} from "./interfaces";
import { ethers, SigningKey } from "ethers";
import { GameBoard } from "./gameBoard";
import { HashChain } from "./hashChain";
import { Contract } from "./contract";
import { EventLogMonitor } from "./eventLogMonitor";
import { MessageQueue } from "./messageQueue";
import { ProofData, UltraHonkBackend } from "@aztec/bb.js";
import { CompiledCircuit, InputMap, Noir } from "@noir-lang/noir_js";
import * as compiledCircuit from "./process_shot.json";
import { getPublicRpcUrl } from "@/config/wagmi";
import { TrysteroManager } from "./trysteroManager";
import { PartykitManager } from "./partykitManager";
import { Config } from "@wagmi/core";
import { RuntimeState } from "./runtimeState";

export interface GameManagerCallbacks {
  onGameDataUpdate?: (gameData: GameData) => void;
  onMyBoardUpdate?: () => void;
  onEnemyBoardUpdate?: () => void;
  onGameStateChange?: (isInGame: boolean) => void;
  onShootEnabled?: (enabled: boolean) => void;
  onLoadingChange?: (loading: boolean, message: string) => void;
  onGameEnd?: (isWinner: boolean | null) => void;
  onGameViewStatusChange?: (
    status: string,
    isMyTurn: boolean,
    isTx: boolean,
  ) => void;
  onMessage?: (message: string) => void;
  onError?: (error: string) => void;
}

export interface SavedGameState {
  gameId: string;
  myAddress: string;
  isCreator: boolean;
  isJoiner: boolean;
  sessionKey: string;
  boardSalt: string;
  randomnessSalt: string;
  ships: number[][]; // [row, col, orientation, size]
  pos: PosShipStatus[];
}

const blockTime = 300;

export const USE_P2P = process.env.NEXT_PUBLIC_USE_P2P === "true";
export const USE_PARTYKIT = process.env.NEXT_PUBLIC_USE_PARTYKIT === "true";

export class GameManager {
  private provider: ethers.BrowserProvider;
  private signer: ethers.JsonRpcSigner;
  // private walletAddress: string
  private contract: Contract;
  private callbacks: GameManagerCallbacks;

  // Game data
  private currentGameData: GameData | null = null;
  private sessionKey: SigningKey | null = null;

  // Queues
  private actionQueue: MessageQueue<Action>;
  private p2pQueue: MessageQueue<P2PMessage>;
  private contractLogQueue: MessageQueue<
    number | ethers.LogDescription
  > | null = null;
  // private hashChain: HashChain | null = null

  // Monitors
  private logMonitor: EventLogMonitor | null = null;
  private gameLoopRunning: boolean = false;
  private lastGameDataUpdate: number = 0;

  private self_submit_win_poof_handler: NodeJS.Timeout | undefined = undefined;

  private Backend;
  private noir: Noir;

  private autoShoot = false;

  private trysteroManager: TrysteroManager | undefined = undefined;
  private partykitManager: PartykitManager | undefined = undefined;

  public runtimeState: RuntimeState;

  constructor(
    provider: ethers.BrowserProvider,
    signer: ethers.JsonRpcSigner,
    walletAddress: string,
    gridMe: GameBoard,
    gridEnemy: GameBoard,
    // EIP-5792 atomic batch support
    private wagmiConfig?: Config,
    private supportsAtomicBatch: boolean = false,
    callbacks: GameManagerCallbacks = {},
  ) {
    if (USE_P2P && USE_PARTYKIT) {
      console.log(
        process.env.NEXT_PUBLIC_USE_P2P,
        process.env.NEXT_PUBLIC_USE_PARTYKIT,
      );
      debugger;
      throw new Error("Cannot use both P2P and PartyKit at the same time.");
    }
    if (!USE_P2P && !USE_PARTYKIT) {
      console.log(
        process.env.NEXT_PUBLIC_USE_P2P,
        process.env.NEXT_PUBLIC_USE_PARTYKIT,
      );
      debugger;
      throw new Error("Either P2P or PartyKit must be enabled.");
    }

    this.provider = provider;
    this.signer = signer;
    this.contract = new Contract(
      provider,
      signer,
      wagmiConfig,
      supportsAtomicBatch,
    );
    this.callbacks = callbacks;

    this.actionQueue = new MessageQueue<Action>();
    this.p2pQueue = new MessageQueue<P2PMessage>();

    const c = compiledCircuit as CompiledCircuit;
    const bytecode = c.bytecode;
    this.Backend = new UltraHonkBackend(bytecode, { threads: 4 });
    this.noir = new Noir(c);

    // Generate session key
    const _wallet = ethers.Wallet.createRandom();
    const sessionKeyAddress = _wallet.address;
    this.sessionKey = new SigningKey(_wallet.privateKey);
    if (USE_P2P) {
      this.trysteroManager = new TrysteroManager();
    }
    if (USE_PARTYKIT) {
      this.partykitManager = PartykitManager.getInstance();
    }

    // Generate board commitment
    const boardSalt =
      "0x" +
      Array.from(crypto.getRandomValues(new Uint8Array(30)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    // Generate randomness commitment
    const randomnessSalt = new ethers.AbiCoder().encode(
      ["bytes32"],
      [
        "0x" +
          Array.from(crypto.getRandomValues(new Uint8Array(32)))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
      ],
    );

    this.runtimeState = new RuntimeState(
      walletAddress,
      gridMe,
      gridEnemy, //  new GameBoard(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES),
      false,
      false,
      sessionKeyAddress,
      _wallet.privateKey,
      boardSalt,
      randomnessSalt,
      null,
    );
  }

  public destroy() {
    this.runtimeState.destroy();
    this.gameLoopRunning = false;

    if (USE_P2P && this.trysteroManager) {
      this.trysteroManager.leave();
    }
    if (USE_PARTYKIT && this.partykitManager) {
      this.partykitManager.leave();
    }

    if (this._timer_request_creator_sign !== undefined) {
      clearTimeout(this._timer_request_creator_sign);
      this._timer_request_creator_sign = undefined;
    }
    if (this.LobbyAliveTimer !== undefined) {
      clearInterval(this.LobbyAliveTimer);
      this.LobbyAliveTimer = undefined;
    }
    this.logMonitor?.pause();

    if (this.currentGameData) {
      GameManager.clearState(
        this.currentGameData.gameId,
        this.runtimeState.walletAddress,
      );
    }
    this.callbacks.onGameStateChange?.(false);

    this.log("Game stopped");
  }

  // #region Persistence
  public saveState() {
    if (!this.currentGameData) return;

    const ships = this.runtimeState.gridMe.shipsMutable.map((ship) => {
      // Need to store enough info to reconstruct the ship
      // ship is number[] of indices.
      // We can just store the raw indices or reconstruct logic.
      // GameBoard.ships is number[][]. Each ship is an array of cell indices.
      // But to reconstruct cleanly, we usually want (row, col, orientation, size).
      // However, GameBoard.placeship just takes indices.
      // Let's just save the ships array as is, it's array of arrays of numbers.
      return ship;
    });

    // But GameBoard.ships structure in `gameBoard.ts`:
    // public ships: number[][] = [];
    // It stores the indices.
    // Wait, `ships` property in `SavedGameState` defined as `number[][]`.

    const state: SavedGameState = {
      gameId: this.currentGameData.gameId,
      myAddress: this.runtimeState.walletAddress,
      isCreator: this.runtimeState.isCreator,
      isJoiner: this.runtimeState.isJoiner,
      sessionKey: this.sessionKey ? this.sessionKey.privateKey : "",
      boardSalt: this.runtimeState.boardSalt,
      randomnessSalt: this.runtimeState.randomnessSalt,
      ships: this.runtimeState.gridMe.shipsMutable,
      pos: this.runtimeState.gridMe.posMutable,
    };

    const key = `battleship_game_state_${this.currentGameData.gameId}_${this.runtimeState.walletAddress}`;
    localStorage.setItem(key, JSON.stringify(state));
    console.log("[GameManager] State saved", key);
  }

  public static loadState(
    gameId: string,
    walletAddress: string,
  ): SavedGameState | null {
    const key = `battleship_game_state_${gameId}_${walletAddress}`;
    const data = localStorage.getItem(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as SavedGameState;
    } catch (e) {
      console.error("Failed to parse saved game state", e);
      return null;
    }
  }

  public static clearState(gameId: string, walletAddress: string) {
    const key = `battleship_game_state_${gameId}_${walletAddress}`;
    localStorage.removeItem(key);
    console.log("[GameManager] State cleared", key);
  }

  public restoreState(state: SavedGameState) {
    // Restore flags
    this.runtimeState.isCreator = state.isCreator;
    this.runtimeState.isJoiner = state.isJoiner;
    this.runtimeState.joinStatus = "JOINED"; // Assume joined if restoring

    // Restore secrets
    this.runtimeState.boardSalt = state.boardSalt;
    this.runtimeState.randomnessSalt = state.randomnessSalt;

    if (state.sessionKey) {
      this.sessionKey = new SigningKey(state.sessionKey);
      this.runtimeState.sessionKeyAddress = new ethers.Wallet(
        state.sessionKey,
      ).address;
    }

    // Note: Grid should be restored by caller (Page) before creating GameManager
    // or passed in constructor. But we can verify here.
  }
  // #endregion

  private log(message: string) {
    console.log(`[GameManager] ${message}`);
    this.callbacks.onMessage?.(message);
  }

  private error(message: string) {
    console.error(`[GameManager] ${message}`);
    this.callbacks.onError?.(message);
  }

  // Helper method to notify my board update
  private notifyMyBoardUpdate() {
    // const newBoard = new GameBoard(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES)

    // newBoard.pos = [...this.runtimeState.gridMe.pos]
    // newBoard.ships = this.runtimeState.gridMe.ships.map(s => [...s])
    // this.callbacks.onMyBoardUpdate?.(newBoard)
    this.callbacks.onMyBoardUpdate?.();
  }

  // Helper method to notify enemy board update
  private notifyEnemyBoardUpdate() {
    // const newBoard = new GameBoard(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES)
    // newBoard.pos = [...this.runtimeState.gridEnemy.pos]
    // newBoard.ships = this.runtimeState.gridEnemy.ships.map(s => [...s])
    // this.callbacks.onEnemyBoardUpdate?.(newBoard)
    this.callbacks.onEnemyBoardUpdate?.();
  }

  private updateHashChain(status: HashChainData) {
    if (this.runtimeState.hashChain === null) {
      return;
    }
    if (
      this.runtimeState.hashChain.hashChainList.length === 1 &&
      this.runtimeState.hashChain.hashChainList[0].status === "None"
    ) {
      this.runtimeState.hashChain.setStatus(0, status.status);
    } else {
      this.runtimeState.hashChain.push(status);
    }
  }

  private updateGameViewStatus(action: Action) {
    let isMyTurn: boolean | null = null;
    let friendlyStatus = "";
    let isTx = false;
    switch (action.type) {
      case "GAME_CLOSED":
        isMyTurn = true;
        friendlyStatus = "Game Over";
        break;
      case "REVEAL_SALT":
        {
          const _data = action.data as ActionData_Actor;
          if (_data.actorIsCreator === this.runtimeState.isCreator) {
            isMyTurn = true;
            friendlyStatus = "Revealing Randomness";
            isTx = true;
          } else {
            isMyTurn = false;
            friendlyStatus = "Opponent Revealing...";
          }
        }
        break;
      case "REQUEST_CREATOR_SIGNATURE":
        isMyTurn = true;
        friendlyStatus = "Connecting...";
        break;
      case "SIGN_CREATOR_SIGNATURE":
        isMyTurn = false;
        friendlyStatus = "Waiting for Joiner";
        break;
      case "JOIN":
        isMyTurn = true;
        friendlyStatus = "Confirming Join...";
        isTx = true;
        break;
      case "WAITING_FOR_SHOOT":
        const _data = action.data as ActionData_Actor;
        if (_data.actorIsCreator === this.runtimeState.isCreator) {
          isMyTurn = true;
          friendlyStatus = "Your Turn";
        } else {
          isMyTurn = false;
          friendlyStatus = "Opponent's Turn";
        }
        break;
      case "SHOT":
        isMyTurn = false;
        friendlyStatus = "Opponent Proving ZKP...";
        break;
      case "REPORT":
        isMyTurn = true;
        friendlyStatus = "Your Turn";
        break;
      case "SELF_SHOT":
        // isMyTurn=  ;
        // friendlyStatus = '';
        break;
      case "ENEMY_SHOT":
        isMyTurn = true;
        friendlyStatus = "Generating ZK proof";
        break;
      case "SELF_REPORT":
        // isMyTurn=  ;
        // friendlyStatus = '';
        break;
      case "ENEMY_REPORT":
        isMyTurn = true;
        friendlyStatus = "Opponent's Turn";
        break;
      case "SELF_SURRENDER":
        isMyTurn = true;
        friendlyStatus = "You Lost";
        break;
      case "ENEMY_SURRENDER":
        isMyTurn = true;
        friendlyStatus = "You Won";
        isTx = true;
        break;
      case "GAME_END":
        isMyTurn = true;
        friendlyStatus = "Game Over";
        break;
      case "TRY_OPPONENT_LEAVE":
        // isMyTurn=  ;
        // friendlyStatus = '';
        break;
      case "UPDATE_GAME_STATUS":
        isMyTurn = true;
        friendlyStatus = "Syncing State...";
        isTx = true;
        break;
      case "SELF_SUBMIT_WIN_PROOF":
        isMyTurn = true;
        friendlyStatus = "Submitting Win...";
        isTx = true;
        break;
      case "REPORT_CHEATING":
        isMyTurn = true;
        friendlyStatus = "Checking Cheating";
        isTx = true;
        break;
      default:
        debugger;
        break;
    }
    if (isMyTurn !== null) {
      this.callbacks.onGameViewStatusChange?.(friendlyStatus, isMyTurn, isTx);
    }
  }

  public enableAutoShoot(enable: boolean): void {
    if (enable && !this.autoShoot) {
      if (this.waitingForUserShoot === true) {
        this._autoShoot();
      }
    }
    this.autoShoot = enable;
  }
  public getAutoShoot(): boolean {
    return this.autoShoot;
  }

  private _autoShoot() {
    const fireAt = this.runtimeState.gridEnemy.enemyRandomShoot();
    console.log(
      `I am ${this.runtimeState.isJoiner ? "joiner" : "creator"}, shoot at:${fireAt}`,
    );
    this.actionQueue.put({
      type: "SHOT",
      data: {
        fireAt: fireAt,
      },
    });
  }

  waitingForUserShoot = false;
  public enableShoot() {
    this.waitingForUserShoot = true;
    this.callbacks.onShootEnabled?.(true);
  }

  public shoot(position: number) {
    if (this.waitingForUserShoot !== true) {
      return false;
    }
    // check position
    if (position < 0 || position >= this.runtimeState.gridEnemy.pos.length) {
      return false;
    }
    const a = this.runtimeState.gridEnemy.pos[position];
    if (a.posStatus !== PosStatus.Unknown) {
      return false;
    }
    this.waitingForUserShoot = false;
    this.callbacks.onShootEnabled?.(false);
    this.actionQueue.put({
      type: "SHOT",
      data: {
        fireAt: position,
      },
    });
  }

  initCreatorGameSalt() {
    // // Generate board commitment
    // this.runtimeState.boardSalt = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(30)))
    //     .map(b => b.toString(16).padStart(2, '0')).join('')
    // // Generate randomness commitment
    // this.runtimeState.randomnessSalt = new ethers.AbiCoder().encode(
    //     ['bytes32'],
    //     ['0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
    //         .map(b => b.toString(16).padStart(2, '0')).join('')]
    // )
  }

  async preCreateGame(stake: bigint, getGameId: boolean): Promise<string> {
    this.runtimeState.isCreator = true;
    this.runtimeState.isJoiner = false;
    this.runtimeState.gotRandomnessRevealed = false;

    // Validate that board has been initialized (should be done by Random Generate Board button)
    if (!this.runtimeState.gridMe.isInitialized()) {
      throw new Error(
        "Board not initialized. Please generate a board first using the Random Generate Board button.",
      );
    }
    const boardCommitment = await this.runtimeState.gridMe.getPoseidonHash(
      BigInt(this.runtimeState.boardSalt),
    );

    const randomnessCommitment = ethers.keccak256(
      this.runtimeState.randomnessSalt,
    );
    if (getGameId === true) {
      // Get user balance
      const userBalance = await this.contract.getUserBalance(
        this.runtimeState.walletAddress,
      );
      return await this.contract.calculateGameId(
        randomnessCommitment,
        boardCommitment,
        stake,
        this.runtimeState.sessionKeyAddress,
        userBalance,
      );
    } else {
      return "";
    }
  }

  LobbyAliveTimer: NodeJS.Timeout | undefined = undefined;

  // Create game
  async createGame(
    stake: bigint,
    gameId: string,
  ): Promise<"networkerror" | "error" | "success"> {
    try {
      await this.preCreateGame(stake, false);

      if (this.LobbyAliveTimer !== undefined) {
        clearInterval(this.LobbyAliveTimer);
        this.LobbyAliveTimer = undefined;
      }

      if (USE_P2P) {
        this.callbacks.onLoadingChange?.(true, "P2P network connecting...");
      }
      if (USE_PARTYKIT) {
        this.callbacks.onLoadingChange?.(true, "Network connecting...");
      }
      let netCheckPass = false;
      try {
        if (USE_P2P) {
          await this.trysteroManager!.joinRoom(gameId);
        }
        if (USE_PARTYKIT) {
          await this.partykitManager!.joinRoom(gameId);
        }
        this.p2pQueue.put({ type: "connect", data: undefined });
        if (USE_P2P) {
          this.trysteroManager!.on("data", (peerId, data) => {
            // #TODO Security check of peerId
            if (data.type === "p2p_test_ping") {
              netCheckPass = true;
            } else {
              if (data.type !== "connect") {
                this.p2pQueue.put(data as P2PMessage);
              }
            }
          });
        }
        if (USE_PARTYKIT) {
          this.partykitManager!.once("roomInfo", (userCount) => {
            netCheckPass = true;
          });
          this.partykitManager!.on("data", (from, data) => {
            // #TODO Security check of peerId
            if (data.type !== "connect") {
              this.p2pQueue.put(data as P2PMessage);
            }
          });
        }

        for (let i = 0; i < 2 * 40; i++) {
          if (netCheckPass) {
            break;
          }
          await this.sleep(500);
        }
      } finally {
        this.callbacks.onLoadingChange?.(false, "");
      }
      if (netCheckPass === false) {
        this.error(
          "network connection failed. Please check your network or try again later.",
        );
        if (USE_P2P) {
          // faild,alert
          this.trysteroManager!.leave();
        }
        if (USE_PARTYKIT) {
          this.partykitManager!.leave();
        }

        return "networkerror";
      }
      const boardCommitment = await this.runtimeState.gridMe.getPoseidonHash(
        BigInt(this.runtimeState.boardSalt),
      );
      const randomnessCommitment = ethers.keccak256(
        this.runtimeState.randomnessSalt,
      );
      // Get user balance
      const userBalance = await this.contract.getUserBalance(
        this.runtimeState.walletAddress,
      );
      // Create game on contract
      this.callbacks.onLoadingChange?.(true, "Creating game on blockchain...");
      try {
        this.currentGameData = await this.contract.createGame(
          randomnessCommitment,
          boardCommitment,
          stake,
          this.runtimeState.sessionKeyAddress,
          userBalance,
        );
        if (this.currentGameData.gameId !== gameId) {
          throw new Error("Generated gameId mismatch!");
        }

        this.LobbyAliveTimer = setInterval(async () => {
          await this.partykitManager!.registerGame(gameId);
        }, 2000);
      } finally {
        this.callbacks.onLoadingChange?.(false, "");
      }

      console.log("Game ID:", this.currentGameData.gameId);
      this.callbacks.onGameDataUpdate?.(this.currentGameData);
      this.callbacks.onGameStateChange?.(true);

      // Save state immediately after creating
      this.saveState();

      // Start game loop
      await this.startGameLoop();
      return "success";
    } catch (error) {
      this.error(`Failed to create game: ${(error as Error).message}`);
      return "error";
    }
  }

  // Join game
  async joinGame(
    gameData: GameData,
  ): Promise<"networkerror" | "error" | "success"> {
    try {
      this.runtimeState.isCreator = false;
      this.runtimeState.isJoiner = true;
      this.runtimeState.joinStatus = "NOT_JOINED";
      this.currentGameData = gameData;
      this.runtimeState.gotRandomnessRevealed = false;

      // Validate that board has been initialized (should be done by Random Generate Board button)
      if (!this.runtimeState.gridMe.isInitialized()) {
        throw new Error(
          "Board not initialized. Please generate a board first using the Random Generate Board button.",
        );
      }

      // Generate board commitment
      this.runtimeState.boardSalt =
        "0x" +
        Array.from(crypto.getRandomValues(new Uint8Array(30)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

      let netCheckPass: boolean | undefined = undefined;
      if (USE_P2P) {
        await this.trysteroManager!.joinRoom(this.currentGameData.gameId);
        this.p2pQueue.put({ type: "connect", data: undefined });
        this.trysteroManager!.on("data", (peerId, data) => {
          // #TODO Security check of peerId
          if (data.type !== "connect") {
            this.p2pQueue.put(data as P2PMessage);
          }
        });

        this.callbacks.onLoadingChange?.(true, "Waiting for P2P connection...");
        try {
          for (let i = 0; i < 60; i++) {
            this.sleep(500);
            const p = this.trysteroManager!.getPeers();
            if (Object.keys(p).length > 0) {
              netCheckPass = true;
              break;
            }
          }
        } finally {
          this.callbacks.onLoadingChange?.(false, "");
        }
      }
      if (USE_PARTYKIT) {
        await this.partykitManager!.joinRoom(this.currentGameData.gameId);
        this.partykitManager!.once("roomInfo", (userCount) => {
          netCheckPass = userCount >= 2;
        });
        this.partykitManager!.on("data", (from, data) => {
          // #TODO Security check of peerId
          if (data.type !== "connect") {
            this.p2pQueue.put(data as P2PMessage);
          }
        });

        this.callbacks.onLoadingChange?.(true, "Waiting for connection...");
        try {
          for (let i = 0; i < 10; i++) {
            await this.sleep(500);
            if (netCheckPass !== undefined) {
              break;
            }
          }
        } finally {
          this.callbacks.onLoadingChange?.(false, "");
        }
        if (netCheckPass === true) {
          this.p2pQueue.put({ type: "connect", data: undefined });
        }
      }

      if (netCheckPass !== true) {
        return "networkerror";
      }

      this.callbacks.onGameDataUpdate?.(this.currentGameData);
      this.callbacks.onGameStateChange?.(true);

      // Start game loop
      await this.startGameLoop();

      return "success";
    } catch (error) {
      this.error(`Failed to join game: ${(error as Error).message}`);
      throw error;
    }
  }

  // Resume game
  async resumeGame(
    gameData: GameData,
  ): Promise<"networkerror" | "error" | "success"> {
    try {
      this.currentGameData = gameData;

      // Re-establish connection
      if (USE_P2P) {
        this.callbacks.onLoadingChange?.(true, "Resuming P2P connection...");
      }
      if (USE_PARTYKIT) {
        this.callbacks.onLoadingChange?.(true, "Resuming connection...");
      }

      let netCheckPass: boolean | undefined = undefined;

      if (USE_P2P) {
        await this.trysteroManager!.joinRoom(this.currentGameData.gameId);
        this.p2pQueue.put({ type: "connect", data: undefined });
        this.trysteroManager!.on("data", (peerId, data) => {
          if (data.type !== "connect") {
            this.p2pQueue.put(data as P2PMessage);
          }
        });
        // Relaxed check for resumption
        netCheckPass = true;
        this.callbacks.onLoadingChange?.(false, "");
      }
      if (USE_PARTYKIT) {
        await this.partykitManager!.joinRoom(this.currentGameData.gameId);

        this.partykitManager!.on("data", (from, data) => {
          if (data.type !== "connect") {
            this.p2pQueue.put(data as P2PMessage);
          }
        });
        this.partykitManager!.registerGame(this.currentGameData.gameId);
        netCheckPass = true;
        this.callbacks.onLoadingChange?.(false, "");
      }

      if (netCheckPass !== true) {
        return "networkerror";
      }

      this.callbacks.onGameDataUpdate?.(this.currentGameData);
      this.callbacks.onGameStateChange?.(true);

      // Start game loop
      await this.startGameLoop();

      return "success";
    } catch (error) {
      this.error(`Failed to resume game: ${(error as Error).message}`);
      throw error;
    }
  }

  // Start game loop (player.ts run function)
  private async startGameLoop() {
    if (this.gameLoopRunning || !this.currentGameData) return;

    this.gameLoopRunning = true;

    // Initialize hash chain
    this.runtimeState.hashChain = new HashChain({
      hash: this.currentGameData.gameId,
      status: "None",
      value: 0,
      proof: undefined,
      signature: "",
      hasInContract: true,
    });

    // Start event log monitor
    const contractAddress = Contract.getZKBattleshipAddress();
    const contractABI = Contract.getZKBattleshipABI();

    // Get current chain ID from the wallet provider
    const network = await this.provider.getNetwork();
    const chainId = Number(network.chainId);

    // Use public RPC provider for event monitoring (no rate limiting)
    const publicRpcUrl = getPublicRpcUrl(chainId);
    if (!publicRpcUrl) {
      throw new Error(`Unsupported network: chainId ${chainId}`);
    }

    this.log(`Using public RPC for event monitoring: ${publicRpcUrl}`);
    const publicProvider = new ethers.JsonRpcProvider(publicRpcUrl);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.logMonitor = new EventLogMonitor(
      contractAddress,
      contractABI,
      2000,
      publicProvider as any,
    );
    this.contractLogQueue = await this.logMonitor.start();

    this.log("Game loop started");

    // Main game loop
    this.runGameLoop();
  }

  private async runGameLoop() {
    while (this.gameLoopRunning && this.currentGameData) {
      await this.sleep(10);

      // Update game data from contract
      await this.fetchGameData(false);

      // Process actions
      await this.processActions();

      // Process contract events
      await this.processContractEvents();

      // Process P2P/Partykit messages
      await this.processPeerMessages();

      // Save state periodically
      this.saveState();
    }
  }

  private async fetchGameData(force: boolean) {
    if (!this.currentGameData) return;

    const now = Date.now();
    if (force || now - this.lastGameDataUpdate > 5000) {
      for (let _i = 0; _i < 5; _i++) {
        try {
          this.currentGameData = await this.contract.getGameData(
            this.currentGameData.gameId,
          );
          this.lastGameDataUpdate = now;
          this.callbacks.onGameDataUpdate?.(this.currentGameData);
          // Check for timeouts and cheating
          await this.gameMonitor();
          break;
        } catch (error) {
          console.error("getGameData failed", error);
        }
        this.sleep(1000);
      }
    }
  }

  private async gameMonitor() {
    if (!this.currentGameData || !this.runtimeState.hashChain) return;

    const now = Date.now() / 1000;
    const lastActiveTimestamp = Number(
      this.currentGameData.lastActiveTimestamp,
    );

    // Check for timeout conditions
    let tryOpponentLeave = false;
    let updateGameStatus = false;

    if (this.runtimeState.isCreator) {
      if (
        this.currentGameData.nextTurnState === NextTurnState.CreatorFire ||
        this.currentGameData.nextTurnState === NextTurnState.CreatorReport
      ) {
        if (now - (lastActiveTimestamp - 10) >= ROUND_TIME_LIMIT) {
          updateGameStatus = true;
        }
      } else if (
        this.currentGameData.nextTurnState === NextTurnState.JoinerFire ||
        this.currentGameData.nextTurnState === NextTurnState.JoinerReport
      ) {
        if (now - lastActiveTimestamp >= ROUND_TIME_LIMIT) {
          tryOpponentLeave = true;
        }
      }
    } else {
      if (
        this.currentGameData.nextTurnState === NextTurnState.RevealRandomness
      ) {
        if (now - lastActiveTimestamp >= REVEAL_RANDOMNESS_LIMIT) {
          tryOpponentLeave = true;
        }
      }
      if (
        this.currentGameData.nextTurnState === NextTurnState.JoinerFire ||
        this.currentGameData.nextTurnState === NextTurnState.JoinerReport
      ) {
        if (now - (lastActiveTimestamp - 10) >= ROUND_TIME_LIMIT) {
          updateGameStatus = true;
        }
      } else if (
        this.currentGameData.nextTurnState === NextTurnState.CreatorFire ||
        this.currentGameData.nextTurnState === NextTurnState.CreatorReport
      ) {
        if (now - lastActiveTimestamp >= ROUND_TIME_LIMIT) {
          tryOpponentLeave = true;
        }
      }
    }

    if (tryOpponentLeave) {
      this.actionQueue.put({ type: "TRY_OPPONENT_LEAVE", data: {} });
    }
    if (updateGameStatus) {
      this.actionQueue.put({ type: "UPDATE_GAME_STATUS", data: {} });
    }
  }
  private async processContractEvents() {
    if (!this.contractLogQueue) return;
    let eventLog = await this.contractLogQueue.get();
    while (eventLog !== undefined) {
      if (typeof eventLog === "number") {
        await this.fetchGameData(true);
        this.runtimeState.lastBlock = eventLog;
      } else {
        if (
          (eventLog.args[0] as string).toLowerCase() !==
          this.currentGameData?.gameId.toLowerCase()
        ) {
          continue;
        }
        console.log(`Processing contract event: ${eventLog.name}`);
        switch (eventLog.name) {
          case "GameCreated":
            break;
          case "GameJoined":
            this.actionQueue.put({
              type: "REVEAL_SALT",
              data: {
                actorIsCreator: true,
              },
            });
            if (this.runtimeState.isCreator) {
              if (USE_PARTYKIT) {
                if (this.LobbyAliveTimer !== undefined) {
                  clearInterval(this.LobbyAliveTimer);
                  this.LobbyAliveTimer = undefined;
                }
              }
            }
            break;
          case "RandomnessRevealed":
            {
              let actorIsCreator = true;
              if (
                (eventLog.args[1] as string).toLowerCase() ===
                this.runtimeState.walletAddress.toLowerCase()
              ) {
                if (this.runtimeState.isCreator) actorIsCreator = true;
                else actorIsCreator = false;
              } else {
                if (this.runtimeState.isCreator) actorIsCreator = false;
                else actorIsCreator = true;
              }
              this.actionQueue.put({
                type: "WAITING_FOR_SHOOT",
                data: {
                  actorIsCreator: actorIsCreator,
                },
              });
              if (
                this.runtimeState.hashChain!.hashChainList.length === 1 &&
                this.runtimeState.hashChain!.hashChainList[0].status === "None"
              ) {
                this.updateHashChain({
                  status: actorIsCreator ? "CreatorFire" : "JoinerFire",
                  value: 0,
                  proof: undefined,
                  signature: "",
                  hasInContract: false,
                });
              }
              this.runtimeState.gotRandomnessRevealed = true;
            }
            break;
          case "GameClosed":
            this.actionQueue.put({
              type: "GAME_CLOSED",
              data: {},
            });
            // Clear state on game close
            GameManager.clearState(
              this.currentGameData!.gameId,
              this.runtimeState.walletAddress,
            );
            break;
          case "ShotFired":
            /*
                         event ShotFired(
                            bytes32 indexed gameId,
                            address indexed attacker,
                            uint8 firePosition,
                            bytes32 gameStatusHash
                        );
                        */
            {
              const attacker = eventLog.args[1].toLowerCase();
              const attackerIsMe =
                attacker === this.runtimeState.walletAddress.toLowerCase();

              const _data: ActionData_Shot = {
                mergeEnd: 0,
                fromContract: true,
                statusHash: eventLog.args[3],
                position: Number(eventLog.args[2]),
                signature: "",
              };
              this.actionQueue.put({
                type: attackerIsMe ? "SELF_SHOT" : "ENEMY_SHOT",
                data: _data,
              });
            }
            break;
          case "ResultReported":
            /*
                        event ResultReported(
                            bytes32 indexed gameId,
                            address indexed defender,
                            uint8 firePosition,
                            ShotResult result,
                            bytes32 gameStatusHash
                        );
                        */
            {
              const defender = eventLog.args[1].toLowerCase();
              const defenderIsMe =
                defender === this.runtimeState.walletAddress.toLowerCase();

              const result: ShotResult = {
                shotStatus: Number(eventLog.args[3][0]),
                sunkHeadPosition: Number(eventLog.args[3][1]),
                sunkEndPosition: Number(eventLog.args[3][2]),
              };
              const _data: ActionData_Report = {
                mergeEnd: 0,
                fromContract: true,
                statusHash: eventLog.args[4],
                position: Number(eventLog.args[2]),
                shotResult: result,
                signature: "",
                poof: "",
              };
              this.actionQueue.put({
                type: defenderIsMe ? "SELF_REPORT" : "ENEMY_REPORT",
                data: _data,
              });
            }
            break;
          case "GameEnded":
            // event GameEnded(bytes32 indexed gameId, address indexed winner);
            const winner = eventLog.args[1].toLowerCase();
            this.actionQueue.put({
              type: "GAME_END",
              data: {
                winner: winner,
              },
            });
            // Clear state on game end
            GameManager.clearState(
              this.currentGameData!.gameId,
              this.runtimeState.walletAddress,
            );
            break;
          default:
            console.log(eventLog);
            debugger;
            break;
        }
      }
      await this.sleep(1);
      eventLog = await this.contractLogQueue.get();
    }
  }

  private async processPeerMessages() {
    const p2pMsg = await this.p2pQueue.get();
    if (!p2pMsg || !this.currentGameData) return;
    this.log(`P2P message: ${p2pMsg.type}`);
    switch (p2pMsg.type) {
      case "connect":
        if (this.runtimeState.isJoiner) {
          this.actionQueue.put({
            type: "REQUEST_CREATOR_SIGNATURE",
            data: {},
          });
        }
        break;
      case "requestCreatorSignature":
        if (this.runtimeState.isCreator) {
          if (p2pMsg.data.gameId === this.currentGameData.gameId) {
            const _data: ActionData_SignCreatorSignature = {
              gameId: this.currentGameData.gameId,
              walletAddress: p2pMsg.data.myWalletAddress,
            };
            this.actionQueue.put({
              type: "SIGN_CREATOR_SIGNATURE",
              data: _data,
            });
          }
        }
        break;
      case "creatorSignature":
        if (this.runtimeState.isJoiner) {
          const _data: ActionData_Join = {
            endTime: p2pMsg.data.endTime,
            creatorSignature: p2pMsg.data.signature,
          };

          const _endTime = Math.floor(Date.now() / 1000) - 5;
          if (_data.endTime > _endTime) {
            console.error("creatorSignature will expire soon");
          }

          // verfy signature
          const _hash = ethers.keccak256(
            ethers.solidityPacked(
              ["bytes32", "uint256", "address"],
              [
                this.currentGameData.gameId,
                _data.endTime,
                this.runtimeState.walletAddress,
              ],
            ),
          );
          const recoveredAddress = ethers
            .recoverAddress(_hash, _data.creatorSignature)
            .toLowerCase();
          if (
            recoveredAddress !==
            this.currentGameData.creatorSessionKey.toLowerCase()
          ) {
            console.error("verify signature failed");
          } else {
            this.actionQueue.put({
              type: "JOIN",
              data: _data,
            });
          }
        }
        break;
      case "shot":
        {
          if (this.runtimeState.hashChain!.hashChainList[0].status === "None") {
            await this.fetchGameData(true);
            if (
              this.currentGameData.currentGameStatusHash ===
              this.currentGameData.gameId
            ) {
              for (let i = 0; i < 6; i++) {
                if (i === 6) {
                  debugger;
                  throw new Error("error");
                }
                if (
                  this.currentGameData.nextTurnState ===
                    NextTurnState.JoinerFire ||
                  this.currentGameData.nextTurnState ===
                    NextTurnState.CreatorFire
                ) {
                  break;
                }
                // update
                await this.sleep(300);
                await this.fetchGameData(true);
              }
              if (
                this.runtimeState.hashChain!.hashChainList.length !== 1 ||
                this.runtimeState.hashChain!.hashChainList[0].status !== "None"
              ) {
                throw new Error("error");
              }
              this.updateHashChain({
                status:
                  this.currentGameData.nextTurnState ===
                  NextTurnState.CreatorFire
                    ? "CreatorFire"
                    : "JoinerFire",
                value: 0,
                proof: undefined,
                signature: "",
                hasInContract: false,
              });
            } else {
              // error
              debugger;
              throw new Error("error");
            }
          }

          /*
                        {
                            type:'shot',
                            data: {
                                statusHash:<statushash>,
                                position:<fireAtPosition>,
                                signature:<signature>
                            }
                        }
                    */
          const _data: ActionData_Shot = {
            mergeEnd: 0,
            fromContract: false,
            statusHash: p2pMsg.data.statusHash,
            position: p2pMsg.data.position,
            signature: p2pMsg.data.signature,
          };
          this.actionQueue.put({
            type: "ENEMY_SHOT",
            data: _data,
          });
        }
        break;
      case "report":
        {
          /*
                      {
                        type:'report',
                        data:{
                            statusHash:<statushash>,
                            position:<fireAtPosition>,
                            shotResult:<shotResult>,
                            signature:<reportSignature>,
                            poof:<ZKProof>
                            }
                        }
                    */
          const _data: ActionData_Report = {
            mergeEnd: 0,
            fromContract: false,
            statusHash: p2pMsg.data.statusHash,
            position: p2pMsg.data.position,
            shotResult: p2pMsg.data.shotResult as ShotResult,
            signature: p2pMsg.data.signature,
            poof: p2pMsg.data.poof,
          };
          this.actionQueue.put({
            type: "ENEMY_REPORT",
            data: _data,
          });
        }
        break;
      case "surrender":
        {
          const enemySignature = p2pMsg.data as string;
          // verify
          const _hash = ethers.keccak256(
            ethers.solidityPacked(
              ["bytes32", "string"],
              [this.currentGameData.gameId, "I surrender"],
            ),
          );
          const recoveredAddress = ethers
            .recoverAddress(_hash, enemySignature)
            .toLowerCase();
          if (
            recoveredAddress !==
            (this.runtimeState.isCreator
              ? this.currentGameData.joinerSessionKey
              : this.currentGameData.creatorSessionKey
            ).toLowerCase()
          ) {
            console.error("verify signature failed");
          } else {
            const _data: ActionData_EnemySurrender = {
              enemySignature: enemySignature,
            };
            this.actionQueue.put({
              type: "ENEMY_SURRENDER",
              data: _data,
            });
          }
        }
        break;
      default:
        throw new Error("error");
    }
  }

  private _timer_request_creator_sign: NodeJS.Timeout | undefined = undefined;

  private async sendMsg(data: unknown) {
    if (USE_P2P) {
      this.trysteroManager!.send(data);
    }
    if (USE_PARTYKIT) {
      this.partykitManager!.send(data);
    }
  }

  private async processActions() {
    let action = await this.actionQueue.get();
    if (!action || !this.currentGameData || !this.sessionKey) return;

    this.log(`Processing action: ${action.type}`);

    while (action !== undefined) {
      console.log(
        `${this.runtimeState.isCreator ? "creator" : "joiner"}: ${action.type}`,
      );
      this.updateGameViewStatus(action);
      switch (action.type) {
        case "GAME_CLOSED":
          {
            this.callbacks.onGameEnd?.(null);
          }
          break;
        case "REVEAL_SALT":
          {
            const _data = action.data as ActionData_Actor;
            if (_data.actorIsCreator === this.runtimeState.isCreator) {
              for (let _i = 0; _i < 5; _i++) {
                try {
                  await this.contract.sendZKBattleshipTx(
                    "revealRandomness",
                    this.currentGameData.gameId,
                    this.runtimeState.randomnessSalt,
                  );
                  break;
                } catch (error) {
                  console.error("reveal randomness failed, retrying...", error);
                }
                this.sleep(1000);
              }
            }
          }
          break;
        case "REQUEST_CREATOR_SIGNATURE":
          {
            this._timer_request_creator_sign = setTimeout(() => {
              this._timer_request_creator_sign = undefined;
              this.actionQueue.put({
                type: "REQUEST_CREATOR_SIGNATURE",
                data: {},
              });
            }, 1000);

            this.sendMsg({
              type: "requestCreatorSignature",
              data: {
                gameId: this.currentGameData.gameId,
                myWalletAddress: this.runtimeState.walletAddress,
              },
            });
          }
          break;
        case "SIGN_CREATOR_SIGNATURE":
          {
            const data = action.data as ActionData_SignCreatorSignature;
            //    bytes32 _hash = keccak256(abi.encodePacked(gameId, endTime, msg.sender));
            const endTime = Math.floor(Date.now() / 1000) + 30; /* 30s */
            const _hash = ethers.keccak256(
              ethers.solidityPacked(
                ["bytes32", "uint256", "address"],
                [data.gameId, endTime, data.walletAddress],
              ),
            );
            const signature = this.sessionKey.sign(_hash).serialized;

            this.sendMsg({
              type: "creatorSignature",
              data: {
                endTime: endTime,
                signature: signature,
              },
            });
          }
          break;
        case "JOIN":
          {
            if (this._timer_request_creator_sign !== undefined) {
              clearTimeout(this._timer_request_creator_sign);
              this._timer_request_creator_sign = undefined;
            }
            if (this.runtimeState.joinStatus === "NOT_JOINED") {
              this.runtimeState.joinStatus = "JOINING";
              const data = action.data as ActionData_Join;
              /*
                                endTime: endTime,
                                signature: signature
                            */
              /*
                                bytes32 gameId,
                                bytes32 boardCommitment,
                                address sessionKey,
                                uint256 endTime,
                                bytes calldata creatorSignature
                            */
              let re = false;
              for (let _i = 0; _i < 5; _i++) {
                try {
                  const userBalance = await this.contract.getUserBalance(
                    this.runtimeState.walletAddress,
                  );
                  const boardCommitment =
                    await this.runtimeState.gridMe.getPoseidonHash(
                      BigInt(this.runtimeState.boardSalt),
                    );
                  re = await this.contract.joinGame(
                    this.currentGameData.gameId,
                    boardCommitment,
                    this.currentGameData.stake,
                    this.runtimeState.sessionKeyAddress,
                    data.endTime,
                    data.creatorSignature,
                    userBalance,
                  );
                  break;
                } catch (error) {
                  console.error("joinGame failed, retrying...", error);
                }
                this.sleep(1000);
              }

              if (re === false) {
                console.error("join game failed");
                this.runtimeState.joinStatus = "NOT_JOINED";
                debugger;
              } else {
                this.runtimeState.joinStatus = "JOINED";
              }
            }
          }
          break;
        case "WAITING_FOR_SHOOT":
          {
            const _data = action.data as ActionData_Actor;
            if (_data.actorIsCreator === this.runtimeState.isCreator) {
              if (this.autoShoot) {
                this._autoShoot();
              } else {
                // Notify UI to enable shoot action
                this.enableShoot();
              }
            }
          }
          break;
        case "SHOT":
          {
            const _data = action.data as ActionData_ShootAt;
            const fireAt = _data.fireAt;
            const nextStatusHash =
              this.runtimeState.hashChain!.getNextStatusHash(fireAt);
            const signature = this.sessionKey.sign(nextStatusHash).serialized;
            const status = this.runtimeState.hashChain!.getNextStatus();
            if (this.runtimeState.isCreator) {
              if (status !== "CreatorFire") {
                throw new Error("err");
              }
            } else {
              if (status !== "JoinerFire") {
                throw new Error("err");
              }
            }
            this.updateHashChain({
              status: status,
              value: fireAt,
              proof: undefined,
              signature: signature,
              hasInContract: false,
            });

            // update UI
            {
              /**
               * PosStatus.AttackedPending
               * After the player clicks on the opponent’s board,
               * the player cannot immediately know whether the shot hit an opponent’s ship.
               * The result must wait for the opponent’s REPORT,
               * which may take 0.1–10 seconds. During this period,
               * the corresponding shot cell on the opponent’s board
               * should be temporarily updated to a pending / waiting state.
               */
              this.runtimeState.gridEnemy.enemySaveShoot(fireAt, null);
            }

            if (true /* when P2P is available */) {
              this.sendMsg({
                type: "shot",
                data: {
                  statusHash: nextStatusHash,
                  position: fireAt,
                  signature: signature,
                },
              });
            } else {
              // #TODO
            }
          }
          break;
        case "REPORT":
          {
            const data = action.data as ActionData_SelfReport;

            /*
                            {
                            type:'report',
                            data:{
                                statusHash:<statushash>,
                                position:<fireAtPosition>,
                                shotResult:<shotResult>,
                                signature:<reportSignature>,
                                poof:<ZKProof>
                                }
                            }
                        */

            const nextStatusHash =
              this.runtimeState.hashChain!.getNextStatusHash(data.shotResult);
            const nextStatus = this.runtimeState.hashChain!.getNextStatus();
            if (this.runtimeState.isCreator) {
              if (nextStatus !== "CreatorReport") {
                throw new Error("err");
              }
            } else {
              if (nextStatus !== "JoinerReport") {
                throw new Error("err");
              }
            }
            const signature = this.sessionKey.sign(nextStatusHash).serialized;
            this.updateHashChain({
              status: nextStatus,
              value: data.shotResult,
              proof: data.poof,
              signature: signature,
              hasInContract: false,
            });
            if (true /* when P2P is available */) {
              this.sendMsg({
                type: "report",
                data: {
                  statusHash: nextStatusHash,
                  position: data.position,
                  shotResult: data.shotResult,
                  signature: signature,
                  poof: data.poof,
                },
              });
            } else {
              // #TODO
            }
            // Notify UI of board updates
            this.notifyMyBoardUpdate();
            this.notifyEnemyBoardUpdate();
          }
          break;
        case "SELF_SHOT":
        case "ENEMY_SHOT":
          {
            const data = action.data as ActionData_Shot;
            if (action.type === "SELF_SHOT") {
            } else {
              if (this.runtimeState.gotRandomnessRevealed === false) {
                console.warn("waiting for randomness revealed");
                // waiting this.runtimeState.gotRandomnessRevealed=true
                setTimeout(() => {
                  this.actionQueue.put({
                    type: "ENEMY_SHOT",
                    data: data,
                  });
                }, 500);
              } else {
                let verify = true;
                if (data.fromContract === false) {
                  // verify signature
                  const recoveredAddress = ethers
                    .recoverAddress(data.statusHash, data.signature)
                    .toLowerCase();
                  if (
                    recoveredAddress !==
                    (this.runtimeState.isCreator
                      ? this.currentGameData.joinerSessionKey
                      : this.currentGameData.creatorSessionKey
                    ).toLowerCase()
                  ) {
                    console.error("verify signature failed");
                    verify = false;
                  }
                }

                if (verify) {
                  const nextStatusHash =
                    this.runtimeState.hashChain!.getNextStatusHash(
                      data.position,
                    );
                  const nextStatus =
                    this.runtimeState.hashChain!.getNextStatus();
                  if (
                    nextStatusHash.toLowerCase() ===
                    data.statusHash.toLowerCase()
                  ) {
                    if (data.mergeEnd != 0) {
                      console.log("merged status hash");
                    }
                    if (this.runtimeState.isCreator) {
                      if (nextStatus !== "JoinerFire") {
                        verify = false;
                        debugger;
                        //#TODO
                        // throw new Error('err');
                      }
                    } else {
                      if (nextStatus !== "CreatorFire") {
                        verify = false;
                        debugger;
                        //#TODO
                        // throw new Error('err');
                      }
                    }
                    if (verify) {
                      this.updateHashChain({
                        status: nextStatus,
                        value: data.position,
                        proof: undefined,
                        signature: data.signature,
                        hasInContract: data.fromContract,
                      });
                      // update bin grid
                      const board = this.runtimeState.gridMe.getBoardBin();
                      const shotResult = this.runtimeState.gridMe.firedAt(
                        data.position,
                      );
                      const pub_input: bigint =
                        (BigInt(shotResult.sunkHeadPosition) << BigInt(48)) +
                        (BigInt(shotResult.sunkEndPosition) << BigInt(56)) +
                        (board << BigInt(12)) +
                        (BigInt(data.position) << BigInt(4)) +
                        BigInt(shotResult.shotStatus);
                      const _cruiser: number[] = []; // this.runtimeState.gridMe.ships[0]
                      for (
                        let s = 0;
                        s < this.runtimeState.gridMe.ships[0].length;
                        s++
                      ) {
                        _cruiser.push(this.runtimeState.gridMe.ships[0][s]);
                      }
                      const _destroyer: number[] = []; // this.runtimeState.gridMe.ships[1]
                      for (
                        let s = 0;
                        s < this.runtimeState.gridMe.ships[1].length;
                        s++
                      ) {
                        _destroyer.push(this.runtimeState.gridMe.ships[1][s]);
                      }

                      const inputMap: InputMap = {
                        cruiser: _cruiser,
                        destroyer: _destroyer,
                        submarine: this.runtimeState.gridMe.ships[2][0],
                        salt: this.runtimeState.boardSalt,
                        expected_hash:
                          await this.runtimeState.gridMe.getPoseidonHash(
                            BigInt(this.runtimeState.boardSalt),
                          ),
                        pub_input: pub_input.toString(),
                      };
                      const { witness } = await this.noir.execute(inputMap);
                      const proofData: ProofData =
                        await this.Backend.generateProof(witness, {
                          keccak: true,
                        });
                      const proofBytes =
                        "0x" + Buffer.from(proofData.proof).toString("hex");
                      verify = await this.Backend.verifyProof(proofData, {
                        keccak: true,
                      });
                      if (verify === false) {
                        throw new Error("verifyProof failed");
                      }
                      this.runtimeState.gridMe.firedAt(data.position, true);
                      // Notify UI of my board update
                      this.notifyMyBoardUpdate();
                      const _data: ActionData_SelfReport = {
                        position: data.position,
                        shotResult: shotResult,
                        poof: proofBytes,
                        // debuggerData: {
                        //     board: board,
                        //     shotResult: shotResult,
                        //     pub_input: pub_input.toString()
                        // }
                      };
                      // report
                      this.actionQueue.put({
                        type: "REPORT",
                        data: _data,
                      });

                      // check result
                      if (
                        this.runtimeState.gridMe.countHitShips() >=
                        DEFAULT_GRID_SIZE
                      ) {
                        // enemy win
                        this.actionQueue.put({
                          type: "SELF_SURRENDER",
                          data: {},
                        });
                      } else {
                        // shot
                        this.actionQueue.put({
                          type: "WAITING_FOR_SHOOT",
                          data: {
                            actorIsCreator: this.runtimeState.isCreator
                              ? true
                              : false,
                          },
                        });
                      }
                    }
                  } else if (
                    this.runtimeState.hashChain!.include(data.statusHash)
                  ) {
                    // skip
                    // console.log('skip statusHash');
                  } else {
                    // merge
                    let canMerge = true;
                    if (data.mergeEnd == 0) {
                      // first time
                      const mergeLimit =
                        blockTime * 3 < 1000 * 10 ? 1000 * 10 : blockTime * 3;
                      data.mergeEnd = Date.now() + mergeLimit;
                    } else if (data.mergeEnd < Date.now()) {
                      // can merge
                    } else {
                      // discard packet
                      canMerge = false;
                    }
                    if (canMerge) {
                      console.log("waiting for merge statusHash");
                      setTimeout(() => {
                        this.actionQueue.put({
                          type: "ENEMY_SHOT",
                          data: data,
                        });
                      }, 1000);
                    }
                  }
                }
              }
            }
            // update this.runtimeState.hashChain!.hasInContract flag
            if (data.fromContract === true) {
              let flag = false;
              for (
                let _i = this.runtimeState.hashChain!.hashChainList.length - 1;
                _i >= 0;
                _i--
              ) {
                if (
                  this.runtimeState.hashChain!.hashChainList[
                    _i
                  ].hash.toLowerCase() === data.statusHash.toLowerCase()
                ) {
                  flag = true;
                }
                if (flag) {
                  this.runtimeState.hashChain!.setHasInContract(_i, true);
                }
              }
            }
          }
          break;
        case "SELF_REPORT":
        case "ENEMY_REPORT":
          {
            const data = action.data as ActionData_Report;
            let verify = true;
            if (action.type === "SELF_REPORT") {
            } else {
              if (data.fromContract === false) {
                // verify signature
                const recoveredAddress = ethers
                  .recoverAddress(data.statusHash, data.signature)
                  .toLowerCase();
                if (
                  recoveredAddress !==
                  (this.runtimeState.isCreator
                    ? this.currentGameData.joinerSessionKey
                    : this.currentGameData.creatorSessionKey
                  ).toLowerCase()
                ) {
                  console.error("verify signature failed");
                  verify = false;
                }
              }
              if (verify) {
                const nextStatusHash =
                  this.runtimeState.hashChain!.getNextStatusHash(
                    data.shotResult,
                  );
                const nextStatus = this.runtimeState.hashChain!.getNextStatus();
                if (
                  nextStatusHash.toLowerCase() === data.statusHash.toLowerCase()
                ) {
                  if (this.runtimeState.isCreator) {
                    if (nextStatus !== "JoinerReport") {
                      throw new Error("err");
                    }
                  } else {
                    if (nextStatus !== "CreatorReport") {
                      throw new Error("err");
                    }
                  }
                  if (data.fromContract === false) {
                    // verify proof
                    const board = this.runtimeState.gridEnemy.getBoardBin();
                    const pub_input: bigint =
                      (BigInt(data.shotResult.sunkHeadPosition) << BigInt(48)) +
                      (BigInt(data.shotResult.sunkEndPosition) << BigInt(56)) +
                      (board << BigInt(12)) +
                      (BigInt(data.position) << BigInt(4)) +
                      BigInt(data.shotResult.shotStatus);
                    const proofData: ProofData = {
                      proof: Uint8Array.from(
                        Buffer.from(
                          data.poof.startsWith("0x")
                            ? data.poof.slice(2)
                            : data.poof,
                          "hex",
                        ),
                      ),
                      publicInputs: [
                        this.runtimeState.isCreator
                          ? this.currentGameData.joinerBoardCommitment
                          : this.currentGameData.creatorBoardCommitment,
                        "0x" + pub_input.toString(16).padStart(64, "0"),
                      ],
                    };
                    try {
                      const _verify = await this.Backend.verifyProof(
                        proofData,
                        {
                          keccak: true,
                        },
                      );
                      if (_verify === false) {
                        console.error("verifyProof failed");
                        verify = false;
                      }
                    } catch (error) {
                      verify = false;
                      console.error("verifyProof failed", error);
                    }
                  }
                  if (verify) {
                    if (data.mergeEnd != 0) {
                      console.log("merged status hash");
                    }
                    this.updateHashChain({
                      status: nextStatus,
                      value: data.shotResult,
                      proof: data.fromContract ? undefined : data.poof,
                      signature: data.signature,
                      hasInContract: data.fromContract,
                    });

                    this.runtimeState.gridEnemy.enemySaveShoot(
                      data.position,
                      data.shotResult,
                    );
                    // Notify UI of enemy board update
                    this.notifyEnemyBoardUpdate();
                    if (
                      this.runtimeState.gridEnemy.countHitShips() >=
                      DEFAULT_GRID_SIZE
                    ) {
                      // win, waiting surrender, submit status myself if waiting for >3s
                      // SELF_SUBMIT_WIN_PROOF
                      if (this.self_submit_win_poof_handler === undefined) {
                        this.self_submit_win_poof_handler = setTimeout(() => {
                          this.actionQueue.put({
                            type: "SELF_SUBMIT_WIN_PROOF",
                            data: {},
                          });
                        }, 3000);
                      }
                    }
                    // Notify UI of board updates
                    this.notifyMyBoardUpdate();
                    this.notifyEnemyBoardUpdate();
                  }
                } else if (
                  this.runtimeState.hashChain!.include(data.statusHash)
                ) {
                  // skip
                  // console.log('skip statusHash');
                } else {
                  // merge
                  let canMerge = true;
                  if (data.mergeEnd == 0) {
                    // first time
                    const mergeLimit =
                      blockTime * 3 < 1000 * 10 ? 1000 * 10 : blockTime * 3;
                    data.mergeEnd = Date.now() + mergeLimit;
                  } else if (data.mergeEnd < Date.now()) {
                    // can merge
                  } else {
                    // discard packet
                    canMerge = false;
                  }
                  if (canMerge) {
                    console.log("waiting for merge statusHash");
                    setTimeout(() => {
                      this.actionQueue.put({
                        type: "ENEMY_REPORT",
                        data: data,
                      });
                    }, 200);
                  }
                }
              }
            }

            if (verify) {
              // update this.runtimeState.hashChain!.hasInContract flag
              if (data.fromContract === true) {
                let flag = false;
                for (
                  let _i =
                    this.runtimeState.hashChain!.hashChainList.length - 1;
                  _i >= 0;
                  _i--
                ) {
                  if (
                    this.runtimeState.hashChain!.hashChainList[
                      _i
                    ].hash.toLowerCase() === data.statusHash.toLowerCase()
                  ) {
                    flag = true;
                  }
                  if (flag) {
                    this.runtimeState.hashChain!.setHasInContract(_i, true);
                  }
                }
              }
            }
          }
          break;
        case "SELF_SURRENDER":
          {
            // bytes32 _hash = keccak256(abi.encodePacked(gameId, "I surrender"));
            const _hash = ethers.keccak256(
              ethers.solidityPacked(
                ["bytes32", "string"],
                [this.currentGameData.gameId, "I surrender"],
              ),
            );
            const signature = this.sessionKey.sign(_hash).serialized;
            if (true /* when P2P is available */) {
              this.sendMsg({
                type: "surrender",
                data: signature,
              });
            } else {
              // #TODO
            }
          }
          break;
        case "ENEMY_SURRENDER":
          {
            if (this.self_submit_win_poof_handler !== undefined) {
              clearTimeout(this.self_submit_win_poof_handler);
              this.self_submit_win_poof_handler = undefined;
            }
            const data = action.data as ActionData_EnemySurrender;
            for (let _i = 0; _i < 5; _i++) {
              try {
                await this.contract.sendZKBattleshipTx(
                  "surrender",
                  this.currentGameData.gameId,
                  data.enemySignature,
                );
                break;
              } catch (error) {
                console.error("surrender failed, retrying...", error);
              }
              this.sleep(1000);
            }

            //this.currentGameData = await this.getGameData(currentGameData.gameId);
            // if (currentGameData.nextTurnState !== NextTurnState.Completed) {
            //     throw new Error('error');
            // }
          }
          break;
        case "GAME_END":
          {
            if (this.self_submit_win_poof_handler !== undefined) {
              clearTimeout(this.self_submit_win_poof_handler);
              this.self_submit_win_poof_handler = undefined;
            }
            const data = action.data as ActionData_GameEnd;
            const isWinner =
              data.winner.toLowerCase() ===
              this.runtimeState.walletAddress.toLowerCase();
            if (isWinner) {
              console.log(
                `I'm ${this.runtimeState.isCreator ? "creator" : "joiner"}, I win!`,
              );
            } else {
              console.log(
                `I'm ${this.runtimeState.isCreator ? "creator" : "joiner"}, I lose!`,
              );
            }
            // Notify UI about game end with result
            this.callbacks.onGameEnd?.(isWinner);
            // Don't call stopGame here - let UI handle it after showing animation
            return;
          }
          break;
        case "TRY_OPPONENT_LEAVE":
          try {
            await this.contract.opponentLeave(this.currentGameData.gameId);
          } catch (error) {
            console.error("opponentLeave failed", error);
          }
          break;
        case "UPDATE_GAME_STATUS":
          {
            const onlinehash =
              this.currentGameData.currentGameStatusHash.toLowerCase();
            let index_from = 0;
            let index_end_a = 0;
            let index_end_b = 0;
            if (this.runtimeState.hashChain!.hashChainList.length > 1) {
              for (
                let i = 0;
                i < this.runtimeState.hashChain!.hashChainList.length;
                i++
              ) {
                if (
                  this.runtimeState.hashChain!.hashChainList[
                    i
                  ].hash.toLowerCase() === onlinehash
                ) {
                  if (
                    this.runtimeState.hashChain!.hashChainList.length >
                    i + 1
                  ) {
                    index_from = i + 1;
                  }
                  break;
                }
              }
              if (index_from > 0) {
                for (
                  let i = this.runtimeState.hashChain!.hashChainList.length - 1;
                  i >= index_from;
                  i--
                ) {
                  if (
                    this.runtimeState.hashChain!.hashChainList[i].status ===
                    (this.runtimeState.isCreator
                      ? "JoinerReport"
                      : "CreatorReport")
                  ) {
                    index_end_a = i;
                    break;
                  }
                }
                for (
                  let i = this.runtimeState.hashChain!.hashChainList.length - 1;
                  i >= index_from;
                  i--
                ) {
                  if (
                    this.runtimeState.hashChain!.hashChainList[i].status ===
                    (this.runtimeState.isCreator ? "JoinerFire" : "CreatorFire")
                  ) {
                    index_end_b = i;
                    break;
                  }
                }
              }
            }
            if (index_from > 0) {
              let use_zkproof = false;
              let index_end = 0;
              if (index_end_a > 0) {
                // [index_from,index_end_a]
                index_end = index_end_a;
              } else if (index_end_b > 0) {
                // [index_from,index_end_b]
                index_end = index_end_b;
              } else {
                // [index_from,index_from]
                const status =
                  this.runtimeState.hashChain!.hashChainList[index_from].status;
                if (
                  status ===
                  (this.runtimeState.isCreator
                    ? "CreatorReport"
                    : "JoinerReport")
                ) {
                  // reportShotResult
                  use_zkproof = true;
                } else {
                  // submitGameStatus
                  index_end = index_from;
                }
              }
              if (use_zkproof) {
                const item =
                  this.runtimeState.hashChain!.hashChainList[index_from];
                //const result =
                try {
                  await this.contract.reportShotResult(
                    this.currentGameData.gameId,
                    onlinehash,
                    item.value as ShotResult,
                    item.proof as string,
                  );
                } catch (error) {
                  console.error("reportShotResult failed", error);
                }

                // if (!result) {
                //     const a1 = await this.getGameData(currentGameData.gameId);
                //     console.log(a1);
                //     console.log(item);
                //     debugger;
                // }
              } else {
                const gameStatus: number[] = [];
                let sessionKeySignature = "0x";
                for (let i = index_from; i <= index_end; i++) {
                  const item = this.runtimeState.hashChain!.hashChainList[i];
                  if (index_end === i) {
                    if (
                      item.status == "CreatorFire" ||
                      item.status == "CreatorReport"
                    ) {
                      if (this.runtimeState.isJoiner) {
                        sessionKeySignature = item.signature;
                      }
                    } else {
                      if (this.runtimeState.isCreator) {
                        sessionKeySignature = item.signature;
                      }
                    }
                  }
                  gameStatus.push(
                    typeof item.value === "number"
                      ? item.value
                      : item.value.shotStatus,
                  );
                }
                try {
                  await this.contract.submitGameStatus(
                    this.currentGameData.gameId,
                    onlinehash,
                    gameStatus,
                    sessionKeySignature,
                  );
                } catch (error) {
                  console.error("submitGameStatus failed", error);
                }
              }
            }
          }
          break;
        case "SELF_SUBMIT_WIN_PROOF":
          {
            await this.fetchGameData(true);
            this.self_submit_win_poof_handler = undefined;
            const gameStatus: number[] = [];
            let start = false;
            let sessionKeySignature = "0x";
            for (
              let i = 1;
              i < this.runtimeState.hashChain!.hashChainList.length;
              i++
            ) {
              const item = this.runtimeState.hashChain!.hashChainList[i];
              if (start) {
                if (
                  i ===
                  this.runtimeState.hashChain!.hashChainList.length - 1
                ) {
                  if (
                    item.status == "CreatorFire" ||
                    item.status == "CreatorReport"
                  ) {
                    if (this.runtimeState.isJoiner) {
                      sessionKeySignature = item.signature;
                    }
                  } else {
                    if (this.runtimeState.isCreator) {
                      sessionKeySignature = item.signature;
                    }
                  }
                }
                gameStatus.push(
                  typeof item.value === "number"
                    ? item.value
                    : item.value.shotStatus,
                );
              }
              if (
                item.hash.toLowerCase() ==
                this.currentGameData.currentGameStatusHash.toLowerCase()
              ) {
                start = true;
              }
            }
            try {
              await this.contract.submitGameStatus(
                this.currentGameData.gameId,
                this.currentGameData.currentGameStatusHash,
                gameStatus,
                sessionKeySignature,
              );
            } catch (error) {
              console.error("submitGameStatus failed", error);
            }
          }
          break;
        case "REPORT_CHEATING":
          {
            const data = action.data as ActionData_ReportCheating;
            try {
              await this.contract.reportCheating(
                this.currentGameData.gameId,
                data.firePosition,
                data.signature,
              );
            } catch (error) {
              console.error("reportCheating failed", error);
            }
          }
          break;
        default:
          throw new Error("error");
      }
      await this.sleep(1);
      action = await this.actionQueue.get();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Get current game state
  getGameData(): GameData | null {
    return this.currentGameData;
  }

  isInGame(): boolean {
    return this.gameLoopRunning && this.currentGameData !== null;
  }
}
