const { expect } = require("chai");
const {
  end2endTestingStableCointAmount,
  deposit,
  getBeforeEachSetUp,
  initTokens,
  gasLimit,
  simulateTimeElasped,
  mineBlocks
} = require("./utilsBSC");


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
    ({APX, USDC} = await initTokens());
  });

  describe("ApolloX Contract Test", function () {
    it("Should be able to mint ALP with USDC", async function () {
      this.timeout(240000); // Set timeout to 120 seconds
      const apolloXDepositData = {
        tokenIn: USDC.address,
        // at the time of writing, the price of ALP is 1.1175, so assume the price is 1.2, including fee, as minALP
        minALP: (ethers.utils.parseEther("100")).div(12).mul(10)
      }
      const receipt = await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, apolloXDepositData);

      // Iterate over the events and find the Deposit event
      for (const event of receipt.events) {
        if (event.topics.includes(contracts.apolloxBscVault.interface.getEventTopic('Deposit')) && event.address === contracts.apolloxBscVault.address) {
          const decodedEvent = contracts.apolloxBscVault.interface.decodeEventLog('Deposit', event.data, event.topics);
          if (decodedEvent.owner === contracts.portfolioContract.address) {
            expect(await contracts.apolloxBscVault.balanceOf(contracts.portfolioContract.address)).to.equal(decodedEvent.shares);
            expect((await contracts.apolloxBscVault.totalAssets())).to.equal(decodedEvent.shares);

            // at the time of writing, the price of ALP is 1.1175, so 100 USDC should be able to mint 89.307284980382532996 ALP
            expect(await contracts.portfolioContract.balanceOf(wallet.address)).to.equal(ethers.BigNumber.from("8930728498"));
            expect((await APX.stakeOf(contracts.apolloxBscVault.address))).to.equal(decodedEvent.shares);
          }
        }
      }
    });
    it("Should be able to burn ALP and redeem to USDC", async function () {
      this.timeout(240000); // Set timeout to 120 seconds
      const apolloXDepositData = {
        tokenIn: USDC.address,
        // at the time of writing, the price of ALP is 1.1175, so assume the price is 1.2, including fee, as minALP
        minALP: (ethers.utils.parseEther("100")).div(12).mul(10)
      }
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, apolloXDepositData);
      await simulateTimeElasped(86400*2); // there's a 1-day constraint for redeeming ALP

      const shares = contracts.portfolioContract.balanceOf(wallet.address);
      await contracts.portfolioContract.connect(wallet).redeem({
        amount: shares,
        receiver: wallet.address,
        apolloXRedeemData: {
          tokenOut: USDC.address,
          minOut: ethers.utils.parseEther("99")
        }
      }, { gasLimit });
    })
    it("Should be able to check claimable rewards", async function () {
      const claimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      for (const protocol of claimableRewards) {
        expect(protocol.claimableRewards).to.deep.equal([]);
      }
      const apolloXDepositData = {
        tokenIn: USDC.address,
        // at the time of writing, the price of ALP is 1.1175, so assume the price is 1.2, including fee, as minALP
        minALP: (ethers.utils.parseEther("100")).div(12).mul(10)
      }
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, apolloXDepositData);
      await mineBlocks(100);
      const newClaimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      expect(newClaimableRewards[0].claimableRewards[0].amount).to.be.gt(ethers.BigNumber.from("0"));
    })
    it("Should be able to claim ALP reward", async function () {
      
    })
  });
});