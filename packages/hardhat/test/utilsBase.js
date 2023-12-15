const { config } = require('dotenv');
const { network, ethers, upgrades } = require("hardhat");
const got = require('got');
const fs = require('fs');
const path = require('path');

config();
// wallets
async function getWalletsPerChain(chain) {
  let myImpersonatedWalletAddress;
  let myImpersonatedWalletAddress2;
  if (chain === 'bsc') {
    myImpersonatedWalletAddress = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
    myImpersonatedWalletAddress2 = "0xf89d7b9c864f589bbf53a82105107622b35eaa40";
  } else if (chain === 'base') {
    myImpersonatedWalletAddress = "0xc68a33de9ceac7bdaed242ae1dc40d673ed4f643";
    myImpersonatedWalletAddress2 = "0x8180a5ca4e3b94045e05a9313777955f7518d757";
  }
  const wallet = await ethers.getImpersonatedSigner(myImpersonatedWalletAddress);
  const wallet2 = await ethers.getImpersonatedSigner(myImpersonatedWalletAddress2);
  return {wallet, wallet2}
}
const oneInchAddress = '0x1111111254eeb25477b68fb85ed929f73a960582';
const end2endTestingStableCointAmount = ethers.parseUnits('10', 6);
// const end2endTestingStableCointAmount = ethers.parseUnits('10', 18);
const gasLimit = 30000000;
function getTokensPerChain(chain) {
  if (chain === 'bsc') {
    const USDC_ADDRESS = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
    const USDT_ADDRESS = '0x55d398326f99059ff775485246999027b3197955';
    return {USDC_ADDRESS, USDT_ADDRESS}
  } else if (chain === 'base') {
    const USDbC_ADDRESS = '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca';
    const USDC_ADDRESS = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
    return {USDbC_ADDRESS, USDC_ADDRESS}
  }
}

async function initTokens(chain) {
  if (chain === 'bsc') {
    const ALP = await ethers.getContractAt("IERC20", "0x4E47057f45adF24ba41375a175dA0357cB3480E5");
    const ApolloX = await ethers.getContractAt("IApolloX", "0x1b6F2d3844C6ae7D56ceb3C3643b9060ba28FEb0");
    const USDC = await ethers.getContractAt('IERC20', USDC_ADDRESS);
    const APX = await ethers.getContractAt('IERC20', "0x78F5d389F5CDCcFc41594aBaB4B0Ed02F31398b3");
    const USDT = await ethers.getContractAt('IERC20', USDT_ADDRESS);
    return {
        ALP,
        USDC,
        ApolloX,
        APX,
        USDT
    }
  } else if (chain === 'base') {
    const {USDbC_ADDRESS, USDC_ADDRESS} = getTokensPerChain('base');
    const VLP = await ethers.getContractAt("IERC20", "0xebf154ee70de5237ab07bd6428310cbc5e5c7c6e");
    const VelaTokenFarm = await ethers.getContractAt("ITokenFarm", "0x00b01710c2098b883c4f93dd093be8cf605a7bde");
    const USDbC = await ethers.getContractAt('IERC20', USDbC_ADDRESS);
    const esVELA = await ethers.getContractAt('IERC20', "0xefd5a713c5bd85e9ced46070b2532e4a47a18102");
    const USDC = await ethers.getContractAt('IERC20', USDC_ADDRESS);
    return {
        VLP,
        USDbC,
        VelaTokenFarm,
        esVELA,
        USDC
    }
  }
}
async function getBeforeEachSetUp(chain, mode) {
  const {wallet, wallet2} = await getWalletsPerChain(chain);
  const deployer = wallet;
    
  const contracts = await deployContracts(deployer, wallet2, chain, mode);
  return {
    contracts,
    wallet,
    wallet2,
    deployer
  };
}


async function deployContracts(deployer, wallet2, chain, mode) {
  let tokens;
  let allocations;
  let velaBaseVault;
  let apolloxBscVault;
  if (chain === 'bsc') {
    const { ALP, USDC, USDT } = await initTokens('bsc');
    tokens = [ ALP, USDC, USDT ];
    const apolloxBsc = await ethers.getContractFactory("ApolloXBscVault");
    const deployerConnectedFactory = apolloxBsc;
  
    // performance fee: 9.7%. However, the yield from APX consists of appreciation of principal and APX token, so the performance fee is 100% take from APX token.
    const apolloxBscVault = await upgrades.deployProxy(deployerConnectedFactory, [ALP.target, "ApolloX-ALP", "ALP-APO-ALP", 8, 10], {gasLimit:30000000, kind: 'uups', signer: deployer});
    await apolloxBscVault.waitForDeployment();
    allocations = [
        { protocol: "ApolloX-ALP", percentage: 100, vaultAddress: apolloxBscVault.target}
    ];
  } else if (chain === 'base') {
    const { VLP, USDbC, USDC } = await initTokens('base');
    tokens = [ VLP, USDbC, USDC ];

    const velaBase = await ethers.getContractFactory("VelaBaseVault");
    const deployerConnectedFactory = velaBase;
  
    // performance fee: 9.7%. However, the yield from APX consists of appreciation of principal and APX token, so the performance fee is 100% take from APX token.
    velaBaseVault = await upgrades.deployProxy(deployerConnectedFactory, [VLP.target, "Vela-VLP", "ALP-VELA-VLP", 8, 10], {gasLimit:30000000, kind: 'uups', signer: deployer });
    await velaBaseVault.waitForDeployment();

    allocations = [
      { protocol: "Vela-VLP", percentage: 100, vaultAddress: velaBaseVault.target}
    ];
  }
  const StableCoinVaultFactory = await ethers.getContractFactory("StableCoinVault");
  const portfolioContract = await upgrades.deployProxy(
    StableCoinVaultFactory,
    ["StableCoinLP", "SCLP"],
    { initializer: 'initialize', gasLimit: 30000000, kind: 'uups', signer: deployer }
  );

  await portfolioContract.waitForDeployment();
  await portfolioContract.setVaultAllocations(allocations, {gasLimit:30000000}).then((tx) => tx.wait());
  await portfolioContract.updateOneInchAggregatorAddress(oneInchAddress, {singer: deployer}).then((tx) => tx.wait());
  await checkAllcation(allocations, portfolioContract);

  if (mode === 'test') {
    // some token chores and initilization top up
    // for (const wallet of [deployer, wallet2]) {
    for (const wallet of [deployer]) {
      for (const token of tokens) {
        await (await token.connect(wallet).approve(portfolioContract.target, ethers.MaxUint256)).wait();
      }
    }
  }
  return {
    portfolioContract, 
    apolloxBscVault,
    velaBaseVault
  };
}

async function checkAllcation(allocations, portfolioContract) {
  const protocolArray = allocations.map(item => item.protocol);
  for (const protocolName of (await portfolioContract.getPortfolioAllocation())[0]) {
    
    if (protocolArray.includes(protocolName) === false){
      throw new Error(`${protocolName} is not in the allocation list`);
    }
  }
}


async function deposit(chain, end2endTestingStableCointAmount, wallet, portfolioContract, fixtureName, tokenInAddress, tokenInAfterSwap) {
  let USDC, USDT;
  if (chain === 'bsc') {
    const { USDC: usdc, USDT: usdt } = await initTokens();
    USDC = usdc;
    USDT = usdt;
  }  
  const apolloXDepositData = {
    tokenIn: chain === 'bsc' ? USDT.target : tokenInAfterSwap,
    // at the time of writing, the price of ALP is 1.1175, so assume the price is 1.2, including fee, as minALP
    minALP: ethers.parseEther("1")/ BigInt(12) * BigInt(10)
  }
  const velaDepositData = {
    tokenIn: tokenInAfterSwap,
    crossChainCallData: ethers.toUtf8Bytes('')    
  }

  const depositData = {
    amount: end2endTestingStableCointAmount,
    receiver: wallet.address,
    tokenIn: tokenInAddress,
    tokenInAfterSwap: tokenInAfterSwap,
    aggregatorData: fixtureName === '' ? ethers.toUtf8Bytes('') : _getAggregatorData(fixtureName, 56, USDC.target, USDT.target, end2endTestingStableCointAmount, portfolioContract.target, fixtureName),
    apolloXDepositData,
    velaDepositData
  }
  // return await (await portfolioContract.deposit(depositData, { gasLimit: 30000000, signer: wallet })).wait();
  return await (await portfolioContract.connect(wallet).deposit(depositData)).wait();
}

async function claim(chain, walletAddress, wallet, portfolioContract, fixtureName) {
  let USDC, esVELA;
  if (chain === 'bsc') {
    throw "Not Implemented"
  } else if (chain === 'base') {
    const { USDC: usdc, esVELA: esvela } = await initTokens(chain);
    USDC = usdc;
    esVELA = esvela;
  }
  const claimData = {
    receiver: walletAddress,
    apolloXClaimData: {
      tokenOut: USDC.target,
      aggregatorData: ethers.toUtf8Bytes('')
    },
    velaBaseClaim: {
      tokenOut: esVELA.target,
      aggregatorData: ethers.toUtf8Bytes('')
    }
  }
  return await (await portfolioContract.connect(wallet).claim(claimData, { gasLimit: 30000000 })).wait();
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

async function _getAggregatorData(fixtureName, chainID, tokenInAddress, tokenOutAddress, amount, vaultAddress) {
  let aggregatorData;
  try {
    console.log("read 1inch calldata and pendle calldata from json file")
    aggregatorData = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${fixtureName}.json`), 'utf8'));
  } catch (err) {
    console.error('json file not found, get new 1inch calldata and pendle calldata');
    [
      aggregatorData,
    ] = await Promise.all([
      fetch1InchSwapData(chainID, tokenInAddress, tokenOutAddress, amount, vaultAddress, 50),
    ]);
    fs.writeFileSync(path.join(__dirname, 'fixtures', `${fixtureName}.json`), JSON.stringify(aggregatorData, null, 2), 'utf8')
  }
  return aggregatorData.tx.data;
}

async function fetch1InchSwapData(chainID, fromTokenAddress, toTokenAddress, amount, fromAddress, slippage=50) {
  const headers = {
    'Authorization': `Bearer ${process.env['ONE_INCH_API_KEY']}`,
    'accept': 'application/json'
  };
  const res = await got(`https://api.1inch.dev/swap/v5.2/${chainID}/swap?src=${fromTokenAddress}&dst=${toTokenAddress}&amount=${amount.toString()}&from=${fromAddress}&slippage=${slippage}&disableEstimate=true&compatibility=true`, {
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
  const allowedDifference = (percent / 100) * Math.max(targetAsNumber, numberAsNumber);
  return difference <= allowedDifference;
}

async function simulateTimeElasped(timeElasped = 12 * 31 * 86400) {
  // Simulate a year later
  const futureTimestamp = currentTimestamp + timeElasped;
  await ethers.provider.send('evm_setNextBlockTimestamp', [futureTimestamp]);
  await ethers.provider.send('evm_mine');
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
    isWithinPercentage,
    deployContracts,
    simulateTimeElasped
};