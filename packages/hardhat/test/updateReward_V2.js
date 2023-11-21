const { expect } = require("chai");
const {
    end2endTestingStableCointAmount,
    deposit,
    getBeforeEachSetUp,
    initTokens,
    mineBlocks,
    isWithinPercentage,
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
        } = await getBeforeEachSetUp([
            { protocol: "ApolloX-ALP", percentage: 100 }
        ]));
        ({ ApolloX, USDC, USDT, APX } = await initTokens());
        vaultName = contracts.apolloxBscVault.name();
    });

    describe("ApolloX Contract Test", function () {
        it("userRewardsOfInvestedProtocols should be reset to 0 after claim()", async function () {
            await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "apollox-claim-alp-reward-deposit");
            
            const rewardPerShareZappedIn1 = await contracts.portfolioContract.rewardPerShareZappedIn(vaultName, APX.target);
            expect(rewardPerShareZappedIn1).to.equal(0);
            await mineBlocks(2000); // wait for 7 hours, otherwise the reward/shares would be too small and be rounded to 0
            await deposit(end2endTestingStableCointAmount, wallet2, contracts.portfolioContract, "apollox-claim-alp-reward-deposit");
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
                }
              }, { gasLimit });        
            expect(await contracts.portfolioContract.userRewardsOfInvestedProtocols(wallet.address, vaultName, APX.target)).to.equal(0);
            expect(await contracts.portfolioContract.userRewardPerTokenPaidPointerMapping(wallet.address, vaultName, APX.target)).to.equal(await contracts.portfolioContract.rewardPerShareZappedIn(vaultName, APX.target));
            expect(await contracts.portfolioContract.rewardPerShareZappedIn(vaultName, APX.target)).to.be.gt(0);
        })

        // it("Reward Should be different, if they zap in different timeing", async function () {
        //     this.timeout(2400000); // Set timeout to 120 seconds
        //     expect(await portfolioContract.userRewardsOfInvestedProtocols(wallet.address, vaultName, APX.target)).to.equal(0);
        //     expect(await portfolioContract.userRewardPerTokenPaidPointerMapping(wallet.address, vaultName, APX.target)).to.equal(0);
        //     expect(await portfolioContract.rewardPerShareZappedIn(vaultName, APX.target)).to.equal(0);
        //     const receipt = await deposit(end2endTestingAmount, wallet, pendleGLPZapInData, pendleGDAIZapInData, oneInchSwapDataForGDAI, oneInchSwapDataForRETH, pendleRETHZapInData, oneInchSwapDataForMagic, pendlePendleZapInData);

        //     await mineBlocks(1700); // wait for 7 hours, otherwise the reward/shares would be too small and be rounded to 0
        //     const claimableRewards = await portfolioContract.getClaimableRewards(wallet.address);
        //     for (claimableReward of claimableRewards) {
        //         if (claimableReward.protocol !== await vaultName) {
        //             expect(claimableReward.claimableRewards).to.deep.equal([]);
        //         } else {
        //             expect(claimableReward.claimableRewards.length).to.equal(8);
        //             for (const [index, reward] of claimableReward.claimableRewards.entries()) {
        //                 if (index === 0 || index === 1) {
        //                     expect(reward.amount).to.equal(0);
        //                     continue
        //                 }
        //                 expect(reward.amount).to.be.gt(0);
        //             }
        //         }
        //     }
        //     await deposit(end2endTestingAmount, wallet2, pendleGLPZapInData, pendleGDAIZapInData, oneInchSwapDataForGDAI, oneInchSwapDataForRETH, pendleRETHZapInData, oneInchSwapDataForMagic, pendlePendleZapInData);

        //     for (const rToken of radiantRTokens) {
        //         expect(await portfolioContract.rewardPerShareZappedIn(vaultName, rToken)).to.be.gt(0);
        //         expect(await portfolioContract.userRewardsOfInvestedProtocols(wallet2.address, vaultName, rToken)).to.equal(0);
        //     }
        //     expect(await portfolioContract.userRewardsOfInvestedProtocols(wallet.address, vaultName, APX.target)).to.equal(0);
        //     expect(await portfolioContract.userRewardPerTokenPaidPointerMapping(wallet.address, vaultName, APX.target)).to.equal(0);
        //     const rewardsOfWallet2 = await portfolioContract.getClaimableRewards(wallet2.address);
        //     for (const [vaultIdx, claimableReward] of (await portfolioContract.getClaimableRewards(wallet.address)).entries()) {
        //         if (claimableReward.protocol !== await vaultName) {
        //             expect(claimableReward.claimableRewards).to.deep.equal([]);
        //         } else {
        //             expect(claimableReward.claimableRewards.length).to.equal(8);
        //             for (const [index, reward] of claimableReward.claimableRewards.entries()) {
        //                 if (index === 0 || index === 1) {
        //                     expect(reward.amount).to.equal(0);
        //                     continue
        //                 }
        //                 const vaultRewardOfWallet2 = rewardsOfWallet2[vaultIdx].claimableRewards[index].amount;
        //                 expect(reward.amount).to.be.gt(vaultRewardOfWallet2);
        //             }
        //         }
        //     }
        // });

    });
});