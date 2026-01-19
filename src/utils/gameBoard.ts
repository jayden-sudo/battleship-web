import { type PosShipStatus, PosStatus, type ShotResult, FireStatus } from "./interfaces";
import { BarretenbergSync, Fr } from '@aztec/bb.js';
import { emitGameboardUpdate } from './eventBus';
type DeepReadonly<T> = {
    readonly [P in keyof T]: DeepReadonly<T[P]>;
};

export class GameBoard {
    private _pos: PosShipStatus[];
    private _ships: number[][];
    private size: number;
    private shipSize: number[];
    constructor(_size: number, _shipSize: number[],
        pos?: PosShipStatus[],
        ships?: number[][]
    ) {
        this.size = _size;
        this.shipSize = _shipSize;
        if (pos && ships) {
            this._pos = pos;
            this._ships = ships;
        } else {
            this._pos = new Array(_size * _size);
            this._ships = new Array(_shipSize.length);
            this.clear();
        }
    }

    public toJSON() {
        return {
            pos: this._pos,
            ships: this._ships,
            size: this.size,
            shipSize: this.shipSize
        };
    }

    public static fromJson(jsonStr: string): GameBoard {
        const j = JSON.parse(jsonStr);
        const board = new GameBoard(
            j.size as number,
            j.shipSize as number[],
            j.pos as PosShipStatus[],
            j.ships as number[][]
        );
        return board;
    }

    get pos(): readonly DeepReadonly<PosShipStatus>[] {
        return this._pos as DeepReadonly<PosShipStatus>[];
    }

    get ships(): readonly DeepReadonly<number[]>[] {
        return this._ships as DeepReadonly<number[]>[];
    }

    clear() {
        for (let index = 0; index < this._pos.length; index++) {
            this._pos[index] = {
                shipIndex: -1,
                posStatus: PosStatus.Unknown
            };
        }
        for (let index = 0; index < this._ships.length; index++) {
            this._ships[index] = [];
        }
    }

    randomInt(from: number, to: number): number {
        if (!Number.isInteger(from) || !Number.isInteger(to)) {
            throw new Error("from and to must be integers");
        }
        if (from >= to) {
            throw new Error("from must be less than to");
        }
        return Math.floor(Math.random() * (to - from)) + from;
    }

    initRandom() {
        this.clear();
        for (let index = 0; index < this._pos.length; index++) {
            this._pos[index].posStatus = PosStatus.EmptyUnattacked;
        }
        for (let i = 0; i < this.shipSize.length; i++) {
            const currentShipSize = this.shipSize[i];
            while (true) {
                let _pos = 0;
                let _step = 0;
                if (0 === this.randomInt(0, 2)/* 0:> , 1:v */) {
                    const X = this.randomInt(0, this.size - currentShipSize);
                    const Y = this.randomInt(0, this.size);
                    _pos = Y * this.size + X;
                    _step = 1;
                } else {
                    const X = this.randomInt(0, this.size);
                    const Y = this.randomInt(0, this.size - currentShipSize);
                    _pos = Y * this.size + X;
                    _step = this.size;

                }
                let err = false;
                const parr: number[] = new Array(currentShipSize);
                for (let j = 0; j < currentShipSize; j++) {
                    const p = _pos + (j * _step);
                    if (this._pos[p].shipIndex !== -1) {
                        err = true;
                        break;
                    }
                    parr[j] = p;
                }
                if (err) {
                    continue;
                }
                this._ships[i] = parr;
                for (let j = 0; j < parr.length; j++) {
                    this._pos[parr[j]] = {
                        shipIndex: i,
                        posStatus: PosStatus.ShipUnattacked
                    };
                }
                break;
            }
        }

        emitGameboardUpdate();
    }

    isInitialized(): boolean {
        // Check if all ships have been placed
        for (let i = 0; i < this._ships.length; i++) {
            if (this._ships[i].length === 0) {
                return false;
            }
        }
        return true;
    }

    async getPoseidonHash(salt: bigint) {
        const inputs = [
            BigInt(this._ships[0][0]),
            BigInt(this._ships[0][1]),
            BigInt(this._ships[0][2]),
            BigInt(this._ships[1][0]),
            BigInt(this._ships[1][1]),
            BigInt(this._ships[2][0]),
            salt
        ];
        const frInputs = inputs.map(input => new Fr(input));
        try {
            BarretenbergSync.getSingleton();
        } catch (error) {
            await BarretenbergSync.initSingleton();
        }
        const bb = BarretenbergSync.getSingleton();
        const hashResult = bb.poseidon2Hash(frInputs);
        return hashResult.toString();
    }

    getBoardBin() {
        let board = BigInt(0);
        for (let i = 0; i < this._pos.length; i++) {
            if (this._pos[i].posStatus === PosStatus.ShipAttacked || this._pos[i].posStatus === PosStatus.ShipSunk) {
                board = board + ((BigInt(1) << BigInt((this.size * this.size) - 1 - i)));
            }
        }
        return board;
    }

    countHitShips() {
        let j = 0;
        for (let i = 0; i < this._pos.length; i++) {
            if (this._pos[i].posStatus === PosStatus.ShipAttacked ||
                this._pos[i].posStatus === PosStatus.ShipSunk
            ) {
                j++;
            }
        }
        return j;
    }

    firedAt(shootAt: number, save = false): ShotResult {
        const posStatus = this._pos[shootAt].posStatus;
        if (posStatus === PosStatus.EmptyAttacked || posStatus === PosStatus.EmptyUnattacked) {
            if (save) {
                this._pos[shootAt].posStatus = PosStatus.EmptyAttacked;
                emitGameboardUpdate();
            }
            return {
                shotStatus: FireStatus.STATUS_MISS,
                sunkHeadPosition: 0,
                sunkEndPosition: 0
            };
        } else {
            const shipIndex = this._pos[shootAt].shipIndex;
            let j = 0;
            for (let i = 0; i < this._pos.length; i++) {
                if (this._pos[i].shipIndex !== shipIndex) {
                    continue;
                }
                if (this._pos[i].posStatus === PosStatus.ShipUnattacked) {
                    j++;
                }
            }
            if (j <= 1) {
                let sunkHeadPosition = 999999;
                let sunkEndPosition = 0;
                for (let i = 0; i < this._pos.length; i++) {
                    if (this._pos[i].shipIndex !== shipIndex) {
                        continue;
                    }
                    if (save) {
                        this._pos[i].posStatus = PosStatus.ShipSunk;
                        emitGameboardUpdate();
                    }
                    if (sunkHeadPosition > i) {
                        sunkHeadPosition = i;
                    }
                    if (sunkEndPosition < i) {
                        sunkEndPosition = i;
                    }
                }
                return {
                    shotStatus: FireStatus.STATUS_SUNK,
                    sunkHeadPosition,
                    sunkEndPosition
                };
            } else {
                if (save) {
                    this._pos[shootAt].posStatus = PosStatus.ShipAttacked;
                    emitGameboardUpdate();
                }
                return {
                    shotStatus: FireStatus.STATUS_HIT,
                    sunkHeadPosition: 0,
                    sunkEndPosition: 0
                };
            }
        }
    }


    enemyRandomShoot(): number {
        const arr: number[] = [];
        for (let i = 0; i < this._pos.length; i++) {
            if (this._pos[i].posStatus === PosStatus.Unknown) {
                arr.push(i);
            }
            if (this._pos[i].posStatus === PosStatus.ShipAttacked) {
                const line = Math.floor(i / this.size);
                const uarr = [];
                {
                    const l = i - 1;
                    if (l >= 0 && l < (this.size * this.size)) {
                        if (Math.floor(l / this.size) === line && this._pos[l].posStatus === PosStatus.Unknown) {
                            uarr.push(l);
                        }
                    }
                }
                {
                    const r = i + 1;
                    if (r >= 0 && r < (this.size * this.size)) {
                        if (Math.floor(r / this.size) === line && this._pos[r].posStatus === PosStatus.Unknown) {
                            uarr.push(r);
                        }
                    }
                }
                {
                    const u = i - this.size;
                    if (u >= 0 && u < (this.size * this.size)) {
                        if (Math.floor(u / this.size) === line - 1 && this._pos[u].posStatus === PosStatus.Unknown) {
                            uarr.push(u);
                        }
                    }
                }
                {
                    const d = i + this.size;
                    if (d >= 0 && d < (this.size * this.size)) {
                        if (Math.floor(d / this.size) === line + 1 && this._pos[d].posStatus === PosStatus.Unknown) {
                            uarr.push(d);
                        }
                    }
                }
                if (uarr.length > 0) {
                    return uarr[this.randomInt(0, uarr.length)];
                }
            }
        }
        return arr[this.randomInt(0, arr.length)];
    }

    enemySaveShoot(shootAt: number,
        shotResult: ShotResult | null
    ) {
        if (shotResult === null) {
            if (this._pos[shootAt].posStatus !== PosStatus.Unknown) {
                debugger;
                throw new Error("Invalid state: position not in Unknown status");
            }
            this._pos[shootAt].posStatus = PosStatus.AttackedPending;
        } else {
            if (this._pos[shootAt].posStatus !== PosStatus.AttackedPending) {
                debugger;
                throw new Error("Invalid state: position not in AttackedPending status");
            }
            if (shotResult.shotStatus === FireStatus.STATUS_MISS) {
                this._pos[shootAt].posStatus = PosStatus.EmptyAttacked;
            } else if (shotResult.shotStatus === FireStatus.STATUS_HIT) {
                this._pos[shootAt].posStatus = PosStatus.ShipAttacked;
            } else if (shotResult.shotStatus === FireStatus.STATUS_SUNK) {
                let _size = shotResult.sunkEndPosition - shotResult.sunkHeadPosition;
                if (_size > 2) {
                    _size = _size / 6;
                    for (let i = shotResult.sunkHeadPosition; i <= shotResult.sunkEndPosition; i += 6) {
                        this._pos[i].shipIndex = _size;
                        this._pos[i].posStatus = PosStatus.ShipSunk;
                    }
                } else {
                    for (let i = shotResult.sunkHeadPosition; i <= shotResult.sunkEndPosition; i++) {
                        this._pos[i].shipIndex = _size;
                        this._pos[i].posStatus = PosStatus.ShipSunk;
                    }
                }
            }
        }
        emitGameboardUpdate();
    }

}
