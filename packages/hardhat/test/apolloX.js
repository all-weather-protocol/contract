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
} = require("./utilsBSC");


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
      const receipt = await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "apollox-mint-alp");
      // Iterate over the events and find the Deposit event
      for (const event of receipt.logs) {
        if (event.eventName === 'Transfer' && event.args[1] === contracts.apolloxBscVault.target && event.args[0] === '0x0000000000000000000000000000000000000000') {
            shares = event.args[2]
            expect(await contracts.apolloxBscVault.balanceOf(contracts.portfolioContract.target)).to.equal(shares);
            expect((await contracts.apolloxBscVault.totalAssets())).to.equal(shares);

            // at the time of writing, the price of ALP is 1.1175, so 100 USDC should be able to mint 89.307284980382532996 ALP
            expect(isWithinPercentage(await contracts.portfolioContract.balanceOf(wallet.address), 882513751n, 0.1)).to.be.true;
            expect((await ApolloX.stakeOf(contracts.apolloxBscVault.target))).to.equal(shares);
          }
        }
      }
    );
    it("Should be able to burn ALP and redeem to USDC", async function () {
      this.timeout(240000); // Set timeout to 120 seconds
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "apollox-redeem-alp");
      await simulateTimeElasped(86400*2); // there's a 1-day constraint for redeeming ALP

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
    })
    it("Should be able to check claimable rewards", async function () {
      const claimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      for (const protocol of claimableRewards) {
        expect(protocol.claimableRewards).to.deep.equal([]);
      }
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "apollox-check-alp-reward");
      await mineBlocks(100);
      const newClaimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      expect(isWithinPercentage(newClaimableRewards[0].claimableRewards[0].amount, 149747573175198n, 0.1)).to.be.true;
    })
    it("Should be able to claim ALP reward", async function () {
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "apollox-claim-alp-reward-deposit");
      await mineBlocks(100);

      const originalUSDCBalance = await USDC.balanceOf(wallet.address);
      // 149747573175198 stands for claimable APX reward
      await claim(wallet.address, wallet, 149747573175198, contracts.portfolioContract, "apollox-claim-alp-reward-claim")
      const currentUSDCBalance = await USDC.balanceOf(wallet.address);
      expect(isWithinPercentage(currentUSDCBalance-originalUSDCBalance, 8151379571079, 0.1)).to.be.true;
    })
    it("Should be able to claim performance fee", async function () {
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "apollox-claim-performance-fee-deposit");
      await mineBlocks(100);
      const claimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      await claim(wallet.address, wallet, 149746684213576, contracts.portfolioContract, "apollox-claim-performance-fee-claim")
      const claimablePerformanceFee = await APX.balanceOf(contracts.apolloxBscVault.target);
      // currently, the performance fee is set to 80%, therefore, claimablePerformanceFee*4: claimalbeRewards = 1:1 = 20%*4 = 80%
      console.log(claimablePerformanceFee*4n, claimableRewards[0].claimableRewards[0].amount);
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