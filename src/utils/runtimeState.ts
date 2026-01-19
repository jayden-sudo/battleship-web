import { GameBoard } from "./gameBoard"
import { HashChain } from "./hashChain"
import { ON_GAMEBOARD_UPDATE, ON_HASHCHAIN_UPDATE } from './eventBus'

export class RuntimeState {
    private dataUpdateHandleEvent: (e: Event) => void;

    _autoSave = false;

    _gameId?: string = undefined;
    _walletAddress: string
    _gridMe: GameBoard
    _gridEnemy: GameBoard
    _isJoiner: boolean
    _isCreator: boolean
    _sessionKeyAddress: string;
    _sessionKeyPrivateKey: string
    _boardSalt: string
    _randomnessSalt: string
    _gotRandomnessRevealed: boolean = false
    _joinStatus: "NOT_JOINED" | "JOINING" | "JOINED" = 'NOT_JOINED'
    _hashChain: HashChain | null
    _lastBlock: number = 0;

    constructor(
        walletAddress: string,
        gridMe: GameBoard,
        gridEnemy: GameBoard,
        isJoiner: boolean,
        isCreator: boolean,
        sessionKeyAddress: string,
        sessionKeyPrivateKey: string,
        boardSalt: string,
        randomnessSalt: string,
        hashChain: HashChain | null
    ) {
        this._walletAddress = walletAddress
        this._gridMe = gridMe
        this._gridEnemy = gridEnemy
        this._isCreator = isCreator
        this._isJoiner = isJoiner
        this._sessionKeyAddress = sessionKeyAddress
        this._sessionKeyPrivateKey = sessionKeyPrivateKey
        this._boardSalt = boardSalt
        this._randomnessSalt = randomnessSalt
        this._hashChain = hashChain


        this.dataUpdateHandleEvent = this.onDataUpdate.bind(this);
        window.addEventListener(ON_GAMEBOARD_UPDATE, this.dataUpdateHandleEvent);
        window.addEventListener(ON_HASHCHAIN_UPDATE, this.dataUpdateHandleEvent);
    }

    public destroy() {
        window.removeEventListener(ON_GAMEBOARD_UPDATE, this.dataUpdateHandleEvent);
        window.removeEventListener(ON_HASHCHAIN_UPDATE, this.dataUpdateHandleEvent);
    }

    public static fromJson(jsonStr: string): RuntimeState {
        const json = JSON.parse(jsonStr);
        const state = new RuntimeState(
            json.walletAddress as string,
            GameBoard.fromJson(json.gridMe as string),
            GameBoard.fromJson(json.gridEnemy as string),
            json.isJoiner as boolean,
            json.isCreator as boolean,
            json.sessionKeyAddress as string,
            json.sessionKeyPrivateKey as string,
            json.boardSalt as string,
            json.randomnessSalt as string,
            json.hashChain ? HashChain.fromJson(json.hashChain as string) : null
        );
        return state
    }

    private onDataUpdate(e?: Event) {
        if (this._autoSave && this._gameId) {
            const json = JSON.stringify({
                gameId: this._gameId,
                walletAddress: this._walletAddress,
                gridMe: JSON.stringify(this._gridMe),
                gridEnemy: JSON.stringify(this._gridEnemy),
                isJoiner: this._isJoiner,
                isCreator: this._isCreator,
                sessionKeyAddress: this._sessionKeyAddress,
                sessionKeyPrivateKey: this._sessionKeyPrivateKey,
                boardSalt: this._boardSalt,
                randomnessSalt: this._randomnessSalt,
                gotRandomnessRevealed: this._gotRandomnessRevealed,
                joinStatus: this._joinStatus,
                hashChain: JSON.stringify(this._hashChain),
                lastBlock: this._lastBlock,
            });
        }
    }

    public startAutoSave(gameId: string) {
        this._gameId = gameId;
        this._autoSave = true;
    }

    set lastBlock(lastBlock: number) {
        this._lastBlock = lastBlock
        this.onDataUpdate();
    }

    get walletAddress(): string {
        return this._walletAddress
    }
    set walletAddress(value: string) {
        this._walletAddress = value
        this.onDataUpdate();
    }

    get gridMe(): GameBoard {
        return this._gridMe
    }
    set gridMe(value: GameBoard) {
        this._gridMe = value
        this.onDataUpdate();
    }

    get gridEnemy(): GameBoard {
        return this._gridEnemy
    }
    set gridEnemy(value: GameBoard) {
        this._gridEnemy = value
        this.onDataUpdate();
    }

    get isJoiner(): boolean {
        return this._isJoiner
    }
    set isJoiner(value: boolean) {
        this._isJoiner = value
        this.onDataUpdate();
    }

    get isCreator(): boolean {
        return this._isCreator
    }
    set isCreator(value: boolean) {
        this._isCreator = value
        this.onDataUpdate();
    }

    get sessionKeyAddress(): string {
        return this._sessionKeyAddress
    }
    set sessionKeyAddress(value: string) {
        this._sessionKeyAddress = value
        this.onDataUpdate();
    }

    get sessionKeyPrivateKey(): string {
        return this._sessionKeyPrivateKey
    }
    set sessionKeyPrivateKey(value: string) {
        this._sessionKeyPrivateKey = value
        this.onDataUpdate();
    }

    get boardSalt(): string {
        return this._boardSalt
    }
    set boardSalt(value: string) {
        this._boardSalt = value
        this.onDataUpdate();
    }

    get randomnessSalt(): string {
        return this._randomnessSalt
    }
    set randomnessSalt(value: string) {
        this._randomnessSalt = value
        this.onDataUpdate();
    }

    get gotRandomnessRevealed(): boolean {
        return this._gotRandomnessRevealed
    }
    set gotRandomnessRevealed(value: boolean) {
        this._gotRandomnessRevealed = value
        this.onDataUpdate();
    }

    get joinStatus(): "NOT_JOINED" | "JOINING" | "JOINED" {
        return this._joinStatus
    }
    set joinStatus(value: "NOT_JOINED" | "JOINING" | "JOINED") {
        this._joinStatus = value
        this.onDataUpdate();
    }

    get hashChain(): HashChain | null {
        return this._hashChain
    }
    set hashChain(value: HashChain | null) {
        this._hashChain = value
        this.onDataUpdate();
    }
}