const { expect } = require("chai");
const {
  end2endTestingStableCointAmount,
  deposit,
  getBeforeEachSetUp,
  initTokens,
  mineBlocks,
  claim,
  isWithinPercentage
} = require("../utilsBSC");


let wallet;
let contracts;
let APX;
let USDC;
describe("All Weather Protocol", function () {
  beforeEach(async () => {
    ({
      contracts,
      wallet,
      wallet2,
      deployer
    } = await getBeforeEachSetUp([
        {protocol: "ApolloX-ALP", percentage: 100}
      ]));
    ({ApolloX, USDC, APX} = await initTokens());
  });

  describe("ApolloX Contract Test", function () {
    it("Should be able to claim performance fee", async function () {
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract);
      await mineBlocks(100);
      const claimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      await claim(wallet.address, wallet, 746290228027986, contracts.portfolioContract)
      const claimablePerformanceFee = await APX.balanceOf(contracts.apolloxBscVault.target);
      // currently, the performance fee is set to 80%, therefore, claimablePerformanceFee*4: claimalbeRewards = 1:1 = 20%*4 = 80%
      expect(claimablePerformanceFee*4n-claimableRewards[0].claimableRewards[0].amount).to.be.lt(100000000000000n);
      
      // claim performance Fee
      const originalApxBalance = await APX.balanceOf(wallet.address);
      const claimHexData = APX.interface.encodeFunctionData("transfer", [wallet.address, claimablePerformanceFee]);
      await contracts.apolloxBscVault.connect(deployer).rescueFundsWithHexData(APX.target, 0, claimHexData);
      const currentApxBalance = await APX.balanceOf(wallet.address);
      expect(isWithinPercentage(currentApxBalance-originalApxBalance, 189042858528365n, 0.1)).to.be.true;
    })
  });
});