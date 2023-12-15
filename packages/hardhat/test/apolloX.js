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
} = require("./utilsBSC");


let wallet;
let contracts;
let ApolloX;
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
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "", USDT.target, USDT.target);
      await simulateTimeElasped(86400*2); // there's a 1-day constraint for redeeming ALP

      const shares = contracts.portfolioContract.balanceOf(wallet.address);
      const originalTokenOutBalance = await USDC.balanceOf(wallet.address);
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
      const currentTokenOutBalance = await USDC.balanceOf(wallet.address);
      expect(isWithinPercentage(currentTokenOutBalance-originalTokenOutBalance, 9950762154937376252n, 0.1)).to.be.true;
    })
    it("Should be able to check claimable rewards", async function () {
      const claimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      for (const protocol of claimableRewards) {
        expect(protocol.claimableRewards).to.deep.equal([]);
      }
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, "", USDT.target, USDT.target);
      await mineBlocks(100);
      const newClaimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      expect(isWithinPercentage(newClaimableRewards[0].claimableRewards[0].amount, 149747573175198n, 0.1)).to.be.true;
    })
  });
});