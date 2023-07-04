const { expect } = require("chai");
const { fetch1InchSwapData, mineBlocks, myImpersonatedWalletAddress,
  sushiSwapDpxLpTokenAddress,
  sushiMiniChefV2Address,
  dpxTokenAddress,
  sushiTokenAddress,
  wethAddress,
  radiantDlpAddress,
  radiantLockZapAddress,
  sushiPid,
  gasLimit,
  rRewardTokens,
  glpMarketPoolAddress,
  getPendleZapInData,
  getPendleZapOutData,
  fakePendleZapOut,
  dpxAmount } = require("./utils");

let wallet;
let dpxVault;
let portfolioContract;

describe("All Weather Protocol", function () {
  beforeEach(async () => {
    wallet = await ethers.getImpersonatedSigner(myImpersonatedWalletAddress);
    dpxSLP = await ethers.getContractAt('IERC20Uniswap', sushiSwapDpxLpTokenAddress);
    miniChefV2 = await ethers.getContractAt('IMiniChefV2', sushiMiniChefV2Address);
    dpxToken = await ethers.getContractAt('MockDAI', dpxTokenAddress);
    dlpToken = await ethers.getContractAt("MockDAI", radiantDlpAddress);
    sushiToken = await ethers.getContractAt('MockDAI', sushiTokenAddress);
    pendleGlpMarketLPT = await ethers.getContractAt("IERC20", glpMarketPoolAddress);
    weth = await ethers.getContractAt('IWETH', wethAddress);

    const RadiantArbitrumVault = await ethers.getContractFactory("RadiantArbitrumVault");
    radiantVault = await RadiantArbitrumVault.deploy(dlpToken.address, radiantLockZapAddress);
    await radiantVault.deployed();


    const DpxArbitrumVault = await ethers.getContractFactory("DpxArbitrumVault");
    dpxVault = await DpxArbitrumVault.deploy(dpxSLP.address, sushiMiniChefV2Address, sushiPid);
    await dpxVault.deployed();

    const EquilibriaGlpVault = await ethers.getContractFactory("EquilibriaGlpVault");
    equilibriaGlpVault = await EquilibriaGlpVault.deploy(pendleGlpMarketLPT.address);
    await equilibriaGlpVault.deployed();

    const AllWeatherPortfolioLPToken = await ethers.getContractFactory("AllWeatherPortfolioLPToken");
    portfolioContract = await AllWeatherPortfolioLPToken.connect(wallet).deploy(weth.address, radiantVault.address, dpxVault.address, equilibriaGlpVault.address);
    await portfolioContract.connect(wallet).deployed();
    await portfolioContract.setVaultAllocations([{protocol: "dpx", percentage: 100}], { gasLimit: 1057560 }).then((tx) => tx.wait());

    await (await weth.connect(wallet).approve(portfolioContract.address, dpxAmount, { gasLimit: gasLimit })).wait();
    await weth.connect(wallet).withdraw(ethers.utils.parseEther("0.03"), { gasLimit: 1057560 });
  });
  describe("Portfolio LP Contract Test", function () {
    it("Should be able to deposit SLP to portfolio contract", async function () {
      const oneInchSwapData = await fetch1InchSwapData(weth.address,
        dpxTokenAddress,
        dpxAmount.div(2),
        dpxVault.address);
      const pendleZapInData = await getPendleZapInData(42161, glpMarketPoolAddress, dpxAmount, 0.99);
      const receipt = await (await portfolioContract.connect(wallet).deposit(dpxAmount, oneInchSwapData, pendleZapInData[2], pendleZapInData[3], pendleZapInData[4], { gasLimit: 1692137 })).wait();

      // Iterate over the events and find the Deposit event
      for (const event of receipt.events) {
        if (event.topics.includes(dpxVault.interface.getEventTopic('Deposit'))) {
          const decodedEvent = dpxVault.interface.decodeEventLog('Deposit', event.data, event.topics);

          expect(await dpxVault.balanceOf(portfolioContract.address)).to.equal(decodedEvent.shares);
          expect((await miniChefV2.userInfo(sushiPid, dpxVault.address))[0]).to.equal(decodedEvent.shares);
          expect((await dpxVault.totalAssets())).to.equal(decodedEvent.shares);
          expect(await portfolioContract.balanceOf(wallet.address)).to.equal(dpxAmount);
        }
      }
    });
    it("Should be able to claim rewards", async function () {
      // deposit
      const oneInchSwapData = await fetch1InchSwapData(weth.address,
        dpxTokenAddress,
        dpxAmount.div(2),
        dpxVault.address);
      const pendleZapInData = await getPendleZapInData(42161, glpMarketPoolAddress, dpxAmount, 0.99);      
      await (await portfolioContract.deposit(dpxAmount, oneInchSwapData, pendleZapInData[2], pendleZapInData[3], pendleZapInData[4], { gasLimit: 10692137 })).wait();
      await mineBlocks(100); // Mine 1 blocks
      const originalSushiBalance = await sushiToken.balanceOf(wallet.address);
      const originalDpxBalance = await dpxToken.balanceOf(wallet.address);
      const claimableRewards = await portfolioContract.connect(wallet).claimableRewards(wallet.address);
      expect(claimableRewards[0].protocol).to.equal("dpx");
      const sushiClaimableReward = claimableRewards[0].claimableRewards[0].amount;
      const dpxClaimableReward = claimableRewards[0].claimableRewards[1].amount;
      expect(sushiClaimableReward).to.be.gt(0);
      expect(dpxClaimableReward).to.be.gt(0);

      await portfolioContract.connect(wallet).claim(wallet.address, rRewardTokens, []);
      // NOTE: using `to.be.gt` instead of `to.equal` because the reward would somehow be increased after claim(). My hunch is that sushiswap would trigger some reward distribution after the claim() tx is mined.
      expect((await sushiToken.balanceOf(wallet.address)).sub(originalSushiBalance)).to.be.gt(sushiClaimableReward);
      expect((await dpxToken.balanceOf(wallet.address)).sub(originalDpxBalance)).to.be.gt(dpxClaimableReward);
      const remainingClaimableRewards = await portfolioContract.connect(wallet).claimableRewards(wallet.address);
      expect(remainingClaimableRewards[0].claimableRewards[0].amount).to.equal(0);
      expect(remainingClaimableRewards[0].claimableRewards[1].amount).to.equal(0);
    })

    it("Should be able to redeemAll dpx deposit", async function () {
      const oneInchSwapData = await fetch1InchSwapData(weth.address,
        dpxTokenAddress,
        dpxAmount.div(2),
        dpxVault.address);
      const pendleZapInData = await getPendleZapInData(42161, glpMarketPoolAddress, dpxAmount, 0.99);      
      const receipt = await (await portfolioContract.deposit(dpxAmount, oneInchSwapData, pendleZapInData[2], pendleZapInData[3], pendleZapInData[4], { gasLimit: 10692137 })).wait();
      // Iterate over the events and find the Deposit event
      for (const event of receipt.events) {
        if (event.topics.includes(dpxVault.interface.getEventTopic('Deposit'))) {
          const decodedEvent = dpxVault.interface.decodeEventLog('Deposit', event.data, event.topics);
          expect((await miniChefV2.userInfo(sushiPid, dpxVault.address))[0]).to.equal(decodedEvent.shares);
          expect(await dpxVault.balanceOf(portfolioContract.address)).to.equal(decodedEvent.shares);
          // redeemAll
          /// should have no rewards before redeemAll
          expect(await sushiToken.balanceOf(dpxVault.address)).to.equal(0);
          expect(await dpxToken.balanceOf(dpxVault.address)).to.equal(0);

          // check dpxSLP balance
          const portfolioShares = await portfolioContract.balanceOf(wallet.address);
          await (await portfolioContract.connect(wallet).redeemAll(portfolioShares, wallet.address, fakePendleZapOut, { gasLimit: gasLimit })).wait();
          expect((await miniChefV2.userInfo(sushiPid, dpxVault.address))[0]).to.equal(0);
          expect(await dpxSLP.balanceOf(dpxVault.address)).to.equal(0);
          expect(await dpxSLP.balanceOf(wallet.address)).to.equal(decodedEvent.shares);

        }
      }
      // rewards should be claimed
      const remainingClaimableRewards = await portfolioContract.claimableRewards(wallet.address);
      expect(remainingClaimableRewards).to.deep.equal([]);
    })
  });
});