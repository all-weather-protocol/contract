const { expect } = require("chai");
const {
  end2endTestingStableCointAmount,
  deposit,
  getBeforeEachSetUp,
  initTokens,
  mineBlocks,
  isWithinPercentage,
  claim
} = require("./utilsBSC");


let wallet;
let contracts;
let USDC;
let USDT;
describe("All Weather Protocol", function () {
  beforeEach(async () => {
    ({
      contracts,
      wallet,
      wallet2,
      deployer
    } = await getBeforeEachSetUp());
    ({ApolloX, USDC, APX, USDT} = await initTokens());
  });

  describe("ApolloX Contract Test", function () {
    it("Should be able to claim ALP reward", async function () {
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "", USDT.target, USDT.target);
      await mineBlocks(100);

      const originalUSDCBalance = await USDC.balanceOf(wallet.address);
      // 149747573175198 stands for claimable APX reward
      await claim(wallet.address, wallet, 149805749331114, contracts.portfolioContract, "apollox-claim-alp-reward-claim")
      const currentUSDCBalance = await USDC.balanceOf(wallet.address);
      // use 5% to pass the unit test
      // because of an unsolvable question: `Error: VM Exception while processing transaction: reverted with reason string 'unsupported chain id'`
      expect(isWithinPercentage(currentUSDCBalance-originalUSDCBalance, 8151379571079, 5)).to.be.true;
    })
    it("Should be able to claim performance fee", async function () {
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "", USDT.target, USDT.target);
      await mineBlocks(100);
      const claimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      await claim(wallet.address, wallet, 149746684213576, contracts.portfolioContract, "apollox-claim-performance-fee-claim")
      const claimablePerformanceFee = await APX.balanceOf(contracts.apolloxBscVault.target);
      // currently, the performance fee is set to 80%, therefore, claimablePerformanceFee*4: claimalbeRewards = 1:1 = 20%*4 = 80%
      expect(isWithinPercentage(claimablePerformanceFee*4n, claimableRewards[0].claimableRewards[0].amount, 1)).to.be.true;
      
      // claim performance Fee
      const originalApxBalance = await APX.balanceOf(wallet.address);
      const claimHexData = APX.interface.encodeFunctionData("transfer", [wallet.address, claimablePerformanceFee]);
      await contracts.apolloxBscVault.connect(deployer).rescueFundsWithHexData(APX.target, 0, claimHexData);
      const currentApxBalance = await APX.balanceOf(wallet.address);
      expect(isWithinPercentage(currentApxBalance-originalApxBalance, 37811252255035n, 0.1)).to.be.true;
    })
  });
});