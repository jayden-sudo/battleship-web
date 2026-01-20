import { type HashChainItem, type ShotResult, type HashChainStatus, type HashChainData } from "./interfaces";
import { ethers } from "ethers";
import { emitHashChainUpdate } from './eventBus';

type DeepReadonly<T> = {
    readonly [P in keyof T]: DeepReadonly<T[P]>;
};


export class HashChain {
    private _hashChainList: HashChainItem[] = [];
    constructor(initItem: HashChainItem | HashChainItem[]) {
        if (Array.isArray(initItem)) {
            this._hashChainList = initItem;
        } else {
            this._hashChainList.push(initItem);
            emitHashChainUpdate();
        }
    }

    public toJSON() {
        return this._hashChainList;
    }

    public static fromJson(jsonStr: string): HashChain {
        const j = JSON.parse(jsonStr);
        const h = new HashChain(
            j as HashChainItem[]
        );
        return h;
    }

    public fromJson(jsonStr: string) {
        const j = JSON.parse(jsonStr);
        this._hashChainList = j as HashChainItem[];
    }

    get hashChainList(): readonly DeepReadonly<HashChainItem>[] {
        //  return this._hashChainList;
        return this._hashChainList as DeepReadonly<HashChainItem>[];
    }

    setHasInContract(i: number, hasInContract: boolean) {
        this._hashChainList[i].hasInContract = hasInContract;
        emitHashChainUpdate();
    }

    setStatus(i: number, status: HashChainStatus) {
        this._hashChainList[i].status = status;
        emitHashChainUpdate();
    }

    getNextStatusHash(value: ShotResult | number): string {
        let num = 0;
        if (typeof (value) === 'number') {
            num = value;
        } else {
            num = Number(value.shotStatus);
        }
        const newGameStatusHash = ethers.keccak256(ethers.solidityPacked(
            ["bytes32", "uint8"],
            [this._hashChainList[this._hashChainList.length - 1].hash, num]
        ));
        return newGameStatusHash;
    }

    getNextStatus() {
        if (this._hashChainList[0].status === 'None') {
            throw new Error('error');
        }
        if (this._hashChainList.length === 1) {
            return this._hashChainList[0].status;
        }
        const s = this._hashChainList[this._hashChainList.length - 1].status;
        let n = '';
        switch (s) {
            case 'CreatorFire':
                n = 'JoinerReport';
                break;
            case 'JoinerFire':
                n = 'CreatorReport';
                break;
            case 'CreatorReport':
                n = 'CreatorFire';
                break;
            case 'JoinerReport':
                n = 'JoinerFire';
                break;
            default:
                throw new Error('error');
        }
        return n as HashChainStatus;
    }

    push(data: HashChainData): HashChainItem {
        const item: HashChainItem = {
            ...data,
            hash: this.getNextStatusHash(data.value)
        };
        const n = this.getNextStatus();
        if (item.status !== n) {
            throw new Error('error');
        }
        // console.log(`pushed new hash: ${item.hash}, status: ${item.status}`);
        this._hashChainList.push(item);
        emitHashChainUpdate();
        return item;
    }

    include(hash: string): boolean {
        return this.indexOf(hash) !== -1;
    }

    indexOf(hash: string): number {
        for (let i = 0; i < this._hashChainList.length; i++) {
            if (this._hashChainList[i].hash.toLowerCase() === hash.toLowerCase()) {
                return i;
            }
        }
        return -1;
    }

}