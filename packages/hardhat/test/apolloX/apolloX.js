const { expect } = require("chai");
const {
  end2endTestingStableCointAmount,
  deposit,
  getBeforeEachSetUp,
  initTokens,
  gasLimit,
  simulateTimeElasped,
  mineBlocks,
  isWithinPercentage
} = require("../utilsBSC");


let wallet;
let contracts;
let ApolloX;
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
    it("Should be able to mint ALP with USDC", async function () {
      this.timeout(240000); // Set timeout to 120 seconds
      const apolloXDepositData = {
        tokenIn: USDC.target,
        // at the time of writing, the price of ALP is 1.1175, so assume the price is 1.2, including fee, as minALP
        minALP: ethers.parseEther("50")/ BigInt(12) * BigInt(10)
      }
      const receipt = await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, apolloXDepositData);
      // Iterate over the events and find the Deposit event
      for (const event of receipt.logs) {
        if (event.eventName === 'Transfer' && event.args[1] === contracts.apolloxBscVault.target && event.args[0] === '0x0000000000000000000000000000000000000000') {
            shares = event.args[2]
            expect(await contracts.apolloxBscVault.balanceOf(contracts.portfolioContract.target)).to.equal(shares);
            expect((await contracts.apolloxBscVault.totalAssets())).to.equal(shares);

            // at the time of writing, the price of ALP is 1.1175, so 100 USDC should be able to mint 89.307284980382532996 ALP
            expect(isWithinPercentage(await contracts.portfolioContract.balanceOf(wallet.address), 4412258408n, 0.1)).to.be.true;
            expect((await ApolloX.stakeOf(contracts.apolloxBscVault.target))).to.equal(shares);
          }
        }
      }
    );
    it("Should be able to burn ALP and redeem to USDC", async function () {
      this.timeout(240000); // Set timeout to 120 seconds
      const apolloXDepositData = {
        tokenIn: USDC.target,
        // at the time of writing, the price of ALP is 1.1175, so assume the price is 1.2, including fee, as minALP
        minALP: ethers.parseEther("50")/ BigInt(12) * BigInt(10)
      }
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, apolloXDepositData);
      await simulateTimeElasped(86400*2); // there's a 1-day constraint for redeeming ALP

      const shares = contracts.portfolioContract.balanceOf(wallet.address);
      await contracts.portfolioContract.connect(wallet).redeem({
        amount: shares,
        receiver: wallet.address,
        apolloXRedeemData: {
          tokenOut: USDC.target,
          minOut: ethers.parseEther("49")
        }
      }, { gasLimit });
    })
    it("Should be able to check claimable rewards", async function () {
      const claimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      for (const protocol of claimableRewards) {
        expect(protocol.claimableRewards).to.deep.equal([]);
      }
      const apolloXDepositData = {
        tokenIn: USDC.target,
        // at the time of writing, the price of ALP is 1.1175, so assume the price is 1.2, including fee, as minALP
        minALP: ethers.parseEther("50")/ BigInt(12) * BigInt(10)
      }
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, apolloXDepositData);
      await mineBlocks(100);
      const newClaimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      expect(isWithinPercentage(newClaimableRewards[0].claimableRewards[0].amount, 748680831186256n, 0.1)).to.be.true;
    })
  });
});