const { config } = require('dotenv');
const { network, ethers, upgrades } = require("hardhat");
const got = require('got');
const fs = require('fs');
const path = require('path');

config();
// wallets
const myImpersonatedWalletAddress = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const myImpersonatedWalletAddress2 = "0x2170Ed0880ac9A755fd29B2688956BD959F933F8";
const oneInchBscAddress = '0x1111111254eeb25477b68fb85ed929f73a960582';
const end2endTestingStableCointAmount = ethers.parseUnits('50', 18);
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
    
  const contracts = await deployContracts(allocations, deployer, wallet2);

//   await (await weth.connect(wallet2).approve(portfolioContract.target, ethers.constants.MaxUint256, { gasLimit })).wait();

//   portfolioShares = amountAfterChargingFee.div(await portfolioContract.UNIT_OF_SHARES());
  return {
    contracts,
    wallet,
    wallet2,
    deployer
  };
}


async function deployContracts(allocations, deployer, wallet2) {
  const { ALP, USDC } = await initTokens();

  const apolloxBsc = await ethers.getContractFactory("ApolloXBscVault");
  const deployerConnectedFactory = apolloxBsc.connect(deployer);

  const apolloxBscVault = await upgrades.deployProxy(deployerConnectedFactory, [ALP.target, "ApolloX-ALP", "ALP-APO-ALP", 1, 1], {gasLimit:30000000, kind: 'uups'});
  await apolloxBscVault.waitForDeployment();
  // performance fee: 9.7%. However, the yield from APX consists of appreciation of principal and APX token, so the performance fee is 100% take from APX token.
  await upgrades.admin.changeProxyAdmin(apolloxBscVault.target, deployer.address);
  await apolloxBscVault.connect(deployer).updatePerformanceFeeMetaData(8, 10);

  const StableCoinVaultFactory = await ethers.getContractFactory("StableCoinVault");
  const portfolioContract = await StableCoinVaultFactory.connect(deployer).deploy(USDC.target, "StableCoinLP", "SCLP", apolloxBscVault.target, {gasLimit:30000000});
  await portfolioContract.waitForDeployment();

  await portfolioContract.setVaultAllocations(allocations).then((tx) => tx.wait());
  await portfolioContract.updateOneInchAggregatorAddress(oneInchBscAddress).then((tx) => tx.wait());
  await _checkAllcation(allocations, portfolioContract);

  // some token chores and initilization top up
  await (await USDC.connect(deployer).approve(portfolioContract.target, ethers.MaxUint256, { gasLimit:30000000 })).wait();
  await (await ALP.connect(deployer).approve(portfolioContract.target, ethers.MaxUint256, { gasLimit:30000000 })).wait();
  // send BNB to portfolioContract for gas fee
  await (await deployer.sendTransaction({ to: portfolioContract.target, value: ethers.parseEther("1"), gasLimit:30000000 })).wait();
  return {
    portfolioContract, 
    apolloxBscVault};
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

async function claim(walletAddress, deployer, amount, portfolioContract) {
  const { APX, USDC } = await initTokens();
  const claimData = {
    receiver: walletAddress,
    apolloXClaimData: {
      tokenOut: USDC.target,
      aggregatorData: _getAggregatorData("ApolloX-ALP", 56, APX.target, USDC.target, amount, portfolioContract.target),
    }
  }
  const useDump = true;
  return await (await portfolioContract.connect(deployer).claim(claimData, useDump, { gasLimit: 30000000 })).wait();
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

async function _getAggregatorData(vaultName, chainID, tokenInAddress, tokenOutAddress, amount, vaultAddress) {
  let aggregatorData;
  try {
    console.log("read 1inch calldata and pendle calldata from json file")
    aggregatorData = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${vaultName}.json`), 'utf8'));
  } catch (err) {
    console.error('json file not found, get new 1inch calldata and pendle calldata');
    [
      aggregatorData,
    ] = await Promise.all([
      fetch1InchSwapData(chainID, tokenInAddress, tokenOutAddress, amount, vaultAddress, 50),
    ]);
    fs.writeFileSync(path.join(__dirname, 'fixtures', `${vaultName}.json`), JSON.stringify(aggregatorData, null, 2), 'utf8')
  }
  return aggregatorData.tx.data;
}

async function fetch1InchSwapData(chainID, fromTokenAddress, toTokenAddress, amount, fromAddress, slippage=50) {
  const headers = {
    'Authorization': `Bearer ${process.env['ONE_INCH_API_KEY']}`,
    'accept': 'application/json'
  };
  const res = await got(`https://api.1inch.dev/swap/v5.2/${chainID}/swap?src=${fromTokenAddress}&dst=${toTokenAddress}&amount=${amount.toString()}&from=${fromAddress}&slippage=${slippage}&disableEstimate=true`, {
    headers,
    retry: {
      limit: 1, // Number of retries
      methods: ['GET'], // Retry only for GET requests
      statusCodes: [429, 500, 502, 503, 504], // Retry for specific status codes
      // calculateDelay: ({ attemptCount }) => attemptCount * 3000, // Delay between retries in milliseconds
    }
  })
  if (res.statusCode !== 200) {
    throw new Error(`HTTP error! status: ${res.statusCode}`);
  }
  return JSON.parse(res.body);
}

function isWithinPercentage(number, target, percent) {
  // Convert BigInt to a regular number for calculation
  const numberAsNumber = Number(number);
  const targetAsNumber = Number(target);

  const difference = Math.abs(numberAsNumber - targetAsNumber);
  const allowedDifference = (percent / 100) * targetAsNumber;
  return difference <= allowedDifference;
}

module.exports = {
    getBeforeEachSetUp,
    initTokens,
    deposit,
    end2endTestingStableCointAmount,
    gasLimit,
    mineBlocks,
    simulateTimeElasped,
    claim,
    isWithinPercentage
};