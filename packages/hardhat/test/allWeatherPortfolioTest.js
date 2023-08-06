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
    dpxTokenAddress,
    gDAIAddress,
    pendleTokenAddress,
    gasLimit,
    daiAddress,
    gDAIRewardPoolAddress,
    glpMarketPoolAddress,
    simulateAYearLater,
    amountAfterChargingFee
} = require("./utils");
let {currentTimestamp} = require("./utils");

let wallet;
let weth;
let radiantVault;
let portfolioContract;
let oneInchSwapDataForDpx;
let oneInchSwapDataForGDAI;
let pendleGDAIZapInData;
let pendleGLPZapInData;
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
    return await (await portfolioContract.connect(wallet).deposit(depositData, { gasLimit })).wait();
  }
  

describe("All Weather Protocol", function () {
    beforeEach(async () => {
        wallet = await ethers.getImpersonatedSigner(myImpersonatedWalletAddress);
        dpxSLP = await ethers.getContractAt('IERC20Uniswap', sushiSwapDpxLpTokenAddress);
        weth = await ethers.getContractAt('IWETH', wethAddress);
        dlpToken = await ethers.getContractAt("MockDAI", radiantDlpAddress);
        dpxToken = await ethers.getContractAt("MockDAI", dpxTokenAddress);
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
        await portfolioContract.setVaultAllocations([{
            protocol: "SushSwap-DpxETH", percentage: 25,
        }, {
            protocol: "RadiantArbitrum-DLP", percentage: 25
        }, {
            protocol: "Equilibria-GLP", percentage: 25
        }, {
            protocol: "Equilibria-GDAI", percentage: 25
        }
        ]).then((tx) => tx.wait());
        await (await weth.connect(wallet).approve(portfolioContract.address, end2endTestingAmount, { gasLimit })).wait();

        oneInchSwapDataForDpx = await fetch1InchSwapData(weth.address, dpxToken.address, amountAfterChargingFee.div(8), wallet.address, 50);
        oneInchSwapDataForGDAI = await fetch1InchSwapData(weth.address, daiToken.address, amountAfterChargingFee.div(4), wallet.address, 50);
        // oneInchSwapDataForGDAI.toAmount).div(2): due to the 1inch slippage, need to multiple by 0.95 to pass pendle zap in
        pendleGDAIZapInData = await getPendleZapInData(42161, gDAIMarketPoolAddress, ethers.BigNumber.from(oneInchSwapDataForGDAI.toAmount).mul(50).div(100), 0.2, daiToken.address);
        pendleGLPZapInData = await getPendleZapInData(42161, glpMarketPoolAddress, amountAfterChargingFee.div(4), 0.99);
        portfolioShares = amountAfterChargingFee.div(await portfolioContract.unitOfShares());
    });
    describe("Portfolio LP Contract Test", function () {
        it("Should be able to zapin with WETH into All Weather Portfolio", async function () {
            this.timeout(240000); // Set timeout to 120 seconds
            const receipt = await deposit();
            // Iterate over the events and find the Deposit event
            for (const event of receipt.events) {
                if (event.topics.includes(portfolioContract.interface.getEventTopic('Transfer'))) {
                    const decodedEvent = portfolioContract.interface.decodeEventLog('Transfer', event.data, event.topics);
                    expect(await portfolioContract.balanceOf(wallet.address)).to.equal(portfolioShares);
                    if (decodedEvent.to === wallet.address && decodedEvent.from === portfolioContract.address) {
                        expect(decodedEvent.value).to.equal(end2endTestingAmount);
                    }
                }
            }
            const totalAssets = await portfolioContract.totalAssets();
            for (const asset of totalAssets) {
                if (asset.vaultName === 'SushSwap-DpxETH') {
                    // expect(asset.assets).to.equal(await dpxVault.balanceOf(portfolioContract.address));
                } else if (asset.vaultName === 'RadiantArbitrum-DLP') {
                    expect(asset.assets).to.equal(await radiantVault.balanceOf(portfolioContract.address));
                } else if (asset.vaultName === 'Equilibria-GLP') {
                    expect(asset.assets).to.equal(await equilibriaGlpVault.balanceOf(portfolioContract.address));
                } else if (asset.vaultName === 'Equilibria-GDAI') {
                    expect(asset.assets).to.equal(await equilibriaGDAIVault.balanceOf(portfolioContract.address));
                } else {
                    throw new Error(`Unknown vault name ${asset.vaultName}`);
                }
            }
        });
        it("Should be able to withdraw everything from All Weather Portfolio", async function () {
          this.timeout(240000); // Set timeout to 120 seconds
          const radiantLockedDlpBalanceBeforeDeposit = await radiantVault.totalAssets();
          expect(radiantLockedDlpBalanceBeforeDeposit).to.equal(0);
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
          const pendleZapOutData = await getPendleZapOutData(42161, gDAIMarketPoolAddress, gDAIToken.address, shares, 1);

          currentTimestamp += 12 * 31 * 24 * 60 * 60; // Increment timestamp
          await simulateAYearLater();
    
          const totalAssetsWhichShouldBeWithdrew = await portfolioContract.totalAssets();
          // withdraw
          await (await portfolioContract.connect(wallet).redeem(portfolioShares, wallet.address, pendleZapOutData[3], { gasLimit })).wait();
          for (const asset of totalAssetsWhichShouldBeWithdrew) {
            if (asset.vaultName === 'SushSwap-DpxETH') {
                // expect(asset.assets).to.equal(await dpxSLP.balanceOf(wallet.address));
            } else if (asset.vaultName === 'RadiantArbitrum-DLP') {
                expect(asset.assets).to.equal(await dlpToken.balanceOf(wallet.address));
            } else if  (asset.vaultName === 'Equilibria-GLP') {
                expect(asset.assets).to.equal(await pendleGlpMarketLPT.balanceOf(wallet.address));
            } else if (asset.vaultName === 'Equilibria-GDAI') {
                expect(asset.assets).to.equal(await pendleGDAIMarketLPT.balanceOf(wallet.address));
            } else {
                throw new Error(`Unknown vault name ${asset.vaultName}`);
            }
          }
          const currentUnclaimedAssets = await portfolioContract.totalAssets();
          for (const asset of currentUnclaimedAssets) {
            expect(asset.assets).to.equal(0);
          }
        });
    });
});