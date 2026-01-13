import { type PosShipStatus, PosStatus, type ShotResult, FireStatus } from "./interfaces";
import { BarretenbergSync, Fr } from '@aztec/bb.js';

export class GameBoard {
    public pos: PosShipStatus[];
    public ships: number[][];
    private size: number;
    private shipSize: number[];
    constructor(_size: number, _shipSize: number[]) {
        this.size = _size;
        this.pos = new Array(_size * _size);
        this.shipSize = _shipSize;
        this.ships = new Array(_shipSize.length);
        this.clear();
    }
    clear() {
        for (let index = 0; index < this.pos.length; index++) {
            this.pos[index] = {
                shipIndex: -1,
                posStatus: PosStatus.Unknown
            };
        }
        for (let index = 0; index < this.ships.length; index++) {
            this.ships[index] = [];
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
        for (let index = 0; index < this.pos.length; index++) {
            this.pos[index].posStatus = PosStatus.EmptyUnattacked;
        }
        for (let i = 0; i < this.shipSize.length; i++) {
            const currentShipSize = this.shipSize[i];
            while (true) {
                let _pos = 0;
                let _step = 0;
                if (0 === this.randomInt(0, 2)/* 0:> , 1:v */) {
                    let X = this.randomInt(0, this.size - currentShipSize);
                    let Y = this.randomInt(0, this.size);
                    _pos = Y * this.size + X;
                    _step = 1;
                } else {
                    let X = this.randomInt(0, this.size);
                    let Y = this.randomInt(0, this.size - currentShipSize);
                    _pos = Y * this.size + X;
                    _step = this.size;

                }
                let err = false;
                const parr: number[] = new Array(currentShipSize);
                for (let j = 0; j < currentShipSize; j++) {
                    let p = _pos + (j * _step);
                    if (this.pos[p].shipIndex !== -1) {
                        err = true;
                        break;
                    }
                    parr[j] = p;
                }
                if (err) {
                    continue;
                }
                this.ships[i] = parr;
                for (let j = 0; j < parr.length; j++) {
                    this.pos[parr[j]] = {
                        shipIndex: i,
                        posStatus: PosStatus.ShipUnattacked
                    };
                }
                break;
            }
        }
    }

    isInitialized(): boolean {
        // Check if all ships have been placed
        for (let i = 0; i < this.ships.length; i++) {
            if (this.ships[i].length === 0) {
                return false;
            }
        }
        return true;
    }

    async getPoseidonHash(salt: bigint) {
        const inputs = [
            BigInt(this.ships[0][0]),
            BigInt(this.ships[0][1]),
            BigInt(this.ships[0][2]),
            BigInt(this.ships[1][0]),
            BigInt(this.ships[1][1]),
            BigInt(this.ships[2][0]),
            salt
        ];
        const frInputs = inputs.map(input => new Fr(input));
        try {
            BarretenbergSync.getSingleton();
        } catch (error) {
            await BarretenbergSync.initSingleton();
        }
        let bb = BarretenbergSync.getSingleton();
        const hashResult = bb.poseidon2Hash(frInputs);
        return hashResult.toString();
    }

    getBoardBin() {
        let board = BigInt(0);
        for (let i = 0; i < this.pos.length; i++) {
            if (this.pos[i].posStatus === PosStatus.ShipAttacked || this.pos[i].posStatus === PosStatus.ShipSunk) {
                board = board + ((BigInt(1) << BigInt((this.size * this.size) - 1 - i)));
            }
        }
        return board;
    }

    countHitShips() {
        let j = 0;
        for (let i = 0; i < this.pos.length; i++) {
            if (this.pos[i].posStatus === PosStatus.ShipAttacked ||
                this.pos[i].posStatus === PosStatus.ShipSunk
            ) {
                j++;
            }
        }
        return j;
    }

    firedAt(shootAt: number, save = false): ShotResult {
        const posStatus = this.pos[shootAt].posStatus;
        if (posStatus === PosStatus.EmptyAttacked || posStatus === PosStatus.EmptyUnattacked) {
            if (save) {
                this.pos[shootAt].posStatus = PosStatus.EmptyAttacked;
            }
            return {
                shotStatus: FireStatus.STATUS_MISS,
                sunkHeadPosition: 0,
                sunkEndPosition: 0
            };
        } else {
            const shipIndex = this.pos[shootAt].shipIndex;
            let j = 0;
            for (let i = 0; i < this.pos.length; i++) {
                if (this.pos[i].shipIndex !== shipIndex) {
                    continue;
                }
                if (this.pos[i].posStatus === PosStatus.ShipUnattacked) {
                    j++;
                }
            }
            if (j <= 1) {
                let sunkHeadPosition = 999999;
                let sunkEndPosition = 0;
                for (let i = 0; i < this.pos.length; i++) {
                    if (this.pos[i].shipIndex !== shipIndex) {
                        continue;
                    }
                    if (save) {
                        this.pos[i].posStatus = PosStatus.ShipSunk;
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
                    this.pos[shootAt].posStatus = PosStatus.ShipAttacked;
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
        let arr: number[] = [];
        for (let i = 0; i < this.pos.length; i++) {
            if (this.pos[i].posStatus === PosStatus.Unknown) {
                arr.push(i);
            }
            if (this.pos[i].posStatus === PosStatus.ShipAttacked) {
                const line = Math.floor(i / this.size);
                let uarr = [];
                {
                    const l = i - 1;
                    if (l >= 0 && l < (this.size * this.size)) {
                        if (Math.floor(l / this.size) === line && this.pos[l].posStatus === PosStatus.Unknown) {
                            uarr.push(l);
                        }
                    }
                }
                {
                    const r = i + 1;
                    if (r >= 0 && r < (this.size * this.size)) {
                        if (Math.floor(r / this.size) === line && this.pos[r].posStatus === PosStatus.Unknown) {
                            uarr.push(r);
                        }
                    }
                }
                {
                    const u = i - this.size;
                    if (u >= 0 && u < (this.size * this.size)) {
                        if (Math.floor(u / this.size) === line - 1 && this.pos[u].posStatus === PosStatus.Unknown) {
                            uarr.push(u);
                        }
                    }
                }
                {
                    const d = i + this.size;
                    if (d >= 0 && d < (this.size * this.size)) {
                        if (Math.floor(d / this.size) === line + 1 && this.pos[d].posStatus === PosStatus.Unknown) {
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
        shotResult: ShotResult
    ) {
        if (shotResult.shotStatus === FireStatus.STATUS_MISS) {
            this.pos[shootAt].posStatus = PosStatus.EmptyAttacked;
        } else if (shotResult.shotStatus === FireStatus.STATUS_HIT) {
            this.pos[shootAt].posStatus = PosStatus.ShipAttacked;
        } else if (shotResult.shotStatus === FireStatus.STATUS_SUNK) {
            let _size = shotResult.sunkEndPosition - shotResult.sunkHeadPosition;
            if (_size > 2) {
                _size = _size / 6;
                for (let i = shotResult.sunkHeadPosition; i <= shotResult.sunkEndPosition; i += 6) {
                    this.pos[i].shipIndex = _size;
                    this.pos[i].posStatus = PosStatus.ShipSunk;
                }
            } else {
                for (let i = shotResult.sunkHeadPosition; i <= shotResult.sunkEndPosition; i++) {
                    this.pos[i].shipIndex = _size;
                    this.pos[i].posStatus = PosStatus.ShipSunk;
                }
            }
        }
    }

}
