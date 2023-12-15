const { expect } = require("chai");
const {
    end2endTestingStableCointAmount,
    deposit,
    getBeforeEachSetUp,
    initTokens,
    mineBlocks,
    simulateTimeElasped,
    claim,
    gasLimit
} = require("./utilsBSC");


let wallet;
let wallet2;
let contracts;
let USDC;
let USDT;
let currentTimestamp = Math.floor(Date.now() / 1000);
let vaultName;
describe("All Weather Protocol", function () {
    beforeEach(async () => {
        ({
            contracts,
            wallet,
            wallet2,
            deployer
        } = await getBeforeEachSetUp());
        ({ ApolloX, USDC, USDT, APX } = await initTokens());
        vaultName = contracts.apolloxBscVault.name();
    });

    describe("ApolloX Contract Test", function () {
        it("userRewardsOfInvestedProtocols should be reset to 0 after claim()", async function () {
            await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "", USDT.target, USDT.target);
            
            const rewardPerShareZappedIn1 = await contracts.portfolioContract.rewardPerShareZappedIn(vaultName, APX.target);
            expect(rewardPerShareZappedIn1).to.equal(0);
            await mineBlocks(2000); // wait for 7 hours, otherwise the reward/shares would be too small and be rounded to 0
            await deposit(end2endTestingStableCointAmount, wallet2, contracts.portfolioContract, "", USDT.target, USDT.target);
            const rewardPerShareZappedIn2 = await contracts.portfolioContract.rewardPerShareZappedIn(vaultName, APX.target);
            expect(rewardPerShareZappedIn2).to.be.gt(rewardPerShareZappedIn1);

            // claim
            
            expect(await contracts.portfolioContract.userRewardPerTokenPaidPointerMapping(wallet.address, vaultName, APX.target)).to.equal(0);
            await claim(wallet.address, wallet, 149747573175198, contracts.portfolioContract, "apollox-claim-alp-reward-claim")
            expect(await contracts.portfolioContract.userRewardPerTokenPaidPointerMapping(wallet.address, vaultName, APX.target)).to.equal(await contracts.portfolioContract.rewardPerShareZappedIn(vaultName, APX.target));
            expect(await contracts.portfolioContract.userRewardsOfInvestedProtocols(wallet.address, vaultName, APX.target)).to.equal(0);
            expect(await contracts.portfolioContract.userRewardsOfInvestedProtocols(wallet2.address, vaultName, APX.target)).to.equal(0);

            // 2nd deposit for wallet2
            await mineBlocks(2000); // wait for 7 hours, otherwise the reward/shares would be too small and be rounded to 0
            await deposit(end2endTestingStableCointAmount, wallet2, contracts.portfolioContract, "", USDT.target, USDT.target);

            expect(await contracts.portfolioContract.userRewardsOfInvestedProtocols(wallet2.address, vaultName, APX.target)).to.be.gt(0);
            await claim(wallet2.address, wallet2, 149746684213576, contracts.portfolioContract, "apollox-claim-alp-reward-claim")
            expect(await contracts.portfolioContract.userRewardsOfInvestedProtocols(wallet2.address, vaultName, APX.target)).to.equal(0);
            expect(await contracts.portfolioContract.userRewardPerTokenPaidPointerMapping(wallet2.address, vaultName, APX.target)).to.equal(await contracts.portfolioContract.rewardPerShareZappedIn(vaultName, APX.target));
            const rewardPerShareZappedIn3 = await contracts.portfolioContract.rewardPerShareZappedIn(vaultName, APX.target);
            expect(rewardPerShareZappedIn3).to.be.gt(rewardPerShareZappedIn2);
        })
        it("userRewardsOfInvestedProtocols should be reset to 0 after redeem()", async function () {
            await deposit(end2endTestingStableCointAmount, wallet2, contracts.portfolioContract, "", USDT.target, USDT.target);
            currentTimestamp += 24 * 31 * 24 * 60 * 60; // Increment timestamp
            await simulateTimeElasped();

            const shares = contracts.portfolioContract.balanceOf(wallet.address);
            await contracts.portfolioContract.connect(wallet).redeem({
                amount: shares,
                receiver: wallet.address,
                apolloXRedeemData: {
                  alpTokenOut: USDC.target,
                  minOut: ethers.parseEther("9"),
                  tokenOut: USDC.target,
                  aggregatorData: ethers.toUtf8Bytes('')
                },
                velaRedeemData: {
                    vlpTokenOut: USDC.target,
                    tokenOut: USDC.target,
                    aggregatorData: ethers.toUtf8Bytes('')
                  }  
              }, { gasLimit });        
            expect(await contracts.portfolioContract.userRewardsOfInvestedProtocols(wallet.address, vaultName, APX.target)).to.equal(0);
            expect(await contracts.portfolioContract.userRewardPerTokenPaidPointerMapping(wallet.address, vaultName, APX.target)).to.equal(await contracts.portfolioContract.rewardPerShareZappedIn(vaultName, APX.target));
            expect(await contracts.portfolioContract.rewardPerShareZappedIn(vaultName, APX.target)).to.be.gt(0);
        })

        it("Reward Should be different, if they zap in different timeing", async function () {
            this.timeout(2400000); // Set timeout to 120 seconds
            expect(await contracts.portfolioContract.userRewardsOfInvestedProtocols(wallet.address, vaultName, APX.target)).to.equal(0);
            expect(await contracts.portfolioContract.userRewardPerTokenPaidPointerMapping(wallet.address, vaultName, APX.target)).to.equal(0);
            expect(await contracts.portfolioContract.rewardPerShareZappedIn(vaultName, APX.target)).to.equal(0);
            await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "", USDT.target, USDT.target);
            await mineBlocks(1700); // wait for 7 hours, otherwise the reward/shares would be too small and be rounded to 0
            const claimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
            for (claimableReward of claimableRewards) {
                if (claimableReward.protocol !== await vaultName) {
                    expect(claimableReward.claimableRewards).to.deep.equal([]);
                } else {
                    expect(claimableReward.claimableRewards.length).to.equal(1);
                    for (const [index, reward] of claimableReward.claimableRewards.entries()) {
                        expect(reward.amount).to.be.gt(0);
                    }
                }
            }
            await deposit(end2endTestingStableCointAmount, wallet2, contracts.portfolioContract, "", USDT.target, USDT.target);
            expect(await contracts.portfolioContract.rewardPerShareZappedIn(vaultName, APX.target)).to.be.gt(0);
            expect(await contracts.portfolioContract.userRewardsOfInvestedProtocols(wallet2.address, vaultName, APX.target)).to.equal(0);
            expect(await contracts.portfolioContract.userRewardsOfInvestedProtocols(wallet.address, vaultName, APX.target)).to.equal(0);
            expect(await contracts.portfolioContract.userRewardPerTokenPaidPointerMapping(wallet.address, vaultName, APX.target)).to.equal(0);
            await checkClaimableRewards(wallet2.address, wallet.address);
        });
        it("Portfolio Shares should be able to transfer and update the reward pointer correctly!", async function () {
            this.timeout(2400000); // Set timeout to 120 seconds
            await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "", USDT.target, USDT.target);
            await mineBlocks(1700);
            const originalPointersOfThisPortfolioForRecordingDistributedRewards = await contracts.portfolioContract.pointersOfThisPortfolioForRecordingDistributedRewards(contracts.apolloxBscVault.target, APX.target);
            expect(originalPointersOfThisPortfolioForRecordingDistributedRewards).to.equal(0);
            await checkClaimableRewards(wallet.address, wallet2.address, "transfer");
            await contracts.portfolioContract.connect(wallet).transfer(wallet2.address, contracts.portfolioContract.balanceOf(wallet.address));
            await checkClaimableRewards(wallet.address, wallet2.address, "transfer");

            const wallet1Reward = await contracts.portfolioContract.userRewardsOfInvestedProtocols(wallet.address, vaultName, APX.target);
            expect(wallet1Reward).to.be.eq(0);
            const wallet1RewardBalance = await APX.balanceOf(wallet.address);
            expect(wallet1RewardBalance).to.be.gt(0);
            const wallet2Reward = await contracts.portfolioContract.userRewardsOfInvestedProtocols(wallet2.address, vaultName, APX.target);
            expect(wallet2Reward).to.eq(0);

            const wallet1Pointer = await contracts.portfolioContract.userRewardPerTokenPaidPointerMapping(wallet.address, vaultName, APX.target);
            const wallet2Pointer = await contracts.portfolioContract.userRewardPerTokenPaidPointerMapping(wallet.address, vaultName, APX.target);
            const rewardPerShareZappedIn = await contracts.portfolioContract.rewardPerShareZappedIn(vaultName, APX.target);
            expect(wallet1Pointer).to.equal(wallet2Pointer);
            expect(wallet1Pointer).to.equal(rewardPerShareZappedIn);
            
            const pointersOfThisPortfolioForRecordingDistributedRewards = await contracts.portfolioContract.pointersOfThisPortfolioForRecordingDistributedRewards(contracts.apolloxBscVault.target, APX.target);
            expect(pointersOfThisPortfolioForRecordingDistributedRewards).to.eq(0);

            const fakeReward = 10000000;
            await contracts.portfolioContract.updateMappings("userRewardsOfInvestedProtocols", wallet2.address, vaultName, APX.target, fakeReward, {signer: wallet});
            const updatedWallet2Reward = await contracts.portfolioContract.userRewardsOfInvestedProtocols(wallet2.address, vaultName, APX.target);
            expect(updatedWallet2Reward).to.eq(fakeReward);
        });
    });
});

async function checkClaimableRewards(address, address2, mode = "normal") {
    const rewardsOfWallet = await contracts.portfolioContract.getClaimableRewards(address);
    for (const [vaultIdx, claimableReward] of (await contracts.portfolioContract.getClaimableRewards(address2)).entries()) {
        if (claimableReward.protocol !== await vaultName) {
            expect(claimableReward.claimableRewards).to.deep.equal([]);
        } else {
            expect(claimableReward.claimableRewards.length).to.equal(1);
            for (const [index, reward] of claimableReward.claimableRewards.entries()) {
                const vaultRewardOfWallet = rewardsOfWallet[vaultIdx].claimableRewards[index].amount;
                if (mode === "normal") {
                    expect(reward.amount).to.be.gt(vaultRewardOfWallet);
                } else {
                    expect(reward.amount).to.equal(0);
                }
            }
        }
    }

}