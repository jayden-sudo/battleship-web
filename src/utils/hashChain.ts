import {type HashChainItem, type ShotResult,type HashChainStatus,type HashChainData } from "./interfaces";
import { ethers } from "ethers";

export class HashChain {
    public hashChainList: HashChainItem[] = [];
    constructor(initItem: HashChainItem) {
        this.hashChainList.push(initItem);
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
            [this.hashChainList[this.hashChainList.length - 1].hash, num]
        ));
        return newGameStatusHash;
    }

    getNextStatus() {
        if (this.hashChainList[0].status === 'None') {
            throw new Error('error');
        }
        if (this.hashChainList.length === 1) {
            return this.hashChainList[0].status;
        }
        const s = this.hashChainList[this.hashChainList.length - 1].status;
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
        let n = this.getNextStatus();
        if (item.status !== n) {
            throw new Error('error');
        }
        // console.log(`pushed new hash: ${item.hash}, status: ${item.status}`);
        this.hashChainList.push(item);
        return item;
    }

    include(hash: string): boolean {
        return this.indexOf(hash) !== -1;
    }

    indexOf(hash: string): number {
        for (let i = 0; i < this.hashChainList.length; i++) {
            if (this.hashChainList[i].hash.toLowerCase() === hash.toLowerCase()) {
                return i;
            }
        }
        return -1;
    }

}