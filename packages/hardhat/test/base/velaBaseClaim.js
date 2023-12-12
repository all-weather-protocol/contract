const { expect } = require("chai");
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
    it("Should be able to check claimable rewards + claim rewards", async function () {
      const claimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      for (const protocol of claimableRewards) {
        expect(protocol.claimableRewards).to.deep.equal([]);
      }
      await deposit(chain, end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "", USDbC.target, USDbC.target);
      await mineBlocks(1000);
      const newClaimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      expect(isWithinPercentage(newClaimableRewards[0].claimableRewards[0].amount, 94867580725334n, 0.1)).to.be.true;
      const originalUSDCBalance = await esVELA.balanceOf(wallet.address);
      await claim(chain, wallet.address, wallet, contracts.portfolioContract, "")
      const currentUSDCBalance = await esVELA.balanceOf(wallet.address);
      expect(isWithinPercentage(currentUSDCBalance-originalUSDCBalance, 94962631687208n, 0.1)).to.be.true;
    })
    it("Should be able to claim performance fee", async function () {
        await deposit(chain, end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "", USDbC.target, USDbC.target);
        await mineBlocks(100);
        const claimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
        await claim(chain, wallet.address, wallet, contracts.portfolioContract, "")
        const claimablePerformanceFee = await esVELA.balanceOf(contracts.velaBaseVault.target);
        // currently, the performance fee is set to 80%, therefore, claimablePerformanceFee*4: claimalbeRewards = 1:1 = 20%*4 = 80%
        expect(isWithinPercentage(claimablePerformanceFee*4n, claimableRewards[0].claimableRewards[0].amount, 1)).to.be.true;
        
        // claim performance Fee
        const originalApxBalance = await esVELA.balanceOf(wallet.address);
        const claimHexData = esVELA.interface.encodeFunctionData("transfer", [wallet.address, claimablePerformanceFee]);
        await contracts.velaBaseVault.rescueFundsWithHexData(esVELA.target, 0, claimHexData, {singer: deployer});
        const currentApxBalance = await esVELA.balanceOf(wallet.address);
        expect(isWithinPercentage(currentApxBalance-originalApxBalance, 2395259238426n, 0.1)).to.be.true;
    })
  });
});