const { expect } = require("chai");
const {
  end2endTestingStableCointAmount,
  deposit,
  getBeforeEachSetUp,
} = require("./utilsBSC");


let wallet;
let contracts;
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
  });

  describe("ApolloX Contract Test", function () {
    it("Should be able to mint ALP with USDC", async function () {
      this.timeout(240000); // Set timeout to 120 seconds
      const a = await contracts.portfolioContract.getPortfolioAllocation();
      console.log(a)
      const receipt = await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract);

    });
  });
});