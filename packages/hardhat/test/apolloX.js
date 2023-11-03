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
let ApolloX;
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
    it("Should be able to mint ALP with USDC", async function () {
      this.timeout(240000); // Set timeout to 120 seconds
      const apolloXDepositData = {
        tokenIn: USDC.address,
        // at the time of writing, the price of ALP is 1.1175, so assume the price is 1.2, including fee, as minALP
        minALP: (ethers.utils.parseEther("50")).div(12).mul(10)
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
            expect(await contracts.portfolioContract.balanceOf(wallet.address)).to.equal(ethers.BigNumber.from("4465364249"));
            expect((await ApolloX.stakeOf(contracts.apolloxBscVault.address))).to.equal(decodedEvent.shares);
          }
        }
      }
    });
    it("Should be able to burn ALP and redeem to USDC", async function () {
      this.timeout(240000); // Set timeout to 120 seconds
      const apolloXDepositData = {
        tokenIn: USDC.address,
        // at the time of writing, the price of ALP is 1.1175, so assume the price is 1.2, including fee, as minALP
        minALP: (ethers.utils.parseEther("50")).div(12).mul(10)
      }
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, apolloXDepositData);
      await simulateTimeElasped(86400*2); // there's a 1-day constraint for redeeming ALP

      const shares = contracts.portfolioContract.balanceOf(wallet.address);
      await contracts.portfolioContract.connect(wallet).redeem({
        amount: shares,
        receiver: wallet.address,
        apolloXRedeemData: {
          tokenOut: USDC.address,
          minOut: ethers.utils.parseEther("49")
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
        minALP: (ethers.utils.parseEther("50")).div(12).mul(10)
      }
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, apolloXDepositData);
      await mineBlocks(100);
      const newClaimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      expect(newClaimableRewards[0].claimableRewards[0].amount.toString()).to.eq("729662825499245");
    })
    it("Should be able to claim ALP reward", async function () {
      const apolloXDepositData = {
        tokenIn: USDC.address,
        // at the time of writing, the price of ALP is 1.1175, so assume the price is 1.2, including fee, as minALP
        minALP: (ethers.utils.parseEther("50")).div(12).mul(10)
      }
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, apolloXDepositData);
      await mineBlocks(100);

      const originalApxBalance = await APX.balanceOf(wallet.address);
      await contracts.portfolioContract.connect(wallet).claim(wallet.address);
      const currentApxBalance = await APX.balanceOf(wallet.address);
      expect(currentApxBalance-originalApxBalance).to.eq(736954758520382);
    })
    it("Should be able to claim performance fee", async function () {
      const apolloXDepositData = {
        tokenIn: USDC.address,
        // at the time of writing, the price of ALP is 1.1175, so assume the price is 1.2, including fee, as minALP
        minALP: (ethers.utils.parseEther("50")).div(12).mul(10)
      }
      await deposit(end2endTestingStableCointAmount, wallet, contracts.portfolioContract, apolloXDepositData);
      await mineBlocks(100);
      const claimableRewards = await contracts.portfolioContract.getClaimableRewards(wallet.address);
      await contracts.portfolioContract.connect(wallet).claim(wallet.address);
      const claimablePerformanceFee = await APX.balanceOf(contracts.apolloxBscVault.address);
      // currently, the performance fee is set to 80%, therefore, claimablePerformanceFee*4: claimalbeRewards = 1:1 = 20%*4 = 80%
      expect(claimablePerformanceFee*4-claimableRewards[0].claimableRewards[0].amount).to.be.lt(100000000000000);
      
      // claim performance Fee
      const originalApxBalance = await APX.balanceOf(wallet.address);
      const claimHexData = contracts.apolloxBscVault.interface.encodeFunctionData("transfer", [wallet.address, claimablePerformanceFee]);
      await contracts.apolloxBscVault.rescueFundsWithHexData(APX.address, 0, claimHexData);
      const currentApxBalance = await APX.balanceOf(wallet.address);
      expect(currentApxBalance-originalApxBalance).to.eq(184238938045718);
    })
  });
});