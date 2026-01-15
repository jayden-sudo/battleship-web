'use client'

import { ethers, SigningKey } from 'ethers'
import { GameBoard } from './gameBoard'
import { HashChain } from './hashChain'
import { Contract } from './contract'
import { EventLogMonitor } from './eventLogMonitor'
import { MessageQueue } from './messageQueue'
// import { PeerManager } from './peerManager'
import { TrysteroManager } from './trysteroManager';
import {
    GameData, P2PMessage, Action, NextTurnState, ROUND_TIME_LIMIT,
    REVEAL_RANDOMNESS_LIMIT, DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES,
    ActionData_SignCreatorSignature, ActionData_Join, ActionData_SelfReport,
    ActionData_Shot,
    ShotResult,
    ActionData_Report,
    ActionData_EnemySurrender,
    ActionData_GameEnd,
    ActionData_ReportCheating,
    BYTES32_0,
    ActionData_ShootAt,
    PosStatus,
    HashChainData,
    HashChainStatus,
    GameViewStatus
} from './interfaces'
import { ProofData, UltraHonkBackend } from '@aztec/bb.js';
import { CompiledCircuit, InputMap, Noir } from '@noir-lang/noir_js';
import * as compiledCircuit from './process_shot.json';
import { getPublicRpcUrl } from '@/config/wagmi';

export interface GameManagerCallbacks {
    onGameDataUpdate?: (gameData: GameData) => void
    onMyBoardUpdate?: (board: GameBoard) => void
    onEnemyBoardUpdate?: (board: GameBoard) => void
    onGameStateChange?: (isInGame: boolean) => void
    onShootEnabled?: (enabled: boolean) => void
    onLoadingChange?: (loading: boolean, message: string) => void
    onGameEnd?: (isWinner: boolean) => void
    onGameViewStatusChange?: (status: string, isMyTurn: boolean) => void
    onMessage?: (message: string) => void
    onError?: (error: string) => void
}
const blockTime = 300;

export class GameManager {
    private provider: ethers.BrowserProvider
    private signer: ethers.JsonRpcSigner
    private walletAddress: string
    private contract: Contract
    private callbacks: GameManagerCallbacks

    // Game state
    private isCreator: boolean = false
    private isJoiner: boolean = false
    private joinStatus: 'NOT_JOINED' | 'JOINING' | 'JOINED' = 'NOT_JOINED'

    // Game data
    private currentGameData: GameData | null = null
    private sessionKey: SigningKey | null = null
    private sessionKeyAddress: string = ''
    private boardSalt: string = ''
    private randomnessSalt: string = ''

    // Game boards
    public gridMe: GameBoard
    public gridEnemy: GameBoard

    // Queues
    private actionQueue: MessageQueue<Action>
    private p2pQueue: MessageQueue<P2PMessage>
    private contractLogQueue: MessageQueue<any> | null = null
    private hashChain: HashChain | null = null

    // Monitors
    private logMonitor: EventLogMonitor | null = null
    private gameLoopRunning: boolean = false
    private lastGameDataUpdate: number = 0;

    private self_submit_win_poof_handler: NodeJS.Timeout | undefined = undefined;

    private gotRandomnessRevealed = false;

    private Backend;
    private noir: Noir;

    private autoShoot = false;
    private trysteroManager: TrysteroManager;

    constructor(
        provider: ethers.BrowserProvider,
        signer: ethers.JsonRpcSigner,
        walletAddress: string,
        gridMe: GameBoard,
        callbacks: GameManagerCallbacks = {}
    ) {
        this.provider = provider
        this.signer = signer
        this.walletAddress = walletAddress
        this.contract = new Contract(provider, signer)
        this.callbacks = callbacks

        this.gridMe = gridMe
        this.gridEnemy = new GameBoard(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES)

        this.actionQueue = new MessageQueue<Action>()
        this.p2pQueue = new MessageQueue<P2PMessage>()

        const c = compiledCircuit as CompiledCircuit;
        const bytecode = c.bytecode;
        this.Backend = new UltraHonkBackend(bytecode, { threads: 4 });
        this.noir = new Noir(c);

        // Generate session key
        const _wallet = ethers.Wallet.createRandom()
        this.sessionKeyAddress = _wallet.address
        this.sessionKey = new SigningKey(_wallet.privateKey)
        this.log(`Creator session key: ${this.sessionKeyAddress}`)

        this.trysteroManager = new TrysteroManager();

    }

    private log(message: string) {
        console.log(`[GameManager] ${message}`)
        this.callbacks.onMessage?.(message)
    }

    private error(message: string) {
        console.error(`[GameManager] ${message}`)
        this.callbacks.onError?.(message)
    }

    // Helper method to notify my board update
    private notifyMyBoardUpdate() {
        const newBoard = new GameBoard(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES)
        newBoard.pos = [...this.gridMe.pos]
        newBoard.ships = this.gridMe.ships.map(s => [...s])
        this.callbacks.onMyBoardUpdate?.(newBoard)
    }

    // Helper method to notify enemy board update
    private notifyEnemyBoardUpdate() {
        const newBoard = new GameBoard(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES)
        newBoard.pos = [...this.gridEnemy.pos]
        newBoard.ships = this.gridEnemy.ships.map(s => [...s])
        this.callbacks.onEnemyBoardUpdate?.(newBoard)
    }

    private updateHashChain(status: HashChainData) {
        if (this.hashChain === null) {
            return;
        }
        if (
            this.hashChain.hashChainList.length === 1 &&
            this.hashChain.hashChainList[0].status === 'None'
        ) {
            this.hashChain.hashChainList[0].status = status.status;
        } else {
            this.hashChain.push(status);
        }
        this.updateGameViewStatus();
    }

    private getCurrentGameViewStatus(): GameViewStatus {
        let currentGameViewStatus: GameViewStatus = 'None';

        if (this.currentGameData !== null) {

            if (this.currentGameData.nextTurnState === NextTurnState.Completed) {
                currentGameViewStatus = 'Completed';
            } else {
                if (this.hashChain === null || this.hashChain.hashChainList.length === 0 ||
                    (this.hashChain.hashChainList.length === 1 && this.hashChain.hashChainList[0].status === 'None')
                ) {
                    if (this.currentGameData.nextTurnState === NextTurnState.Join) {
                        currentGameViewStatus = 'Joining';
                    } else if (this.currentGameData.nextTurnState === NextTurnState.RevealRandomness) {
                        currentGameViewStatus = 'RevealingRandomness';
                    } else if (this.currentGameData.nextTurnState === NextTurnState.CreatorFire) {
                        currentGameViewStatus = 'CreatorFire';
                    } else if (this.currentGameData.nextTurnState === NextTurnState.JoinerFire) {
                        currentGameViewStatus = 'JoinerFire';
                    } else if (this.currentGameData.nextTurnState === NextTurnState.CreatorReport) {
                        currentGameViewStatus = 'CreatorReport';
                    } else if (this.currentGameData.nextTurnState === NextTurnState.JoinerReport) {
                        currentGameViewStatus = 'JoinerReport';
                    }
                } else {
                    currentGameViewStatus = this.hashChain.hashChainList[this.hashChain.hashChainList.length - 1].status;
                }
            }
        }
        return currentGameViewStatus;
    }

    private updateGameViewStatus() {
        let isMyTurn = false;
        let friendlyStatus = '';
        const currentGameViewStatus = this.getCurrentGameViewStatus();
        switch (currentGameViewStatus) {
            case 'None':
                break;
            case 'Joining':
                isMyTurn = this.isCreator ? false : true;
                friendlyStatus = 'Waiting';
                break;
            case 'RevealingRandomness':
                isMyTurn = this.isCreator ? true : false;
                friendlyStatus = 'Revealing Randomness';
                break;
            case 'CreatorFire':
                isMyTurn = this.isCreator;
                friendlyStatus = 'Fire';
                break;
            case 'JoinerFire':
                isMyTurn = this.isJoiner;
                friendlyStatus = 'Fire';
                break;
            case 'CreatorReport':
                isMyTurn = this.isCreator;
                friendlyStatus = 'Report';
                break;
            case 'JoinerReport':
                isMyTurn = this.isJoiner;
                friendlyStatus = 'Report';
                break;
            case 'Completed':
                isMyTurn = false;
                friendlyStatus = 'Completed';
                break;
        }
        this.callbacks.onGameViewStatusChange?.(friendlyStatus, isMyTurn);
    }

    public enableAutoShoot(enable: boolean): void {
        if (enable && !this.autoShoot) {
            if (this.waitingForUserShoot === true) {
                this._autoShoot()
            }
        }
        this.autoShoot = enable;
    }
    public getAutoShoot(): boolean {
        return this.autoShoot;
    }

    private _autoShoot() {
        if (this.autoShoot) {
            const fireAt = this.gridEnemy.enemyRandomShoot();
            console.log(`I am ${this.isJoiner ? 'joiner' : 'creator'}, shoot at:${fireAt}`);
            this.actionQueue.put({
                type: 'SHOT',
                data: {
                    fireAt: fireAt
                }
            });
        }
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
        if (position < 0 || position >= this.gridEnemy.pos.length) {
            return false;
        }
        const a = this.gridEnemy.pos[position];
        if (a.posStatus !== PosStatus.Unknown) {
            return false;
        }
        this.waitingForUserShoot = false;
        this.callbacks.onShootEnabled?.(false);
        this.actionQueue.put({
            type: 'SHOT',
            data: {
                fireAt: position
            }
        });
    }

    initCreatorGameSalt() {
        // Generate board commitment
        this.boardSalt = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(30)))
            .map(b => b.toString(16).padStart(2, '0')).join('')
        // Generate randomness commitment
        this.randomnessSalt = new ethers.AbiCoder().encode(
            ['bytes32'],
            ['0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
                .map(b => b.toString(16).padStart(2, '0')).join('')]
        )
    }

    async preCreateGame(stake: bigint, getGameId: boolean): Promise<string> {
        this.isCreator = true
        this.isJoiner = false
        this.gotRandomnessRevealed = false;

        // Validate that board has been initialized (should be done by Random Generate Board button)
        if (!this.gridMe.isInitialized()) {
            throw new Error('Board not initialized. Please generate a board first using the Random Generate Board button.')
        }
        const boardCommitment = await this.gridMe.getPoseidonHash(BigInt(this.boardSalt))

        const randomnessCommitment = ethers.keccak256(this.randomnessSalt)
        if (getGameId === true) {
            // Get user balance
            const userBalance = await this.contract.getUserBalance(this.walletAddress)
            console.log(
                'bbb',
                randomnessCommitment,
                boardCommitment,
                stake,
                this.sessionKeyAddress,
            );
            return await this.contract.calculateGameId(
                randomnessCommitment,
                boardCommitment,
                stake,
                this.sessionKeyAddress,
                userBalance
            )
        } else {
            return "";
        }
    }

    // Create game
    async createGame(stake: bigint, gameId: string): Promise<'p2perror' | 'error' | 'success'> {
        try {
            await this.preCreateGame(stake, false);
            this.callbacks.onLoadingChange?.(true, 'P2P network connecting...')
            let p2pCheckPass = false;
            try {
                //const tm = TrysteroManager.getInstance();
                await this.trysteroManager.joinRoom(gameId);
                this.p2pQueue.put({ type: 'connect', data: undefined });
                this.trysteroManager.on('data', (peerId, data) => {
                    // #TODO Security check of peerId
                    if (data.type === 'p2p_test_ping') {
                        p2pCheckPass = true;
                    } else {
                        if (data.type !== 'connect') {
                            this.p2pQueue.put(data as P2PMessage)
                        }
                    }
                });

                for (let i = 0; i < (2 * 40); i++) {
                    if (p2pCheckPass) {
                        break;
                    }
                    await this.sleep(500)
                }
            } finally {
                this.callbacks.onLoadingChange?.(false, '')
            }
            if (p2pCheckPass === false) {
                // faild,alert
                this.error('P2P network connection failed. Please check your network or try again later.');
                this.trysteroManager.leave();
                return 'p2perror';
            }
            const boardCommitment = await this.gridMe.getPoseidonHash(BigInt(this.boardSalt))
            const randomnessCommitment = ethers.keccak256(this.randomnessSalt)
            // Get user balance
            const userBalance = await this.contract.getUserBalance(this.walletAddress)
            // Create game on contract
            this.callbacks.onLoadingChange?.(true, 'Creating game on blockchain...')
            try {
                this.currentGameData = await this.contract.createGame(
                    randomnessCommitment,
                    boardCommitment,
                    stake,
                    this.sessionKeyAddress,
                    userBalance
                )
                console.log(
                    'aaa',
                    randomnessCommitment,
                    boardCommitment,
                    stake,
                    this.sessionKeyAddress,
                );
                if (this.currentGameData.gameId !== gameId) {
                    throw new Error('Generated gameId mismatch!')
                }
            } finally {
                this.callbacks.onLoadingChange?.(false, '')
            }

            console.log('Game ID:', this.currentGameData.gameId);
            this.callbacks.onGameDataUpdate?.(this.currentGameData)
            this.callbacks.onGameStateChange?.(true)

            // Start game loop
            await this.startGameLoop()
            return 'success';

        } catch (error) {
            this.error(`Failed to create game: ${(error as Error).message}`)
            return 'error'
        }
    }

    // Join game
    async joinGame(gameData: GameData) {
        try {
            this.isCreator = false
            this.isJoiner = true
            this.joinStatus = 'NOT_JOINED';
            this.currentGameData = gameData
            this.gotRandomnessRevealed = false;


            // Validate that board has been initialized (should be done by Random Generate Board button)
            if (!this.gridMe.isInitialized()) {
                throw new Error('Board not initialized. Please generate a board first using the Random Generate Board button.')
            }

            // Generate board commitment
            this.boardSalt = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(30)))
                .map(b => b.toString(16).padStart(2, '0')).join('')
            // const boardCommitment = await this.gridMe.getPoseidonHash(BigInt(this.boardSalt))

            // Get creator's P2P UID
            //const creatorP2PUID = await this.contract.getGameP2PId(gameData);
            // this.log(`Connecting to creator: ${creatorP2PUID}`)

            // Initialize PeerJS

            //const tm = TrysteroManager.getInstance();
            await this.trysteroManager.joinRoom(this.currentGameData.gameId);
            this.p2pQueue.put({ type: 'connect', data: undefined });
            this.trysteroManager.on('data', (peerId, data) => {
                // #TODO Security check of peerId
                if (data.type !== 'connect') {
                    this.p2pQueue.put(data as P2PMessage)
                }
            });

            this.callbacks.onLoadingChange?.(true, 'Waiting for P2P connection...')
            try {
                while (true) {
                    const p = tm.getPeers();
                    if (Object.keys(p).length > 0) {
                        break;
                    }
                    console.log('Waiting for P2P connection to establish...');
                    await this.sleep(1000);
                }
            } finally {
                this.callbacks.onLoadingChange?.(false, '')
            }
            console.log('P2P connection established.');
            this.callbacks.onGameDataUpdate?.(this.currentGameData)
            this.callbacks.onGameStateChange?.(true)

            // Start game loop
            await this.startGameLoop()

        } catch (error) {
            this.error(`Failed to join game: ${(error as Error).message}`)
            throw error
        }
    }

    // Start game loop (player.ts run function)
    private async startGameLoop() {
        if (this.gameLoopRunning || !this.currentGameData) return

        this.gameLoopRunning = true

        // Initialize hash chain
        this.hashChain = new HashChain({
            hash: this.currentGameData.gameId,
            status: 'None',
            value: 0,
            proof: undefined,
            signature: '',
            hasInContract: true,
        })

        // Start event log monitor
        const contractAddress = Contract.getZKBattleshipAddress()
        const contractABI = Contract.getZKBattleshipABI()

        // Get current chain ID from the wallet provider
        const network = await this.provider.getNetwork()
        const chainId = Number(network.chainId)

        // Use public RPC provider for event monitoring (no rate limiting)
        const publicRpcUrl = getPublicRpcUrl(chainId)
        if (!publicRpcUrl) {
            throw new Error(`Unsupported network: chainId ${chainId}`)
        }

        this.log(`Using public RPC for event monitoring: ${publicRpcUrl}`)
        const publicProvider = new ethers.JsonRpcProvider(publicRpcUrl)

        this.logMonitor = new EventLogMonitor(contractAddress, contractABI, 2000, publicProvider as any)
        this.contractLogQueue = await this.logMonitor.start()

        this.log('Game loop started')

        // Main game loop
        this.runGameLoop()
    }

    private async runGameLoop() {
        while (this.gameLoopRunning && this.currentGameData) {
            await this.sleep(10)

            // Update game data from contract
            await this.fetchGameData(false)

            // Process actions
            await this.processActions()

            // Process contract events
            await this.processContractEvents()

            // Process P2P messages
            await this.processP2PMessages()

        }
    }

    private async fetchGameData(force: boolean) {
        if (!this.currentGameData) return

        const now = Date.now()
        if (force || (now - this.lastGameDataUpdate > 5000)) {
            this.currentGameData = await this.contract.getGameData(this.currentGameData.gameId)
            this.lastGameDataUpdate = now
            this.callbacks.onGameDataUpdate?.(this.currentGameData)

            // Check for timeouts and cheating
            await this.gameMonitor()
        }
    }

    private async gameMonitor() {
        // // debugger
        // return;
        if (!this.currentGameData || !this.hashChain) return

        const now = Date.now() / 1000
        const lastActiveTimestamp = Number(this.currentGameData.lastActiveTimestamp)

        // Check for timeout conditions
        let tryOpponentLeave = false
        let updateGameStatus = false

        if (this.isCreator) {
            if (this.currentGameData.nextTurnState === NextTurnState.CreatorFire ||
                this.currentGameData.nextTurnState === NextTurnState.CreatorReport) {
                if (now - (lastActiveTimestamp - 10) >= ROUND_TIME_LIMIT) {
                    updateGameStatus = true
                }
            } else if (this.currentGameData.nextTurnState === NextTurnState.JoinerFire ||
                this.currentGameData.nextTurnState === NextTurnState.JoinerReport) {
                if (now - lastActiveTimestamp >= ROUND_TIME_LIMIT) {
                    tryOpponentLeave = true
                }
            }
        } else {
            if (this.currentGameData.nextTurnState === NextTurnState.RevealRandomness) {
                if (now - lastActiveTimestamp >= REVEAL_RANDOMNESS_LIMIT) {
                    tryOpponentLeave = true
                }
            }
            if (this.currentGameData.nextTurnState === NextTurnState.JoinerFire ||
                this.currentGameData.nextTurnState === NextTurnState.JoinerReport) {
                if (now - (lastActiveTimestamp - 10) >= ROUND_TIME_LIMIT) {
                    updateGameStatus = true
                }
            } else if (this.currentGameData.nextTurnState === NextTurnState.CreatorFire ||
                this.currentGameData.nextTurnState === NextTurnState.CreatorReport) {
                if (now - lastActiveTimestamp >= ROUND_TIME_LIMIT) {
                    tryOpponentLeave = true
                }
            }
        }

        if (tryOpponentLeave) {
            this.actionQueue.put({ type: 'TRY_OPPONENT_LEAVE', data: {} })
        }
        if (updateGameStatus) {
            this.actionQueue.put({ type: 'UPDATE_GAME_STATUS', data: {} })
        }
    }
    private async processContractEvents() {
        if (!this.contractLogQueue) return
        let eventLog = await this.contractLogQueue.get()
        while (eventLog !== undefined) {
            if (eventLog === 'separator') {
                await this.fetchGameData(true);
                this.updateGameViewStatus();
            } else {
                console.log(`Processing contract event: ${eventLog.name}`);
                switch (eventLog.name) {
                    case 'GameCreated':
                        break;
                    case 'GameJoined':
                        if (this.isCreator) {
                            this.actionQueue.put({
                                type: 'REVEAL_SALT',
                                data: {}
                            });
                        }
                        break;
                    case 'RandomnessRevealed':
                        {
                            let actorIsCreator = true;
                            if ((eventLog.args[1] as string).toLowerCase() === this.walletAddress.toLowerCase()) {
                                actorIsCreator = this.isCreator ? true : false;
                                this.actionQueue.put({
                                    type: 'WAITING_FOR_SHOOT',
                                    data: {}
                                });
                            } else {
                                actorIsCreator = this.isCreator ? false : true;
                            }
                            if (this.hashChain!.hashChainList.length === 1 && this.hashChain!.hashChainList[0].status === 'None') {
                                this.updateHashChain({
                                    status: actorIsCreator ? 'CreatorFire' : 'JoinerFire',
                                    value: 0,
                                    proof: undefined,
                                    signature: '',
                                    hasInContract: false,

                                });
                            }
                            this.gotRandomnessRevealed = true;
                        }
                        break;
                    case 'GameClosed':
                        this.actionQueue.put({
                            type: 'GAME_CLOSED',
                            data: {}
                        });
                        break;
                    case 'ShotFired':
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
                            const attackerIsMe = attacker === this.walletAddress.toLowerCase();

                            const _data: ActionData_Shot = {
                                mergeEnd: 0,
                                fromContract: true,
                                statusHash: eventLog.args[3],
                                position: Number(eventLog.args[2]),
                                signature: ''
                            };
                            this.actionQueue.put({
                                type: attackerIsMe ? 'SELF_SHOT' : 'ENEMY_SHOT',
                                data: _data
                            });
                        }
                        break;
                    case 'ResultReported':
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
                            const defenderIsMe = defender === this.walletAddress.toLowerCase();

                            const result: ShotResult = {
                                shotStatus: Number(eventLog.args[3][0]),
                                sunkHeadPosition: Number(eventLog.args[3][1]),
                                sunkEndPosition: Number(eventLog.args[3][2])
                            };
                            const _data: ActionData_Report = {
                                mergeEnd: 0,
                                fromContract: true,
                                statusHash: eventLog.args[4],
                                position: Number(eventLog.args[2]),
                                shotResult: result,
                                signature: '',
                                poof: ''
                            }
                            this.actionQueue.put({
                                type: defenderIsMe ? 'SELF_REPORT' : 'ENEMY_REPORT',
                                data: _data
                            });
                        }
                        break;
                    case 'GameEnded':
                        // event GameEnded(bytes32 indexed gameId, address indexed winner);
                        const winner = eventLog.args[1].toLowerCase();
                        this.actionQueue.put({
                            type: 'GAME_END',
                            data: {
                                winner: winner
                            }
                        });
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

    private async processP2PMessages() {
        const p2pMsg = await this.p2pQueue.get()
        if (!p2pMsg || !this.currentGameData) return
        this.log(`P2P message: ${p2pMsg.type}`)
        switch (p2pMsg.type) {
            case 'connect':
                if (this.isJoiner) {
                    this.actionQueue.put({
                        type: 'REQUEST_CREATOR_SIGNATURE',
                        data: {}
                    });
                }
                break;
            case 'requestCreatorSignature':
                if (this.isCreator) {
                    if (p2pMsg.data.gameId === this.currentGameData.gameId) {
                        const _data: ActionData_SignCreatorSignature = {
                            gameId: this.currentGameData.gameId,
                            walletAddress: p2pMsg.data.myWalletAddress
                        };
                        this.actionQueue.put({
                            type: 'SIGN_CREATOR_SIGNATURE',
                            data: _data
                        });
                    }
                }
                break;
            case 'creatorSignature':
                if (this.isJoiner) {
                    const _data: ActionData_Join = {
                        endTime: p2pMsg.data.endTime,
                        creatorSignature: p2pMsg.data.signature
                    }

                    const _endTime = Math.floor(Date.now() / 1000) - 5;
                    if (_data.endTime > _endTime) {
                        console.error('creatorSignature will expire soon');
                    }

                    // verfy signature
                    const _hash = ethers.keccak256(ethers.solidityPacked(
                        ["bytes32", "uint256", "address"],
                        [this.currentGameData.gameId, _data.endTime, this.walletAddress]
                    ));
                    const recoveredAddress = ethers.recoverAddress(_hash, _data.creatorSignature).toLowerCase();
                    if (recoveredAddress !== this.currentGameData.creatorSessionKey.toLowerCase()
                    ) {
                        console.error('verify signature failed');
                    } else {
                        this.actionQueue.put({
                            type: 'JOIN',
                            data: _data
                        });
                    }
                }
                break;
            case 'shot':
                {
                    if (this.hashChain!.hashChainList[0].status === 'None') {
                        await this.fetchGameData(true);
                        if (this.currentGameData.currentGameStatusHash === this.currentGameData.gameId) {
                            for (let i = 0; i < 6; i++) {
                                if (i === 6) {
                                    debugger;
                                    throw new Error('error');
                                }
                                if (this.currentGameData.nextTurnState === NextTurnState.JoinerFire ||
                                    this.currentGameData.nextTurnState === NextTurnState.CreatorFire) {
                                    break;
                                }
                                // update
                                await this.sleep(300);
                                await this.fetchGameData(true);
                            }
                            if (
                                this.hashChain!.hashChainList.length !== 1 ||
                                this.hashChain!.hashChainList[0].status !== 'None') {
                                throw new Error('error');
                            }
                            this.updateHashChain({
                                status: (
                                    this.currentGameData.nextTurnState === NextTurnState.CreatorFire ? 'CreatorFire' : 'JoinerFire'
                                ),
                                value: 0,
                                proof: undefined,
                                signature: '',
                                hasInContract: false,
                            });



                        } else {
                            // error
                            debugger;
                            throw new Error('error');
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
                        signature: p2pMsg.data.signature
                    };
                    this.actionQueue.put({
                        type: 'ENEMY_SHOT',
                        data: _data

                    });
                }
                break;
            case 'report':
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
                        poof: p2pMsg.data.poof
                    };
                    this.actionQueue.put({
                        type: 'ENEMY_REPORT',
                        data: _data
                    });
                }
                break;
            case 'surrender':
                {
                    const enemySignature = p2pMsg.data as string;
                    // verify
                    const _hash = ethers.keccak256(ethers.solidityPacked(
                        ["bytes32", "string"],
                        [this.currentGameData.gameId, 'I surrender']
                    ));
                    const recoveredAddress = ethers.recoverAddress(_hash, enemySignature).toLowerCase();
                    if (recoveredAddress !==
                        (this.isCreator ? this.currentGameData.joinerSessionKey : this.currentGameData.creatorSessionKey).toLowerCase()
                    ) {
                        console.error('verify signature failed');
                    } else {
                        const _data: ActionData_EnemySurrender = {
                            enemySignature: enemySignature
                        };
                        this.actionQueue.put({
                            type: 'ENEMY_SURRENDER',
                            data: _data
                        });
                    }

                }
                break;
            default:
                throw new Error('error');
        }

    }

    private _timer_request_creator_sign: NodeJS.Timeout | undefined = undefined;

    private async processActions() {
        let action = await this.actionQueue.get()
        if (!action || !this.currentGameData || !this.sessionKey) return

        this.log(`Processing action: ${action.type}`)

        //const tm = TrysteroManager.getInstance();

        while (action !== undefined) {
            console.log(`${this.isCreator ? 'creator' : 'joiner'}: ${action.type}`);
            switch (action.type) {
                case 'GAME_CLOSED':
                    {

                    }
                    break;
                case 'REVEAL_SALT':
                    {
                        await this.contract.sendZKBattleshipTx(
                            'revealRandomness',
                            this.currentGameData.gameId,
                            this.randomnessSalt
                        );
                    }
                    break;
                case 'REQUEST_CREATOR_SIGNATURE':
                    {
                        this._timer_request_creator_sign = setTimeout(() => {
                            this._timer_request_creator_sign = undefined;
                            this.actionQueue.put({
                                type: 'REQUEST_CREATOR_SIGNATURE',
                                data: {}
                            });
                        }, 300);

                        tm.send({
                            type: 'requestCreatorSignature',
                            data: {
                                gameId: this.currentGameData.gameId,
                                myWalletAddress: this.walletAddress
                            }
                        });
                    }
                    break;
                case 'SIGN_CREATOR_SIGNATURE':
                    {
                        const data = action.data as ActionData_SignCreatorSignature;
                        //    bytes32 _hash = keccak256(abi.encodePacked(gameId, endTime, msg.sender));
                        const endTime = Math.floor(Date.now() / 1000) + 30/* 30s */;
                        const _hash = ethers.keccak256(ethers.solidityPacked(
                            ["bytes32", "uint256", "address"],
                            [data.gameId, endTime, data.walletAddress]
                        ));
                        const signature = this.sessionKey.sign(_hash).serialized;

                        this.trysteroManager.send({
                            type: 'creatorSignature',
                            data: {
                                endTime: endTime,
                                signature: signature
                            }
                        });
                    }
                    break;
                case 'JOIN':
                    {
                        if (this._timer_request_creator_sign !== undefined) {
                            clearTimeout(this._timer_request_creator_sign);
                            this._timer_request_creator_sign = undefined;
                        }
                        if (this.joinStatus === 'NOT_JOINED') {
                            this.joinStatus = 'JOINING';
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
                            const userBalance = await this.contract.getUserBalance(this.walletAddress)
                            const boardCommitment = await this.gridMe.getPoseidonHash(BigInt(this.boardSalt))
                            const re = await this.contract.joinGame(
                                this.currentGameData.gameId,
                                boardCommitment,
                                this.currentGameData.stake,
                                this.sessionKeyAddress,
                                data.endTime,
                                data.creatorSignature,
                                userBalance
                            );
                            if (re === false) {
                                console.error('join game failed');
                                this.joinStatus = 'NOT_JOINED';
                                debugger
                            } else {
                                this.joinStatus = 'JOINED';
                            }
                        }
                    }
                    break;
                case 'WAITING_FOR_SHOOT':
                    {
                        if (this.autoShoot) {
                            this._autoShoot()
                        } else {
                            // Notify UI to enable shoot action
                            this.enableShoot();
                        }
                    }
                    break;
                case 'SHOT':
                    {
                        const _data = action.data as ActionData_ShootAt;
                        const fireAt = _data.fireAt;
                        const nextStatusHash = this.hashChain!.getNextStatusHash(fireAt);
                        const signature = this.sessionKey.sign(nextStatusHash).serialized;
                        const status = this.hashChain!.getNextStatus();
                        if (this.isCreator) {
                            if (status !== 'CreatorFire') {
                                throw new Error('err');
                            }
                        } else {
                            if (status !== 'JoinerFire') {
                                throw new Error('err');
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
                            this.gridEnemy.enemySaveShoot(
                                fireAt, null
                            );
                        }

                        if (true/* when P2P is available */) {

                            this.trysteroManager.send({
                                type: 'shot',
                                data: {
                                    statusHash: nextStatusHash,
                                    position: fireAt,
                                    signature: signature
                                }
                            });

                        } else {
                            // #TODO
                        }
                    }
                    break;
                case 'REPORT':
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

                        const nextStatusHash = this.hashChain!.getNextStatusHash(data.shotResult);
                        const nextStatus = this.hashChain!.getNextStatus();
                        if (this.isCreator) {
                            if (nextStatus !== 'CreatorReport') {
                                throw new Error('err');
                            }
                        } else {
                            if (nextStatus !== 'JoinerReport') {
                                throw new Error('err');
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
                        if (true/* when P2P is available */) {
                            this.trysteroManager.send({
                                type: 'report',
                                data: {
                                    statusHash: nextStatusHash,
                                    position: data.position,
                                    shotResult: data.shotResult,
                                    signature: signature,
                                    poof: data.poof
                                }
                            });
                        } else {
                            // #TODO
                        }
                        // Notify UI of board updates
                        this.notifyMyBoardUpdate();
                        this.notifyEnemyBoardUpdate();
                    }
                    break;
                case 'SELF_SHOT':
                case 'ENEMY_SHOT':
                    {
                        const data = action.data as ActionData_Shot;
                        if (action.type === 'SELF_SHOT') {

                        } else {
                            if (this.gotRandomnessRevealed === false) {
                                console.warn('waiting for randomness revealed');
                                // waiting this.gotRandomnessRevealed=true
                                setTimeout(() => {
                                    this.actionQueue.put({
                                        type: 'ENEMY_SHOT',
                                        data: data
                                    });
                                }, 500);
                            } else {
                                let verify = true;
                                if (data.fromContract === false) {
                                    // verify signature
                                    const recoveredAddress = ethers.recoverAddress(data.statusHash, data.signature).toLowerCase();
                                    if (recoveredAddress !==
                                        (this.isCreator ? this.currentGameData.joinerSessionKey : this.currentGameData.creatorSessionKey).toLowerCase()
                                    ) {
                                        console.error('verify signature failed');
                                        verify = false;
                                    }
                                }

                                if (verify) {
                                    const nextStatusHash = this.hashChain!.getNextStatusHash(data.position);
                                    const nextStatus = this.hashChain!.getNextStatus();
                                    if (nextStatusHash.toLowerCase() === data.statusHash.toLowerCase()) {
                                        if (data.mergeEnd != 0) {
                                            console.log('merged status hash');
                                        }
                                        if (this.isCreator) {
                                            if (nextStatus !== 'JoinerFire') {
                                                debugger;
                                                throw new Error('err');
                                            }
                                        } else {
                                            if (nextStatus !== 'CreatorFire') {
                                                debugger;
                                                throw new Error('err');
                                            }
                                        }
                                        this.updateHashChain({
                                            status: nextStatus,
                                            value: data.position,
                                            proof: undefined,
                                            signature: data.signature,
                                            hasInContract: data.fromContract,
                                        });
                                        // update bin grid
                                        const board = this.gridMe.getBoardBin();
                                        const shotResult = this.gridMe.firedAt(data.position);
                                        const pub_input: bigint =
                                            (BigInt(shotResult.sunkHeadPosition) << BigInt(48)) +
                                            (BigInt(shotResult.sunkEndPosition) << BigInt(56)) +
                                            (board << BigInt(12)) +
                                            (BigInt(data.position) << BigInt(4)) +
                                            BigInt(shotResult.shotStatus);
                                        const inputMap: InputMap = {
                                            cruiser: this.gridMe.ships[0],
                                            destroyer: this.gridMe.ships[1],
                                            submarine: this.gridMe.ships[2][0],
                                            salt: this.boardSalt,
                                            expected_hash: await this.gridMe.getPoseidonHash(BigInt(this.boardSalt)),
                                            pub_input: pub_input.toString()
                                        };
                                        const { witness } = await this.noir.execute(inputMap);
                                        const proofData: ProofData = await this.Backend.generateProof(witness, {
                                            keccak: true
                                        });
                                        const proofBytes = '0x' + Buffer.from(proofData.proof).toString('hex');
                                        const verify = await this.Backend.verifyProof(proofData, {
                                            keccak: true
                                        })
                                        if (verify === false) {
                                            throw new Error('verifyProof failed');
                                        }
                                        this.gridMe.firedAt(data.position, true);
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
                                            type: 'REPORT',
                                            data: _data
                                        });

                                        // check result
                                        if (this.gridMe.countHitShips() >= DEFAULT_GRID_SIZE) {
                                            // enemy win
                                            this.actionQueue.put({
                                                type: 'SELF_SURRENDER',
                                                data: {}
                                            });
                                        } else {
                                            // shot
                                            this.actionQueue.put({
                                                type: 'WAITING_FOR_SHOOT',
                                                data: {}
                                            });
                                        }
                                    } else if (this.hashChain!.include(data.statusHash)) {
                                        // skip
                                        // console.log('skip statusHash');
                                    } else {
                                        // merge
                                        let canMerge = true;
                                        if (data.mergeEnd == 0) {
                                            // first time
                                            const mergeLimit = (blockTime * 3) < 1000 * 10 ? 1000 * 10 : (blockTime * 3);
                                            data.mergeEnd = Date.now() + mergeLimit;
                                        } else if (data.mergeEnd < Date.now()) {
                                            // can merge
                                        } else {
                                            // discard packet
                                            canMerge = false;
                                        }
                                        if (canMerge) {
                                            console.log('waiting for merge statusHash');
                                            setTimeout(() => {
                                                this.actionQueue.put({
                                                    type: 'ENEMY_SHOT',
                                                    data: data
                                                });
                                            }, 1000);
                                        }
                                    }
                                }
                            }
                        }
                        // update this.hashChain!.hasInContract flag
                        if (data.fromContract === true) {
                            let flag = false;
                            for (let _i = this.hashChain!.hashChainList.length - 1; _i >= 0; _i--) {
                                if (this.hashChain!.hashChainList[_i].hash.toLowerCase() === data.statusHash.toLowerCase()) {
                                    flag = true;
                                }
                                if (flag) {
                                    this.hashChain!.hashChainList[_i].hasInContract = true;
                                }
                            }
                        }
                    }
                    break;
                case 'SELF_REPORT':
                case 'ENEMY_REPORT':
                    {
                        const data = action.data as ActionData_Report;
                        let verify = true;
                        if (action.type === 'SELF_REPORT') {

                        } else {
                            if (data.fromContract === false) {
                                // verify signature
                                const recoveredAddress = ethers.recoverAddress(data.statusHash, data.signature).toLowerCase();
                                if (recoveredAddress !==
                                    (this.isCreator ? this.currentGameData.joinerSessionKey : this.currentGameData.creatorSessionKey).toLowerCase()
                                ) {
                                    console.error('verify signature failed');
                                    verify = false;
                                }
                            }
                            if (verify) {
                                const nextStatusHash = this.hashChain!.getNextStatusHash(data.shotResult);
                                const nextStatus = this.hashChain!.getNextStatus();
                                if (nextStatusHash.toLowerCase() === data.statusHash.toLowerCase()) {
                                    if (this.isCreator) {
                                        if (nextStatus !== 'JoinerReport') {
                                            throw new Error('err');
                                        }
                                    } else {
                                        if (nextStatus !== 'CreatorReport') {
                                            throw new Error('err');
                                        }
                                    }
                                    if (data.fromContract === false) {
                                        // verify proof
                                        const board = this.gridEnemy.getBoardBin();
                                        const pub_input: bigint =
                                            (BigInt(data.shotResult.sunkHeadPosition) << BigInt(48)) +
                                            (BigInt(data.shotResult.sunkEndPosition) << BigInt(56)) +
                                            (board << BigInt(12)) +
                                            (BigInt(data.position) << BigInt(4)) +
                                            BigInt(data.shotResult.shotStatus);
                                        const proofData: ProofData = {
                                            proof: Uint8Array.from(
                                                Buffer.from(data.poof.startsWith('0x') ? data.poof.slice(2) : data.poof, 'hex')
                                            ),
                                            publicInputs: [
                                                this.isCreator ? this.currentGameData.joinerBoardCommitment : this.currentGameData.creatorBoardCommitment,
                                                '0x' + pub_input.toString(16).padStart(64, '0')
                                            ]
                                        }
                                        try {
                                            const _verify = await this.Backend.verifyProof(proofData, {
                                                keccak: true
                                            });
                                            if (_verify === false) {
                                                console.error('verifyProof failed');
                                                verify = false;
                                            }
                                        } catch (error) {
                                            verify = false;
                                            console.error('verifyProof failed', error);
                                        }

                                    }
                                    if (verify) {
                                        if (data.mergeEnd != 0) {
                                            console.log('merged status hash');
                                        }
                                        this.updateHashChain({
                                            status: nextStatus,
                                            value: data.shotResult,
                                            proof: data.fromContract ? undefined : data.poof,
                                            signature: data.signature,
                                            hasInContract: data.fromContract,
                                        });

                                        this.gridEnemy.enemySaveShoot(
                                            data.position, data.shotResult
                                        );
                                        // Notify UI of enemy board update
                                        this.notifyEnemyBoardUpdate();
                                        if (this.gridEnemy.countHitShips() >= DEFAULT_GRID_SIZE) {
                                            // win, waiting surrender, submit status myself if waiting for >3s
                                            // SELF_SUBMIT_WIN_PROOF
                                            if (this.self_submit_win_poof_handler === undefined) {
                                                this.self_submit_win_poof_handler = setTimeout(() => {
                                                    this.actionQueue.put({
                                                        type: 'SELF_SUBMIT_WIN_PROOF',
                                                        data: {}
                                                    });
                                                }, 3000);
                                            }
                                        }
                                        // Notify UI of board updates
                                        this.notifyMyBoardUpdate();
                                        this.notifyEnemyBoardUpdate();
                                    }

                                } else if (this.hashChain!.include(data.statusHash)) {
                                    // skip
                                    // console.log('skip statusHash');
                                } else {
                                    // merge
                                    let canMerge = true;
                                    if (data.mergeEnd == 0) {
                                        // first time
                                        const mergeLimit = (blockTime * 3) < 1000 * 10 ? 1000 * 10 : (blockTime * 3);
                                        data.mergeEnd = Date.now() + mergeLimit;
                                    } else if (data.mergeEnd < Date.now()) {
                                        // can merge
                                    } else {
                                        // discard packet
                                        canMerge = false;
                                    }
                                    if (canMerge) {
                                        console.log('waiting for merge statusHash');
                                        setTimeout(() => {
                                            this.actionQueue.put({
                                                type: 'ENEMY_REPORT',
                                                data: data
                                            });
                                        }, 200);
                                    }
                                }
                            }
                        }

                        if (verify) {
                            // update this.hashChain!.hasInContract flag
                            if (data.fromContract === true) {
                                let flag = false;
                                for (let _i = this.hashChain!.hashChainList.length - 1; _i >= 0; _i--) {
                                    if (this.hashChain!.hashChainList[_i].hash.toLowerCase() === data.statusHash.toLowerCase()) {
                                        flag = true;
                                    }
                                    if (flag) {
                                        this.hashChain!.hashChainList[_i].hasInContract = true;
                                    }
                                }
                            }
                        }
                    }
                    break;
                case 'SELF_SURRENDER':
                    {
                        // bytes32 _hash = keccak256(abi.encodePacked(gameId, "I surrender"));
                        const _hash = ethers.keccak256(ethers.solidityPacked(
                            ["bytes32", "string"],
                            [this.currentGameData.gameId, 'I surrender']
                        ));
                        const signature = this.sessionKey.sign(_hash).serialized;
                        if (true/* when P2P is available */) {
                            this.trysteroManager.send({
                                type: 'surrender',
                                data: signature
                            });
                        } else {
                            // #TODO
                        }
                    }
                    break;
                case 'ENEMY_SURRENDER':
                    {
                        if (this.self_submit_win_poof_handler !== undefined) {
                            clearTimeout(this.self_submit_win_poof_handler);
                            this.self_submit_win_poof_handler = undefined;
                        }
                        const data = action.data as ActionData_EnemySurrender;
                        await this.contract.sendZKBattleshipTx('surrender', this.currentGameData.gameId, data.enemySignature);
                        //this.currentGameData = await this.getGameData(currentGameData.gameId);
                        // if (currentGameData.nextTurnState !== NextTurnState.Completed) {
                        //     throw new Error('error');
                        // }
                    }
                    break;
                case 'GAME_END':
                    {
                        if (this.self_submit_win_poof_handler !== undefined) {
                            clearTimeout(this.self_submit_win_poof_handler);
                            this.self_submit_win_poof_handler = undefined;
                        }
                        const data = action.data as ActionData_GameEnd;
                        const isWinner = data.winner.toLowerCase() === this.walletAddress.toLowerCase();
                        if (isWinner) {
                            console.log(`I'm ${this.isCreator ? 'creator' : 'joiner'}, I win!`);
                        } else {
                            console.log(`I'm ${this.isCreator ? 'creator' : 'joiner'}, I lose!`);
                        }
                        // Notify UI about game end with result
                        this.callbacks.onGameEnd?.(isWinner);
                        // Don't call stopGame here - let UI handle it after showing animation
                        return;
                    }
                    break;
                case 'TRY_OPPONENT_LEAVE':
                    await this.contract.opponentLeave(this.currentGameData.gameId);
                    break;
                case 'UPDATE_GAME_STATUS':
                    {
                        const onlinehash = this.currentGameData.currentGameStatusHash.toLowerCase();
                        let index_from = 0;
                        let index_end_a = 0;
                        let index_end_b = 0;
                        if (this.hashChain!.hashChainList.length > 1) {
                            for (let i = 0; i < this.hashChain!.hashChainList.length; i++) {
                                if (this.hashChain!.hashChainList[i].hash.toLowerCase() === onlinehash) {
                                    if (this.hashChain!.hashChainList.length > i + 1) {
                                        index_from = i + 1;
                                    }
                                    break;
                                }
                            }
                            if (index_from > 0) {
                                for (let i = this.hashChain!.hashChainList.length - 1; i >= index_from; i--) {
                                    if (this.hashChain!.hashChainList[i].status === (this.isCreator ? 'JoinerReport' : 'CreatorReport')) {
                                        index_end_a = i;
                                        break;
                                    }
                                }
                                for (let i = this.hashChain!.hashChainList.length - 1; i >= index_from; i--) {
                                    if (this.hashChain!.hashChainList[i].status === (this.isCreator ? 'JoinerFire' : 'CreatorFire')) {
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
                                const status = this.hashChain!.hashChainList[index_from].status;
                                if (status === (this.isCreator ? 'CreatorReport' : 'JoinerReport')) {
                                    // reportShotResult
                                    use_zkproof = true;
                                } else {
                                    // submitGameStatus
                                    index_end = index_from;
                                }
                            }
                            if (use_zkproof) {
                                const item = this.hashChain!.hashChainList[index_from];
                                const result = await this.contract.reportShotResult(
                                    this.currentGameData.gameId,
                                    onlinehash,
                                    item.value as ShotResult,
                                    item.proof as string
                                );
                                // if (!result) {
                                //     const a1 = await this.getGameData(currentGameData.gameId);
                                //     console.log(a1);
                                //     console.log(item);
                                //     debugger;
                                // }
                            } else {
                                const gameStatus: number[] = [];
                                let sessionKeySignature = '0x';
                                for (let i = index_from; i <= index_end; i++) {
                                    const item = this.hashChain!.hashChainList[i];
                                    if (index_end === i) {
                                        if (item.status == 'CreatorFire' || item.status == 'CreatorReport') {
                                            if (this.isJoiner) {
                                                sessionKeySignature = item.signature;
                                            }
                                        } else {
                                            if (this.isCreator) {
                                                sessionKeySignature = item.signature;
                                            }
                                        }
                                    }
                                    gameStatus.push(typeof (item.value) === 'number' ? item.value : item.value.shotStatus);
                                }
                                await this.contract.submitGameStatus(this.currentGameData.gameId, onlinehash, gameStatus, sessionKeySignature);
                            }
                        }

                    }
                    break;
                case 'SELF_SUBMIT_WIN_PROOF':
                    {
                        await this.fetchGameData(true);
                        this.self_submit_win_poof_handler = undefined;
                        const gameStatus: number[] = [];
                        let start = false;
                        let sessionKeySignature = '0x';
                        for (let i = 1; i < this.hashChain!.hashChainList.length; i++) {
                            const item = this.hashChain!.hashChainList[i];
                            if (start) {
                                if (i === this.hashChain!.hashChainList.length - 1) {
                                    if (item.status == 'CreatorFire' || item.status == 'CreatorReport') {
                                        if (this.isJoiner) {
                                            sessionKeySignature = item.signature;
                                        }
                                    } else {
                                        if (this.isCreator) {
                                            sessionKeySignature = item.signature;
                                        }
                                    }
                                }
                                gameStatus.push(typeof (item.value) === 'number' ? item.value : item.value.shotStatus);
                            }
                            if (item.hash.toLowerCase() == this.currentGameData.currentGameStatusHash.toLowerCase()) {
                                start = true;
                            }
                        }
                        await this.contract.submitGameStatus(this.currentGameData.gameId, this.currentGameData.currentGameStatusHash, gameStatus, sessionKeySignature);
                    }
                    break;
                case 'REPORT_CHEATING':
                    {
                        const data = action.data as ActionData_ReportCheating;
                        await this.contract.reportCheating(this.currentGameData.gameId, data.firePosition, data.signature);
                    }
                    break;
                default:
                    throw new Error('error');
            }
            await this.sleep(1);
            action = await this.actionQueue.get();
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    // Stop game
    async stopGame() {
        this.gameLoopRunning = false
        // TrysteroManager.getInstance().leave();
        this.trysteroManager.leave();
        if (this._timer_request_creator_sign !== undefined) {
            clearTimeout(this._timer_request_creator_sign);
            this._timer_request_creator_sign = undefined;
        }
        this.logMonitor?.pause();
        this.callbacks.onGameStateChange?.(false)
        this.log('Game stopped')
    }

    // Get current game state
    getGameData(): GameData | null {
        return this.currentGameData
    }

    isInGame(): boolean {
        return this.gameLoopRunning && this.currentGameData !== null
    }
}
