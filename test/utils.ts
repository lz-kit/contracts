import { BigNumber, BigNumberish, Contract, EventFilter, providers, utils } from "ethers";
import { chainId } from "../constants/layerzero.json";
import { assert, expect } from "chai";
import { clearTimeout } from "timers";
import { TypedEvent } from "../typechain-types/common";
import { PRECISION_BASE, WEEK } from "./constants";

export const getLZChainId = (network: string) => {
    if (network.endsWith("-fork")) {
        network = network.slice(0, -5);
    }
    return chainId[network] as number;
};

export const setBalance = async (provider: providers.JsonRpcProvider, account: string, balance: BigNumber) => {
    await provider.send("hardhat_setBalance", [account, utils.hexValue(utils.arrayify(balance.toHexString()))]);
};

export interface BlockInfo {
    number: number;
    timestamp: number;
}

export const getBlockInfo = async (provider: providers.JsonRpcProvider) => {
    const blockNumber = await provider.getBlockNumber();
    return {
        number: blockNumber,
        timestamp: (await provider.getBlock(blockNumber)).timestamp,
    } as BlockInfo;
};

export const moveToWeekStart = async (provider: providers.JsonRpcProvider) => {
    const ts = await getBlockTimestamp(provider);
    await sleep(provider, (divf(ts, WEEK) + 1) * WEEK - ts);
    await mine(provider);
};

export const getBlockTimestamp = async (provider: providers.JsonRpcProvider) => {
    return (await provider.getBlock("latest")).timestamp;
};

export const sleep = async (provider: providers.JsonRpcProvider, seconds: number) => {
    await provider.send("evm_increaseTime", [seconds]);
};

export const mine = async (provider: providers.JsonRpcProvider) => {
    await provider.send("evm_mine", []);
};

export const waitForEventEmitted = <T extends TypedEvent>(
    contract: Contract,
    filter: EventFilter | string,
    maxSeconds = 5
): Promise<T> =>
    new Promise((resolve, reject) => {
        const handle = setTimeout(() => {
            reject("timeout while waitForEventEmitted()");
        }, maxSeconds * 1000);
        contract.once(filter, (...args) => {
            clearTimeout(handle);
            resolve(args[args.length - 1] as T);
        });
    });

export const divf = (a: number, b: number) => {
    return Math.floor(a / b);
};

export const expectApproxEqual = (
    a: BigNumberish,
    b: BigNumberish,
    precision = PRECISION_BASE.div(BigNumber.from(10).pow(10))
) => {
    a = BigNumber.from(a);
    b = BigNumber.from(b);
    if (a.eq(b) && b.eq(0)) return;
    assert(
        a.sub(b).abs().mul(2).lte(a.add(b).mul(precision).div(PRECISION_BASE)),
        `${utils.formatEther(a)} and ${utils.formatEther(
            b
        )} isn't approximately equal with precision ${utils.formatEther(precision)}`
    );
};

export const expectZero = (value: BigNumberish) => {
    expect(value).to.be.equal(0);
};
