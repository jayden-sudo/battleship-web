import { ethers, Interface } from "ethers";
import { MessageQueue } from "./messageQueue";

export class EventLogMonitor {
    private messageQueue: MessageQueue<number | ethers.LogDescription
    >;
    private iface: ethers.Interface;
    private lastBlock: number = 0;
    private rpc: ethers.JsonRpcProvider;
    private blockTime = 1000;
    private _start: boolean = true;
    private contractAddr: string;


    constructor(
        contractAddr: string,
        fragments: ethers.InterfaceAbi,
        blocTime: number,
        rpc: ethers.JsonRpcProvider) {
        this.contractAddr = contractAddr;
        this.messageQueue = new MessageQueue();
        this.iface = new Interface(fragments);
        this.rpc = rpc;
        this.blockTime = blocTime;
    }

    async start(lastBlock?: number): Promise<MessageQueue<number | ethers.LogDescription>> {
        if (lastBlock !== undefined) {
            this.lastBlock = lastBlock;
        }
        if (this.lastBlock === 0) {
            this.lastBlock = await this.rpc.getBlockNumber();
        }
        this._start = true;
        this.loop();
        return this.messageQueue;
    }

    async pause() {
        this._start = false;
    }

    private async loop() {
        let updateAt = 0;
        const interval = this.blockTime > 1000 ? this.blockTime : 1000;
        while (this._start) {
            await this.sleep(100);
            if (Date.now() - updateAt < interval) {
                continue;
            }
            try {
                const currentBlock = await this.rpc.getBlockNumber();
                if (currentBlock > this.lastBlock) {
                    let toBlock = currentBlock;
                    if (this.lastBlock + 1000 < currentBlock) {
                        toBlock = this.lastBlock + 1000;
                    } else {
                        updateAt = Date.now();
                    }
                    const logs = await this.rpc.getLogs({
                        address: this.contractAddr,
                        fromBlock: this.lastBlock + 1,
                        toBlock: toBlock,
                    });
                    if (logs.length > 0) {
                        for (const log of logs) {
                            try {
                                const parsed = this.iface.parseLog(log);
                                if (parsed !== null && parsed.args.length > 0 && typeof (parsed.args[0]) === 'string'/* gameId */) {
                                    this.messageQueue.put(parsed);
                                }
                            } catch {
                                console.log('unknown log:', log.topics[0]);
                                debugger;
                            }
                        }
                        this.messageQueue.put(toBlock);
                    }
                    this.lastBlock = toBlock;
                }
            } catch (error) {
                console.error(error);
                await this.sleep(1000 * 3);
                debugger;
            }
        }
    }

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}