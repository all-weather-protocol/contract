const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  end2endTestingStableCointAmount,
  deposit,
  getBeforeEachSetUp,
  initTokens,
  gasLimit,
  simulateTimeElasped,
  mineBlocks,
  isWithinPercentage,
  claim
} = require("../utilsBase");

const chain = 'base';
let wallet;
let wallet2;
let contracts;
let VelaTokenFarm;
let USDbC;
let esVELA;

describe("All Weather Protocol", function () {
  beforeEach(async () => {
    ({
      contracts,
      wallet,
      wallet2,
      deployer
    } = await getBeforeEachSetUp(chain, 'test'));
    ({VelaTokenFarm, USDbC, esVELA, VelaTokenFarm} = await initTokens(chain));
  });

  describe("Vela Base Contract Test", function () {
    it("Should be able to mint ALP with USDC", async function () {
      this.timeout(240000); // Set timeout to 120 seconds
      const receipt = await deposit(chain, end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "", USDbC.target, USDbC.target);
      // Iterate over the events and find the Deposit event
      for (const event of receipt.logs) {
        if (event.eventName === 'Transfer' && event.args[1] === contracts.velaBaseVault.target && event.args[0] === '0x0000000000000000000000000000000000000000') {
            vaultShares = event.args[2]
            expect(await contracts.velaBaseVault.balanceOf(contracts.portfolioContract.target)).to.equal(vaultShares);
            expect((await contracts.velaBaseVault.totalAssets())).to.equal(vaultShares);
            expect(isWithinPercentage(await contracts.portfolioContract.balanceOf(wallet.address), 960110726n, 0.1)).to.be.true;
            expect((await VelaTokenFarm.getStakedVLP(contracts.velaBaseVault.target))[0]).to.equal(vaultShares);
          }
        }
      }
    );
    it("Should be able to burn ALP and redeem to USDC", async function () {
      this.timeout(240000); // Set timeout to 120 seconds
      await deposit(chain, end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "", USDbC.target, USDbC.target);

      // await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "apollox-redeem-alp");
      await simulateTimeElasped(86400*2); // there's a 1-day constraint for redeeming ALP

      const shares = contracts.portfolioContract.balanceOf(wallet.address);
      const originalTokenOutBalance = await USDbC.balanceOf(wallet.address);
      await contracts.portfolioContract.connect(wallet).redeem({
        amount: shares,
        receiver: wallet.address,
        // apolloXRedeemData is just a placeholder for vela test case
        apolloXRedeemData: {
          alpTokenOut: USDbC.target,
          minOut: ethers.parseEther("9"),
          tokenOut: USDbC.target,
          aggregatorData: ethers.toUtf8Bytes('')
        },
        velaRedeemData: {
          vlpTokenOut: USDbC.target,
          tokenOut: USDbC.target,
          aggregatorData: ethers.toUtf8Bytes('')
        }
      }, { gasLimit });
      const currentTokenOutBalance = await USDbC.balanceOf(wallet.address);
      expect(isWithinPercentage(currentTokenOutBalance-originalTokenOutBalance, 9980007n, 0.1)).to.be.true;
    })
    // it("Should be able to check claimable rewards", async function () {
    //   const claimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
    //   for (const protocol of claimableRewards) {
    //     expect(protocol.claimableRewards).to.deep.equal([]);
    //   }
    //   await deposit(chain, end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "", USDbC.target, USDbC.target);
    //   await mineBlocks(1000);
    //   const newClaimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
    //   console.log("newClaimableRewards", newClaimableRewards[0])
    //   expect(isWithinPercentage(newClaimableRewards[0].claimableRewards[0].amount, 94867580725334n, 0.1)).to.be.true;
    // })
  });
});