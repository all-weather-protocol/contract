const { expect } = require("chai");
const { fetch1InchSwapData,
  myImpersonatedWalletAddress,
  sushiSwapDpxLpTokenAddress,
  sushiMiniChefV2Address,
  wethAddress,
  radiantDlpAddress,
  radiantLendingPoolAddress,
  sushiPid,
  multiFeeDistributionAddress,
  end2endTestingAmount,
  fsGLPAddress,
  getPendleZapInData,
  getPendleZapOutData,
  gDAIMarketPoolAddress,
  mineBlocks,
  gDAIAddress,
  pendleTokenAddress,
  gasLimit,
  daiAddress,
  gDAIRewardPoolAddress,
  glpMarketPoolAddress,
  claimableRewardsTestData,
  amountAfterChargingFee
} = require("./utils");


let wallet;
let weth;
let radiantVault;
let portfolioContract;
let oneInchSwapDataForDpx;
let oneInchSwapDataForGDAI;
let pendleGLPZapInData;
let pendleGDAIZapInData;
let portfolioShares;


async function deposit() {
  const depositData = {
    amount: end2endTestingAmount,
    receiver: wallet.address,
    oneInchDataDpx: oneInchSwapDataForDpx.tx.data,
    glpMinLpOut: pendleGLPZapInData[2],
    glpGuessPtReceivedFromSy: pendleGLPZapInData[3],
    glpInput: pendleGLPZapInData[4],
    gdaiMinLpOut: pendleGDAIZapInData[2],
    gdaiGuessPtReceivedFromSy: pendleGDAIZapInData[3],
    gdaiInput: pendleGDAIZapInData[4],
    gdaiOneInchDataGDAI: oneInchSwapDataForGDAI.tx.data
  }
  return await (await portfolioContract.connect(wallet).deposit(depositData)).wait();
}


describe("All Weather Protocol", function () {
  beforeEach(async () => {
    this.timeout(240000); // Set timeout to 120 seconds
    wallet = await ethers.getImpersonatedSigner(myImpersonatedWalletAddress);
    dpxSLP = await ethers.getContractAt('IERC20Uniswap', sushiSwapDpxLpTokenAddress);
    weth = await ethers.getContractAt('IWETH', wethAddress);
    dlpToken = await ethers.getContractAt("MockDAI", radiantDlpAddress);
    fsGLP = await ethers.getContractAt("IERC20", fsGLPAddress);
    pendleGlpMarketLPT = await ethers.getContractAt("IERC20", glpMarketPoolAddress);
    pendleGDAIMarketLPT = await ethers.getContractAt("IERC20", gDAIMarketPoolAddress);
    pendleToken = await ethers.getContractAt("IERC20", pendleTokenAddress);
    daiToken = await ethers.getContractAt("IERC20", daiAddress);
    gDAIToken = await ethers.getContractAt("IERC20", gDAIAddress);
    // we can check our balance in equilibria with this reward pool
    dGDAIRewardPool = await ethers.getContractAt("IERC20", gDAIRewardPoolAddress);
    radiantLendingPool = await ethers.getContractAt("ILendingPool", radiantLendingPoolAddress);
    multiFeeDistribution = await ethers.getContractAt("IMultiFeeDistribution", multiFeeDistributionAddress);
    await weth.connect(wallet).deposit({ value: ethers.utils.parseEther("1"), gasLimit });
    
    const RadiantArbitrumVault = await ethers.getContractFactory("RadiantArbitrumVault");
    radiantVault = await RadiantArbitrumVault.deploy(dlpToken.address, radiantLendingPoolAddress);
    await radiantVault.deployed();
    
    const DpxArbitrumVault = await ethers.getContractFactory("DpxArbitrumVault");
    dpxVault = await DpxArbitrumVault.deploy(dpxSLP.address, sushiMiniChefV2Address, sushiPid);
    await dpxVault.deployed();

    const EquilibriaGlpVault = await ethers.getContractFactory("EquilibriaGlpVault");
    equilibriaGlpVault = await EquilibriaGlpVault.deploy(pendleGlpMarketLPT.address, "Equilibria-GLP", "ALP-EQB-GLP");
    await equilibriaGlpVault.deployed();

    const EquilibriaGDAIVault = await ethers.getContractFactory("EquilibriaGDAIVault");
    equilibriaGDAIVault = await EquilibriaGDAIVault.deploy(pendleGDAIMarketLPT.address, "Equilibria-GDAI", "ALP-EQB-GDAI");
    await equilibriaGDAIVault.deployed();
    
    const AllWeatherPortfolioLPToken = await ethers.getContractFactory("AllWeatherPortfolioLPToken");
    portfolioContract = await AllWeatherPortfolioLPToken.connect(wallet).deploy(weth.address, radiantVault.address, dpxVault.address, equilibriaGlpVault.address, equilibriaGDAIVault.address);
    await portfolioContract.connect(wallet).deployed();
    await portfolioContract.setVaultAllocations([{protocol: "Equilibria-GDAI", percentage: 100}]).then((tx) => tx.wait());
    await (await weth.connect(wallet).approve(portfolioContract.address, end2endTestingAmount, { gasLimit: gasLimit })).wait();

    oneInchSwapDataForDpx = await fetch1InchSwapData(weth.address, daiToken.address, amountAfterChargingFee.div(2), wallet.address, 50);
    oneInchSwapDataForGDAI = await fetch1InchSwapData(weth.address, daiToken.address, amountAfterChargingFee, wallet.address, 50);
    pendleGLPZapInData = await getPendleZapInData(42161, glpMarketPoolAddress, amountAfterChargingFee, 0.99);
    pendleGDAIZapInData = await getPendleZapInData(42161, gDAIMarketPoolAddress, ethers.BigNumber.from(oneInchSwapDataForGDAI.toAmount).mul(50).div(100), 0.99, daiToken.address);
    portfolioShares = amountAfterChargingFee.div(await portfolioContract.unitOfShares());
  });

  describe("Portfolio LP Contract Test", function () {
    it("Should be able to zapin with WETH into equilibria GDAI", async function () {
      this.timeout(240000); // Set timeout to 120 seconds
      const receipt = await deposit();
      // Iterate over the events and find the Deposit event
      for (const event of receipt.events) {
        if (event.topics.includes(equilibriaGDAIVault.interface.getEventTopic('Deposit'))) {
          const decodedEvent = equilibriaGDAIVault.interface.decodeEventLog('Deposit', event.data, event.topics);
          if (decodedEvent.owner === portfolioContract.address) {
            expect(await equilibriaGDAIVault.balanceOf(portfolioContract.address)).to.equal(decodedEvent.shares);
            expect((await equilibriaGDAIVault.totalAssets())).to.equal(decodedEvent.shares);
            expect(await portfolioContract.balanceOf(wallet.address)).to.equal(portfolioShares);
            expect((await dGDAIRewardPool.balanceOf(equilibriaGDAIVault.address))).to.equal(decodedEvent.shares);
          }
        }
      }
    });
    it("Should be able to withdraw GDAI from equilibria", async function () {
      this.timeout(240000); // Set timeout to 120 seconds
      const receipt = await deposit();
      let shares;
      for (const event of receipt.events) {
        if (event.topics.includes(equilibriaGDAIVault.interface.getEventTopic('Deposit'))) {
          const decodedEvent = equilibriaGDAIVault.interface.decodeEventLog('Deposit', event.data, event.topics);
          if (decodedEvent.owner === portfolioContract.address) {
            shares = decodedEvent.shares;
          }
        }
      }
      const pendleZapOutData = await getPendleZapOutData(42161, gDAIMarketPoolAddress, gDAIToken.address, shares, 0.99);
      // // withdraw
      await (await portfolioContract.connect(wallet).redeem(portfolioShares, wallet.address, pendleZapOutData[3], { gasLimit })).wait();
      expect(await pendleGDAIMarketLPT.balanceOf(wallet.address)).to.equal(shares);
      expect(await equilibriaGDAIVault.totalAssets()).to.equal(0);
    });

    it("Should be able to claim rewards", async function () {
      this.timeout(240000); // Set timeout to 120 seconds
      await deposit();
      await mineBlocks(100); // Mine 100 blocks
      const originalPendleToken = await pendleToken.balanceOf(wallet.address);
      const claimableRewards = await portfolioContract.getClaimableRewards(wallet.address);
      let pendleClaimableReward;
      for (const claimableReward of claimableRewards) {
        if (claimableReward.protocol !== "Equilibria-GDAI") {
          expect(claimableReward.claimableRewards).to.deep.equal([]);
        } else {
          expect(claimableReward.claimableRewards.length).to.equal(1);
          pendleClaimableReward = claimableReward.claimableRewards[0].amount;
          expect(pendleClaimableReward).to.be.gt(0);
        }
      }

      await portfolioContract.connect(wallet).claim(wallet.address);
      // NOTE: using `to.be.gt` instead of `to.equal` because the reward would somehow be increased after claim(). My hunch is that `claim()` would also claim the reward for the current block.
      expect((await pendleToken.balanceOf(wallet.address)).sub(originalPendleToken)).to.be.gt(pendleClaimableReward);
      const remainingClaimableRewards = await portfolioContract.connect(wallet).getClaimableRewards(wallet.address);
      for (const claimableReward of remainingClaimableRewards) {
        if (claimableReward.protocol === "Equilibria-GDAI") {
          expect(claimableReward.claimableRewards[0].amount).to.equal(0);
        }
      }
    })
    it("Should be able to check claimable rewards", async function () {
      const claimableRewards = await portfolioContract.getClaimableRewards(wallet.address);
      expect(claimableRewards).to.deep.equal(claimableRewardsTestData);
    })
  });
});