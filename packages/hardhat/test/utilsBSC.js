const { config } = require('dotenv');
const { network, ethers } = require("hardhat");
const got = require('got');
const fs = require('fs');
const path = require('path');

config();
// wallets
const myImpersonatedWalletAddress = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const myImpersonatedWalletAddress2 = "0x2170Ed0880ac9A755fd29B2688956BD959F933F8";
const end2endTestingStableCointAmount = ethers.utils.parseUnits('100', 18);
const gasLimit = 30000000;

async function initTokens() {
    const ALP = await ethers.getContractAt("IERC20", "0x4E47057f45adF24ba41375a175dA0357cB3480E5");
    const ApolloX = await ethers.getContractAt("IApolloX", "0x1b6F2d3844C6ae7D56ceb3C3643b9060ba28FEb0");
    const USDC = await ethers.getContractAt('IERC20', "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");
    const APX = await ethers.getContractAt('IERC20', "0x78F5d389F5CDCcFc41594aBaB4B0Ed02F31398b3");
    return {
        ALP,
        USDC,
        ApolloX,
        APX
    }
}
async function getBeforeEachSetUp(allocations) {
  const wallet = await ethers.getImpersonatedSigner(myImpersonatedWalletAddress);
  const wallet2 = await ethers.getImpersonatedSigner(myImpersonatedWalletAddress2);
  const deployer = wallet;
// await weth.connect(wallet).deposit({ value: ethers.utils.parseEther("1"), gasLimit });
// await weth.connect(wallet2).deposit({ value: ethers.utils.parseEther("0.1"), gasLimit });
    
  const contracts = await deployContracts(allocations, deployer);

//   await (await weth.connect(wallet2).approve(portfolioContract.address, ethers.constants.MaxUint256, { gasLimit })).wait();

//   portfolioShares = amountAfterChargingFee.div(await portfolioContract.UNIT_OF_SHARES());
  return {
    contracts,
    wallet,
    wallet2,
    deployer
  };
}


async function deployContracts(allocations, deployer) {
    const { ALP, USDC } = await initTokens();

  const apolloxBsc = await ethers.getContractFactory("ApolloXBscVault");
  const apolloxBscVault = await apolloxBsc.connect(deployer).deploy(ALP.address, "ApolloX-ALP", "ALP-APO-ALP", {gasLimit:30000000});
  await apolloxBscVault.deployed();

  const StableCoinVaultFactory = await ethers.getContractFactory("StableCoinVault");
  const portfolioContract = await StableCoinVaultFactory.connect(deployer).deploy(USDC.address, "StableCoinLP", "SCLP", apolloxBscVault.address, {gasLimit:30000000});

  await portfolioContract.connect(deployer).deployed();
  await portfolioContract.setVaultAllocations(allocations).then((tx) => tx.wait());
  await _checkAllcation(allocations, portfolioContract);

  await (await USDC.connect(deployer).approve(portfolioContract.address, ethers.constants.MaxUint256, { gasLimit:30000000 })).wait();
  await (await ALP.connect(deployer).approve(portfolioContract.address, ethers.constants.MaxUint256, { gasLimit:30000000 })).wait();

  return {portfolioContract, apolloxBscVault};
}

async function _checkAllcation(allocations, portfolioContract) {
  const protocolArray = allocations.map(item => item.protocol);
  for (const protocolName of (await portfolioContract.getPortfolioAllocation())[0]) {
    
    if (protocolArray.includes(protocolName) === false){
      throw new Error(`${protocolName} is not in the allocation list`);
    }
  }
}

async function deployContractsToChain(wallet, allocations, portfolioContractName) {
  const [dpxSLP, weth, dpxToken, fsGLP, pendleGlpMarketLPT, pendleGDAIMarketLPT, pendleRETHMarketLPT, pendleToken, daiToken, gDAIToken, sushiToken, miniChefV2, glpRewardPool, dlpToken, rethToken, pendleBooster, dGDAIRewardPool, multiFeeDistribution, xEqbToken, eqbToken, magicToken, magicSLP, pendleMarketLPT] = await initTokens();
  return await deployContracts(wallet, dpxSLP, sushiMiniChefV2Address, sushiPid, oneInchAddress, pendleGlpMarketLPT, pendleGDAIMarketLPT, pendleRETHMarketLPT, radiantLendingPoolAddress, eqbMinterAddress, pendleBoosterAddress, allocations, portfolioContractName);
}

async function deposit(end2endTestingStableCointAmount, wallet, portfolioContract, apolloXDepositData) {
  const depositData = {
    amount: end2endTestingStableCointAmount,
    receiver: wallet.address,
    apolloXDepositData
  }
  return await (await portfolioContract.connect(deployer).deposit(depositData, { gasLimit: 30000000 })).wait();
}

// radiant has an one year lock, therefore need these timestamp-related variables
let currentTimestamp = Math.floor(Date.now() / 1000);;
async function simulateTimeElasped(timeElasped = 12 * 31 * 86400) {
  // Simulate a year later
  const futureTimestamp = currentTimestamp + timeElasped;
  await ethers.provider.send('evm_setNextBlockTimestamp', [futureTimestamp]);
  await ethers.provider.send('evm_mine');
}

async function mineBlocks(numBlocks) {
  for (let i = 0; i < numBlocks; i++) {
    await network.provider.send("evm_mine");
  }
}



module.exports = {
    getBeforeEachSetUp,
    initTokens,
    deposit,
    end2endTestingStableCointAmount,
    gasLimit,
    mineBlocks,
    simulateTimeElasped
};