import { BigNumberish, constants, utils } from "ethers";
import { getChain } from "hardhat";
import { getBlockTimestamp, getLZChainId, moveToWeekStart, waitForEventEmitted } from "./utils";
import { Chain, SignerWithAddress } from "@lz-kit/cli";
import { ERC20Mock, OmniVotingEscrow } from "../typechain-types";
import { expect } from "chai";
import { MAXTIME } from "./constants";

interface Context extends Mocha.Context {
    src: Env;
    dest: Env;
}

interface Env extends Chain {
    lzChainId: number;
    deployer: SignerWithAddress;
    alice: SignerWithAddress;
    token: ERC20Mock;
    ove: OmniVotingEscrow;
    balanceOf: (address: string, ts?: number) => Promise<BigNumberish>;
}

const PT_SYNC = 0;

const setup = async (chain: Chain) => {
    const { name, getSigners, getContract } = chain;
    const lzChainId = getLZChainId(name);
    const [deployer, alice] = await getSigners();
    const token = await getContract<ERC20Mock>("ERC20Mock", deployer);
    const ove = await getContract<OmniVotingEscrow>("OmniVotingEscrow", deployer);

    const balanceOf = async (address: string, ts?: number) => {
        if (ts) {
            return await ove["balanceOf(address,uint256)"](address, ts);
        } else {
            return await ove["balanceOf(address)"](address);
        }
    };

    return {
        ...chain,
        lzChainId,
        deployer,
        alice,
        token,
        ove,
        balanceOf,
    } as Env;
};

describe("OmniVotingEscrow", function () {
    beforeEach(async function (this: Context) {
        this.src = await setup(await getChain("ethereum-fork"));
        this.dest = await setup(await getChain("arbitrum-fork"));
        await this.src.ove.setMinDstGas(this.dest.lzChainId, PT_SYNC, 21000);
        await this.dest.ove.setMinDstGas(this.src.lzChainId, PT_SYNC, 21000);
    });

    afterEach(async function (this: Context) {
        await this.src.snapshot.restore();
        await this.dest.snapshot.restore();
    });

    it("should sync()", async function (this: Context) {
        await this.src.token.mint(this.src.alice.address, utils.parseEther("100"));
        await moveToWeekStart(this.src.provider);
        await moveToWeekStart(this.dest.provider);

        const amount = utils.parseEther("1");
        await this.src.token.connect(this.src.alice).approve(this.src.ove.address, amount);
        await this.src.ove
            .connect(this.src.alice)
            .createLockFor(this.src.alice.address, amount, (await getBlockTimestamp(this.src.provider)) + MAXTIME);

        const ts = await getBlockTimestamp(this.src.provider);
        const balanceVE = await this.src.balanceOf(this.src.alice.address);
        expect(await this.dest.balanceOf(this.dest.alice.address)).to.eq(0);

        const fee = await this.src.ove.estimateFee_SYNC(
            this.dest.lzChainId,
            this.src.alice.address,
            21000,
            0,
            constants.AddressZero
        );
        await this.src.ove
            .connect(this.src.alice)
            .sync(
                this.dest.lzChainId,
                this.src.alice.address,
                this.src.alice.address,
                21000,
                0,
                constants.AddressZero,
                {
                    value: fee.mul(120).div(100),
                }
            );
        expect(await this.src.ove.epochSynced(this.dest.lzChainId)).to.be.eq(await this.src.ove.epoch());
        expect(await this.src.ove.userPointEpochSynced(this.dest.lzChainId, this.src.alice.address)).to.be.eq(
            await this.src.ove.userPointEpoch(this.src.alice.address)
        );

        await waitForEventEmitted(this.dest.ove, this.dest.ove.filters.OnSync());
        expect(await this.dest.ove.epoch()).to.be.eq(await this.src.ove.epoch());
        expect(await this.dest.ove.pointHistory(1)).to.be.deep.eq(await this.src.ove.pointHistory(1));
        expect(await this.dest.ove.userPointEpoch(this.dest.alice.address)).to.be.eq(
            await this.src.ove.userPointEpoch(this.src.alice.address)
        );
        expect(await this.dest.ove.userPointHistory(this.dest.alice.address, 1)).to.be.deep.eq(
            await this.src.ove.userPointHistory(this.src.alice.address, 1)
        );
        expect(await this.dest.ove.locked(this.dest.alice.address)).to.be.deep.eq(
            await this.src.ove.locked(this.src.alice.address)
        );
        expect(await this.dest.balanceOf(this.dest.alice.address, ts)).to.eq(balanceVE);
        expect(await this.dest.ove["totalSupply(uint256)"](ts)).to.eq(balanceVE);
    });
});
