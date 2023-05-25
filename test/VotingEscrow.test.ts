import { ethers, getChain } from "hardhat";
import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import {
    BlockInfo,
    divf,
    expectApproxEqual,
    expectZero,
    getBlockInfo,
    getBlockTimestamp,
    mine,
    setBalance,
    sleep,
} from "./utils";
import { BigNumber, constants, Signer, utils, Wallet } from "ethers";
import { Chain } from "@lz-kit/cli/dist/type-extensions";
import { Snapshot } from "@lz-kit/cli";
import { DAY, H, MAXTIME, NUMBER_OF_DAYS, PRECISION_BASE, TOL, WEEK } from "./constants";
import { ERC20Mock, VotingEscrow } from "../typechain-types";

ethers.utils.Logger.setLogLevel(ethers.utils.Logger.levels.ERROR); // turn off warnings
chai.use(solidity);

interface Context extends Mocha.Context {
    env: Env;
    snapshot: Snapshot;
}

interface Env extends Chain {
    alice: Wallet;
    bob: Wallet;
    carol: Wallet;
    token: ERC20Mock;
    ve: VotingEscrow;
    totalSupply: () => Promise<BigNumber>;
    totalSupplyAt: (block: number) => Promise<BigNumber>;
    balanceOf: (account: Signer) => Promise<BigNumber>;
    balanceOfAt: (account: Signer, block: number) => Promise<BigNumber>;
}

const setup = async () => {
    const chain = await getChain("ethereum-fork");
    const { provider, getSigners, getContract } = chain;
    const [deployer, alice, bob] = await getSigners();

    const token = await getContract<ERC20Mock>("ERC20Mock", deployer);
    const ve = await getContract<VotingEscrow>("OmniVotingEscrow", deployer);

    await setBalance(provider, alice.address, utils.parseEther("10000"));
    await setBalance(provider, bob.address, utils.parseEther("10000"));
    await token.mint(alice.address, utils.parseEther("10000"));
    await token.mint(bob.address, utils.parseEther("10000"));

    const totalSupply = async (): Promise<BigNumber> => await ve["totalSupply()"]();
    const totalSupplyAt = async (block: number): Promise<BigNumber> => await ve.totalSupplyAt(block);
    const balanceOf = async (account: Signer): Promise<BigNumber> =>
        await ve["balanceOf(address)"](await account.getAddress());
    const balanceOfAt = async (account: Signer, block: number): Promise<BigNumber> =>
        await ve.balanceOfAt(await account.getAddress(), block);

    return {
        ...chain,
        alice,
        bob,
        token,
        ve,
        totalSupply,
        totalSupplyAt,
        balanceOf,
        balanceOfAt,
    } as Env;
};

/**
 *  Test voting power in the following scenario.
 *  Alice:
 *  ~~~~~~~
 *  ^
 *  | *       *
 *  | | \     |  \
 *  | |  \    |    \
 *  +-+---+---+------+---> t
 *
 *  Bob:
 *  ~~~~~~~
 *  ^
 *  |         *
 *  |         | \
 *  |         |  \
 *  +-+---+---+---+--+---> t
 *
 *  Alice has 100% of voting power in the first period.
 *  She has 2/3 power at the start of 2nd period, with Bob having 1/2 power
 *  (due to smaller locktime).
 *  Alice's power grows to 100% by Bob's unlock.
 *
 *  Checking that totalSupply is appropriate.
 *
 *  After the test is done, check all over again with balanceOfAt / totalSupplyAt
 **/
describe("VotingEscrow", () => {
    beforeEach(async function (this: Context) {
        this.env = await setup();
    });

    afterEach(async function (this: Context) {
        await this.env.snapshot.restore();
    });

    it("should properly increase and decrease voting power", async function (this: Context) {
        const { provider, token, ve, alice, bob, totalSupply, totalSupplyAt, balanceOf, balanceOfAt } = this.env;

        const amount = constants.WeiPerEther.mul(1000);
        await token.connect(alice).transfer(bob.address, amount);
        const stages: Record<string, BlockInfo | BlockInfo[]> = {};

        await token.connect(alice).approve(ve.address, amount.mul(10));
        await token.connect(bob).approve(ve.address, amount.mul(10));

        expectZero(await totalSupply());
        expectZero(await balanceOf(alice));
        expectZero(await balanceOf(bob));

        // Move to timing which is good for testing - beginning of a UTC week
        let ts = await getBlockTimestamp(provider);
        await sleep(provider, (divf(ts, WEEK) + 1) * WEEK - ts);
        await mine(provider);

        await sleep(provider, H);

        stages["before_deposits"] = await getBlockInfo(provider);

        await ve.connect(alice).createLockFor(alice.address, amount, (await getBlockTimestamp(provider)) + WEEK);
        stages["alice_deposit"] = await getBlockInfo(provider);

        await sleep(provider, H);
        await mine(provider);

        expectApproxEqual(await totalSupply(), amount.div(MAXTIME).mul(WEEK - 2 * H), TOL);
        expectApproxEqual(await balanceOf(alice), amount.div(MAXTIME).mul(WEEK - 2 * H), TOL);
        expectZero(await balanceOf(bob));
        let t0 = await getBlockTimestamp(provider);

        stages["alice_in_0"] = [await getBlockInfo(provider)];
        for (let i = 0; i < NUMBER_OF_DAYS; i++) {
            for (let j = 0; j < 24; j++) {
                await sleep(provider, H);
                await mine(provider);
            }
            const dt = (await getBlockTimestamp(provider)) - t0;
            expectApproxEqual(await totalSupply(), amount.div(MAXTIME).mul(Math.max(WEEK - 2 * H - dt, 0)), TOL);
            expectApproxEqual(await balanceOf(alice), amount.div(MAXTIME).mul(Math.max(WEEK - 2 * H - dt, 0)), TOL);
            expectZero(await balanceOf(bob));
            stages["alice_in_0"].push(await getBlockInfo(provider));
        }

        await sleep(provider, H);

        expectZero(await balanceOf(alice));
        await ve.connect(alice).withdraw();
        stages["alice_withdraw"] = await getBlockInfo(provider);

        expectZero(await totalSupply());
        expectZero(await balanceOf(alice));
        expectZero(await balanceOf(bob));

        await sleep(provider, H);
        await mine(provider);

        // Next week (for round counting)
        ts = await getBlockTimestamp(provider);
        await sleep(provider, (divf(ts, WEEK) + 1) * WEEK - ts);
        await mine(provider);

        await ve.connect(alice).createLockFor(alice.address, amount, (await getBlockTimestamp(provider)) + 2 * WEEK);
        stages["alice_deposit_2"] = await getBlockInfo(provider);

        expectApproxEqual(await totalSupply(), amount.div(MAXTIME).mul(2).mul(WEEK), TOL);
        expectApproxEqual(await balanceOf(alice), amount.div(MAXTIME).mul(2).mul(WEEK), TOL);
        expectZero(await balanceOf(bob));

        await ve.connect(bob).createLockFor(bob.address, amount, (await getBlockTimestamp(provider)) + WEEK);
        stages["bob_deposit_2"] = await getBlockInfo(provider);

        expectApproxEqual(await totalSupply(), amount.div(MAXTIME).mul(3).mul(WEEK), TOL);
        expectApproxEqual(await balanceOf(alice), amount.div(MAXTIME).mul(2).mul(WEEK), TOL);
        expectApproxEqual(await balanceOf(bob), amount.div(MAXTIME).mul(WEEK), TOL);

        t0 = await getBlockTimestamp(provider);
        await sleep(provider, H);
        await mine(provider);

        stages["alice_bob_in_2"] = [];
        // Beginning of week: weight 3
        // End of week: weight 1
        for (let i = 0; i < NUMBER_OF_DAYS; i++) {
            for (let j = 0; j < 24; j++) {
                await sleep(provider, H);
                await mine(provider);
            }
            const dt = (await getBlockTimestamp(provider)) - t0;
            const w_total = await totalSupply();
            const w_alice = await balanceOf(alice);
            const w_bob = await balanceOf(bob);
            expect(w_total).to.be.equal(w_alice.add(w_bob));
            expectApproxEqual(w_alice, amount.div(MAXTIME).mul(Math.max(2 * WEEK - dt, 0)), TOL);
            expectApproxEqual(w_bob, amount.div(MAXTIME).mul(Math.max(WEEK - dt, 0)), TOL);
            stages["alice_bob_in_2"].push(await getBlockInfo(provider));
        }

        await sleep(provider, H);
        await mine(provider);

        await ve.connect(bob).withdraw();
        t0 = await getBlockTimestamp(provider);
        stages["bob_withdraw_1"] = await getBlockInfo(provider);
        let w_total = await totalSupply();
        let w_alice = await balanceOf(alice);
        expect(w_total).to.be.equal(w_alice);
        expectApproxEqual(w_total, amount.div(MAXTIME).mul(WEEK - 2 * H), TOL);
        expectZero(await balanceOf(bob));

        await sleep(provider, H);
        await mine(provider);

        stages["alice_in_2"] = [];
        for (let i = 0; i < NUMBER_OF_DAYS; i++) {
            for (let j = 0; j < 24; j++) {
                await sleep(provider, H);
                await mine(provider);
            }
            const dt = (await getBlockTimestamp(provider)) - t0;
            const w_total = await totalSupply();
            const w_alice = await balanceOf(alice);
            expect(w_total).to.be.equal(w_alice);
            expectApproxEqual(w_alice, amount.div(MAXTIME).mul(Math.max(WEEK - dt - 2 * H, 0)), TOL);
            expectZero(await balanceOf(bob));
            stages["alice_in_2"].push(await getBlockInfo(provider));
        }

        await ve.connect(alice).withdraw();
        stages["alice_withdraw_2"] = await getBlockInfo(provider);

        await sleep(provider, H);
        await mine(provider);

        await ve.connect(bob).withdraw();
        stages["bob_withdraw_2"] = await getBlockInfo(provider);

        expectZero(await totalSupply());
        expectZero(await balanceOf(alice));
        expectZero(await balanceOf(bob));

        // Now test historical balanceOfAt and others

        expectZero(await balanceOfAt(alice, stages["before_deposits"].number));
        expectZero(await balanceOfAt(bob, stages["before_deposits"].number));
        expectZero(await totalSupplyAt(stages["before_deposits"].number));

        w_alice = await balanceOfAt(alice, stages["alice_deposit"].number);
        expectApproxEqual(w_alice, amount.div(MAXTIME).mul(WEEK - H), TOL);
        expectZero(await balanceOfAt(bob, stages["alice_deposit"].number));
        w_total = await totalSupplyAt(stages["alice_deposit"].number);
        expect(w_alice).to.be.equal(w_total);

        let i = 0;
        for (const block of stages["alice_in_0"]) {
            if (i >= NUMBER_OF_DAYS) break;
            w_alice = await balanceOfAt(alice, block.number);
            expectZero(await balanceOfAt(bob, block.number));
            w_total = await totalSupplyAt(block.number);
            expect(w_alice).to.be.equal(w_total);
            const time_left = divf(WEEK * (NUMBER_OF_DAYS - i), NUMBER_OF_DAYS) - 2 * H;
            const error_1h = PRECISION_BASE.mul(H).div(time_left);
            expectApproxEqual(w_alice, amount.div(MAXTIME).mul(time_left), error_1h);
            i++;
        }

        expectZero(await totalSupplyAt(stages["alice_withdraw"].number));
        expectZero(await balanceOfAt(alice, stages["alice_withdraw"].number));
        expectZero(await balanceOfAt(bob, stages["alice_withdraw"].number));

        w_total = await totalSupplyAt(stages["alice_deposit_2"].number);
        w_alice = await balanceOfAt(alice, stages["alice_deposit_2"].number);
        expectApproxEqual(w_total, amount.div(MAXTIME).mul(2).mul(WEEK), TOL);
        expect(w_total).to.be.equal(w_alice);
        expectZero(await balanceOfAt(bob, stages["alice_deposit_2"].number));

        w_total = await totalSupplyAt(stages["bob_deposit_2"].number);
        w_alice = await balanceOfAt(alice, stages["bob_deposit_2"].number);
        expect(w_total).to.be.equal(w_alice.add(await balanceOfAt(bob, stages["bob_deposit_2"].number)));
        expectApproxEqual(w_total, amount.div(MAXTIME).mul(3).mul(WEEK), TOL);
        expectApproxEqual(w_alice, amount.div(MAXTIME).mul(2).mul(WEEK), TOL);

        t0 = stages["bob_deposit_2"].timestamp;
        i = 0;
        for (const block of stages["alice_bob_in_2"]) {
            w_alice = await balanceOfAt(alice, block.number);
            const w_bob = await balanceOfAt(bob, block.number);
            w_total = await totalSupplyAt(block.number);
            expect(w_total).to.be.equal(w_alice.add(w_bob));
            const dt = block.timestamp - t0;
            const error_1h = PRECISION_BASE.mul(H).div(2 * WEEK - i * DAY); //  Rounding error of 1 block is possible, and we have 1h blocks
            expectApproxEqual(w_alice, amount.div(MAXTIME).mul(Math.max(2 * WEEK - dt, 0)), error_1h);
            expectApproxEqual(w_bob, amount.div(MAXTIME).mul(Math.max(WEEK - dt, 0)), error_1h);
            i++;
        }

        w_total = await totalSupplyAt(stages["bob_withdraw_1"].number);
        w_alice = await balanceOfAt(alice, stages["bob_withdraw_1"].number);
        expect(w_total).to.be.equal(w_alice);
        expectApproxEqual(w_total, amount.div(MAXTIME).mul(WEEK - 2 * H), TOL);
        expectZero(await balanceOfAt(bob, stages["bob_withdraw_1"].number));

        t0 = stages["bob_withdraw_1"].timestamp;
        i = 0;
        for (const block of stages["alice_in_2"]) {
            w_alice = await balanceOfAt(alice, block.number);
            w_total = await totalSupplyAt(block.number);
            expect(w_total).to.be.equal(w_alice);
            expectZero(await balanceOfAt(bob, block.number));
            const dt = block.timestamp - t0;
            const error_1h = PRECISION_BASE.mul(H).div(WEEK - i * DAY + DAY); //  Rounding error of 1 block is possible, and we have 1h blocks
            expectApproxEqual(w_total, amount.div(MAXTIME).mul(Math.max(WEEK - dt - 2 * H, 0)), error_1h);
            i++;
        }

        expectZero(await totalSupplyAt(stages["bob_withdraw_2"].number));
        expectZero(await balanceOfAt(alice, stages["bob_withdraw_2"].number));
        expectZero(await balanceOfAt(bob, stages["bob_withdraw_2"].number));
    });

    it("should increaseUnlockTime()", async function (this: Context) {
        const { provider, token, ve, alice, bob } = this.env;

        const amount = constants.WeiPerEther.mul(1000);
        await token.connect(alice).transfer(bob.address, amount);

        await token.connect(alice).approve(ve.address, amount.mul(10));
        await token.connect(bob).approve(ve.address, amount.mul(10));

        // Move to timing which is good for testing - beginning of a UTC week
        let ts = await getBlockTimestamp(provider);
        await sleep(provider, (divf(ts, WEEK) + 1) * WEEK - ts);
        await mine(provider);

        ts = await getBlockTimestamp(provider);
        await ve.connect(alice).createLockFor(alice.address, amount, (await getBlockTimestamp(provider)) + WEEK);
        let end = divf(ts + WEEK, WEEK) * WEEK;
        expect(await ve.unlockTime(alice.address)).to.be.equal(end);

        await sleep(provider, H);

        await expect(ve.connect(alice).increaseUnlockTime(end + WEEK - 1)).to.be.revertedWithCustomError(
            ve,
            "TooEarly"
        );

        await ve.connect(alice).increaseUnlockTime(end + WEEK);
        end = divf(end + WEEK, WEEK) * WEEK;
        expect(await ve.unlockTime(alice.address)).to.be.equal(end);
    });
});
