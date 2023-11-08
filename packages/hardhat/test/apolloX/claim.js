const { expect } = require("chai");
const {
  end2endTestingStableCointAmount,
  deposit,
  getBeforeEachSetUp,
  initTokens,
  mineBlocks,
  claim,
} = require("../utilsBSC");


let wallet;
let contracts;
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
    it("Should be able to claim ALP reward", async function () {
      const apolloXDepositData = {
        tokenIn: USDC.target,
        // at the time of writing, the price of ALP is 1.1175, so assume the price is 1.2, including fee, as minALP
        minALP: ethers.parseEther("50") / BigInt(12) * BigInt(10)
      }
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, apolloXDepositData);
      await mineBlocks(100);

      const originalApxBalance = await USDC.balanceOf(wallet.address);
      await claim(wallet.address, wallet, 746290228027986, contracts.portfolioContract)
      const currentApxBalance = await USDC.balanceOf(wallet.address);
      expect(currentApxBalance-originalApxBalance).to.eq(41132404187456);
    })
  })
});