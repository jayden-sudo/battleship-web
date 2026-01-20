import {
  type ShotResult,
  type UserBalance,
  type GameData,
  type GameDataInner,
  SENTINEL_BYTES32,
  NextTurnState,
} from "./interfaces";
import { ethers, type ContractMethodArgs } from "ethers";
import contractJson from "./ZKBattleshipV2.json";
import { sendCalls, getCallsStatus } from "@wagmi/core";
import type { Config } from "@wagmi/core";

const ZKBattleshipAddress =
  process.env.NEXT_PUBLIC_ZKBATTLESHPIP_CONTRACT_ADDRESS || "";

export class Contract {
  private ZKBattleship: ethers.Contract;
  // Provider used for read calls; can be JsonRpcProvider (public RPC) or BrowserProvider (injected)
  private provider: ethers.Provider;
  // Wallet signer (if available)
  private Signer?: ethers.JsonRpcSigner;
  // Wallet address (set after connecting wallet)
  public WalletAddress: string = "";
  // EIP-5792 atomic batch support
  private wagmiConfig?: Config;
  private supportsAtomicBatch: boolean = false;

  constructor(
    provider: ethers.Provider,
    signer?: ethers.JsonRpcSigner,
    wagmiConfig?: Config,
    supportsAtomicBatch?: boolean,
  ) {
    if (!ZKBattleshipAddress) {
      throw new Error("ZKBattleship contract address is not set");
    }
    this.provider = provider;
    this.Signer = signer;
    this.wagmiConfig = wagmiConfig;
    this.supportsAtomicBatch = supportsAtomicBatch || false;
    // use signer if available, otherwise the readonly provider
    const backend = this.Signer ? this.Signer : (this.provider as any);
    this.ZKBattleship = new ethers.Contract(
      ZKBattleshipAddress,
      contractJson.abi,
      backend as any,
    );
    if (this.Signer && (this.Signer as any).address) {
      this.WalletAddress = (this.Signer as any).address;
    }
  }

  public static getZKBattleshipAddress() {
    return ZKBattleshipAddress;
  }
  public static getZKBattleshipABI() {
    return contractJson.abi;
  }

  async setRPC(provider: ethers.Provider) {
    this.provider = provider;
    // if this provider is a BrowserProvider, try to get a signer
    try {
      // @ts-ignore - BrowserProvider has getSigner
      if ((provider as any).getSigner) {
        this.Signer = await (provider as any).getSigner();
      } else {
        this.Signer = undefined;
      }
    } catch (err) {
      this.Signer = undefined;
    }
    const backend = this.Signer ? this.Signer : (this.provider as any);
    this.ZKBattleship = new ethers.Contract(
      ZKBattleshipAddress,
      contractJson.abi,
      backend as any,
    );
    if (this.Signer && (this.Signer as any).address) {
      this.WalletAddress = (this.Signer as any).address;
    }
  }

  setWalletAddress(address: string) {
    this.WalletAddress = address;
  }

  async sendZKBattleshipTx(
    functionName: string,
    ...args: ContractMethodArgs<any>
  ) {
    try {
      console.log(`send tx: ${functionName}`);
      // Use EIP-5792 wallet_sendCalls if supported
      if (this.supportsAtomicBatch && this.wagmiConfig) {
        console.log("[EIP-5792] Using wallet_sendCalls for transaction");

        // Extract value from args if present (ethers.js passes overrides as last arg)
        let value = BigInt(0);
        let functionArgs = [...args];
        const lastArg = args[args.length - 1];
        if (lastArg && typeof lastArg === "object" && "value" in lastArg) {
          value = lastArg.value as bigint;
          // Remove overrides object from args for encoding
          functionArgs = args.slice(0, -1);
        }

        // Encode transaction data using contract interface
        const data = this.ZKBattleship.interface.encodeFunctionData(
          functionName,
          functionArgs,
        );

        // Send transaction using wallet_sendCalls
        const callsId = await sendCalls(this.wagmiConfig, {
          calls: [
            {
              to: ZKBattleshipAddress as `0x${string}`,
              data: data as `0x${string}`,
              value: value,
            },
          ],
        });

        console.log(`[EIP-5792] Transaction sent with callsId: ${callsId}`);

        let receipt = await getCallsStatus(this.wagmiConfig, callsId);
        while (true) {
          // "success" | "pending" | "failure" | undefined
          if (receipt.status !== "pending") {
            break;
          }
          console.log(`Transaction pending...`);
          await this.sleep(500);
          receipt = await getCallsStatus(this.wagmiConfig, callsId);
        }

        if (receipt.status !== "success") {
          throw new Error(functionName + " failed");
        }
        console.log(`tx success: ${functionName}`);
        return { status: 1, hash: callsId.id };
      }

      // Fallback to traditional transaction sending
      const tx = await this.ZKBattleship.getFunction(functionName).send(
        ...args,
      );
      const receipt = await tx.wait();
      if (receipt == null || receipt.status !== 1) {
        throw new Error(functionName + " failed");
      }
      console.log(`tx success: ${functionName}`);
      return receipt;
    } catch (error) {
      throw error;
    }
  }

  async staticCallZKBattleship<T>(
    functionName: string,
    ...args: ContractMethodArgs<any>
  ): Promise<T> {
    try {
      const data = await this.ZKBattleship.getFunction(functionName).staticCall(
        ...args,
      );
      return data as T;
    } catch (error) {
      throw error;
    }
  }

  async calculateGameId(
    randomnessCommitment: string,
    boardCommitment: string,
    stake: bigint,
    sessionKey: string,
    userBalance: UserBalance,
  ): Promise<string> {
    let gameId: string;
    const balance = userBalance.totalBalance - userBalance.lockedBalance;
    const value = stake > balance ? stake - balance : BigInt(0);
    try {
      gameId = await this.staticCallZKBattleship<string>(
        "createGame",
        randomnessCommitment,
        boardCommitment,
        stake,
        sessionKey,
        {
          from: this.WalletAddress,
          value: value,
        },
      );
      return gameId;
    } catch (error) {
      throw error;
    }
  }

  async createGame(
    randomnessCommitment: string,
    boardCommitment: string,
    stake: bigint,
    sessionKey: string,
    userBalance: UserBalance,
  ): Promise<GameData> {
    const gameId: string = await this.calculateGameId(
      randomnessCommitment,
      boardCommitment,
      stake,
      sessionKey,
      userBalance,
    );
    const balance = userBalance.totalBalance - userBalance.lockedBalance;
    const value = stake > balance ? stake - balance : BigInt(0);

    await this.sendZKBattleshipTx(
      "createGame",
      randomnessCommitment,
      boardCommitment,
      stake,
      sessionKey,
      {
        from: this.WalletAddress,
        value: value,
      },
    );

    return this.getGameData(gameId);
  }

  async joinGame(
    gameId: string,
    boardCommitment: string,
    stake: bigint,
    sessionKey: string,
    endTime: number,
    creatorSignature: string,
    userBalance: UserBalance,
  ) {
    console.warn("Joining game:", gameId);
    const balance = userBalance.totalBalance - userBalance.lockedBalance;
    const value = stake > balance ? stake - balance : BigInt(0);

    try {
      await this.staticCallZKBattleship(
        "joinGame",
        gameId,
        boardCommitment,
        sessionKey,
        endTime,
        creatorSignature,
        {
          from: this.WalletAddress,
          value: stake > balance ? value - balance : BigInt(0),
        },
      );
    } catch (error) {
      console.error(error);
      return false;
    }
    try {
      await this.sendZKBattleshipTx(
        "joinGame",
        gameId,
        boardCommitment,
        sessionKey,
        endTime,
        creatorSignature,
        {
          value: stake > balance ? value - balance : BigInt(0),
        },
      );
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  async getGameP2PId(gameData: GameData): Promise<string> {
    let creatorP2PUID: string = "";
    // get creator's P2P UID from eventlogs

    const filter = this.ZKBattleship.filters.GameCreated(gameData.gameId, null);
    // get current block
    let block_end = await (this.provider as any).getBlockNumber();
    const lastActiveTimestamp = Number(gameData.lastActiveTimestamp);
    while (true) {
      let block_from = block_end - 1000;
      if (block_from < 0) {
        block_from = 0;
      }
      const _block = await (this.provider as any).getBlock(block_from, false);
      if (_block?.timestamp! <= lastActiveTimestamp) {
        {
          const events = await this.ZKBattleship.queryFilter(
            filter,
            block_from,
            block_end,
          );
          if (events.length !== 1) {
            throw new Error("can not find GameCreated event");
          }
          const _log = events[0] as ethers.EventLog;
          // creatorP2PUID = ethers.getBytes(_log.args.p2pUID);
          creatorP2PUID = _log.args.p2pUID;
        }
        break;
      }
      block_end = block_from;
      if (block_from === 0) {
        break;
      }
    }
    if (creatorP2PUID === "") {
      throw new Error("can not find creator P2P UID");
    }
    return creatorP2PUID;
  }

  async closeIdleGame(gameId: string) {
    try {
      await this.staticCallZKBattleship("closeIdleGame", gameId, {
        from: this.WalletAddress,
      });
    } catch (error) {
      return false;
    }
    await this.sendZKBattleshipTx("closeIdleGame", gameId);
    return true;
  }

  async surrender(gameId: string) {
    try {
      await this.staticCallZKBattleship("surrender", gameId, "0x", {
        from: this.WalletAddress,
      });
    } catch (error) {
      return false;
    }
    await this.sendZKBattleshipTx("surrender", gameId, "0x");
    return true;
  }

  async opponentLeave(gameId: string) {
    try {
      await this.staticCallZKBattleship("opponentLeave", gameId, {
        from: this.WalletAddress,
      });
    } catch (error) {
      return false;
    }
    await this.sendZKBattleshipTx("opponentLeave", gameId);
    return true;
  }

  async reportCheating(
    gameId: string,
    firePosition: number,
    opponentSessionKeySignature: string,
  ) {
    try {
      await this.staticCallZKBattleship(
        "reportCheating",
        gameId,
        firePosition,
        opponentSessionKeySignature,
        {
          from: this.WalletAddress,
        },
      );
    } catch (error) {
      return false;
    }
    await this.sendZKBattleshipTx(
      "reportCheating",
      gameId,
      firePosition,
      opponentSessionKeySignature,
    );
    return true;
  }

  async listWaitingGameData(): Promise<GameData[]> {
    const games = await this.staticCallZKBattleship<{
      gameIds: string[];
      gameData: GameDataInner[];
    }>("listWaitingGameData", SENTINEL_BYTES32, 1000);
    const gameDataList: GameData[] = [];
    const ts_from = Date.now() / 1000 - 60 * 60 * 24 /* 24h */;
    for (let i = 0; i < games.gameData.length; i++) {
      const _gameData = games.gameData[i];
      if (Number(_gameData.nextTurnState) === Number(NextTurnState.Join)) {
        const ts = Number(_gameData.lastActiveTimestamp);
        if (ts > ts_from) {
          const gameData: GameData = {
            gameId: games.gameIds[i],
            creator: _gameData.creator,
            joiner: _gameData.joiner,
            creatorRandomnessCommitment: _gameData.creatorRandomnessCommitment,
            joinerRandomnessSalt: _gameData.joinerRandomnessSalt,
            creatorBoardCommitment: _gameData.creatorBoardCommitment,
            joinerBoardCommitment: _gameData.joinerBoardCommitment,
            stake: _gameData.stake,
            lastActiveTimestamp: _gameData.lastActiveTimestamp,
            creatorGameBoard: _gameData.creatorGameBoard,
            joinerGameBoard: _gameData.joinerGameBoard,
            nextTurnState: Number(_gameData.nextTurnState),
            fireAtPosition: _gameData.fireAtPosition,
            previousGameStatusHash: _gameData.previousGameStatusHash,
            currentGameStatusHash: _gameData.currentGameStatusHash,
            creatorSessionKey: _gameData.creatorSessionKey,
            joinerSessionKey: _gameData.joinerSessionKey,
            p2pRoomId: _gameData.p2pRoomId,
          };
          gameDataList.push(gameData);
        }
      }
    }
    return gameDataList;
  }

  async getGameData(gameId: string) {
    const _gameData = await this.staticCallZKBattleship<GameDataInner>(
      "getGameData",
      gameId,
    );
    const gameData: GameData = {
      gameId: gameId,
      creator: _gameData.creator,
      joiner: _gameData.joiner,
      creatorRandomnessCommitment: _gameData.creatorRandomnessCommitment,
      joinerRandomnessSalt: _gameData.joinerRandomnessSalt,
      creatorBoardCommitment: _gameData.creatorBoardCommitment,
      joinerBoardCommitment: _gameData.joinerBoardCommitment,
      stake: _gameData.stake,
      lastActiveTimestamp: _gameData.lastActiveTimestamp,
      creatorGameBoard: _gameData.creatorGameBoard,
      joinerGameBoard: _gameData.joinerGameBoard,
      nextTurnState: Number(_gameData.nextTurnState),
      fireAtPosition: _gameData.fireAtPosition,
      previousGameStatusHash: _gameData.previousGameStatusHash,
      currentGameStatusHash: _gameData.currentGameStatusHash,
      creatorSessionKey: _gameData.creatorSessionKey,
      joinerSessionKey: _gameData.joinerSessionKey,
      p2pRoomId: _gameData.p2pRoomId,
    };
    return gameData;
  }

  async getUserBalance(address: string) {
    const userBalance: UserBalance = await this.staticCallZKBattleship(
      "getUserBalance",
      address,
    );
    return userBalance;
  }

  async withdraw(amount: bigint) {
    await this.sendZKBattleshipTx("withdraw", amount);
  }

  async getUserGameId(address: string) {
    return await this.staticCallZKBattleship<string>("getUserGameId", address);
  }

  async submitGameStatus(
    gameId: string,
    expectGameStatusHash: string,
    gameStatus: number[],
    opponentSessionKeySignature: string,
  ) {
    try {
      await this.staticCallZKBattleship(
        "submitGameStatus",
        gameId,
        expectGameStatusHash,
        gameStatus,
        opponentSessionKeySignature,
        {
          from: this.WalletAddress,
        },
      );
    } catch (error) {
      return false;
    }
    await this.sendZKBattleshipTx(
      "submitGameStatus",
      gameId,
      expectGameStatusHash,
      gameStatus,
      opponentSessionKeySignature,
    );
    return true;
  }

  async reportShotResult(
    gameId: string,
    expectGameStatusHash: string,
    shotResult: ShotResult,
    proof: string,
  ) {
    try {
      await this.staticCallZKBattleship(
        "reportShotResult",
        gameId,
        expectGameStatusHash,
        shotResult,
        proof,
        {
          from: this.WalletAddress,
        },
      );
    } catch (error) {
      return false;
    }
    await this.sendZKBattleshipTx(
      "reportShotResult",
      gameId,
      expectGameStatusHash,
      shotResult,
      proof,
    );
    return true;
  }

  sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
