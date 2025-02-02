# All Weather Portfolio

## Deploy & Verify

1. For Main net: If you got some error, remember to first `rm -rf artifacts` and then `npx hardhat clean`
2. Deploy:
    1. change `API_URL` to the right network you want to deploy to in `packages/hardhat/.env`
    2. `npx hardhat run --network <network> deploy/deployPermanentPortfolio.js`
3. (optional): Might need to manually verify if your deploy script fails, especially for vaults not portfolio contract:
    1. `npx hardhat verify --network arbitrum 0x47cF63A2C2a60efD53193504c8a9846D38254549 "0x14FbC760eFaF36781cB0eb3Cb255aD976117B9Bd"  "Equilibria-RETH" "ALP-EQB-RETH"`
    2. `npx hardhat verify --network bsc 0x51766aeF369c60e8Af732454b3a10cA068589438`
3. Update the contract addresses resides in `rebalance` server and `frontend`

## Upgrade Contracts:

1. Upgrade Portfolio Contract:
    1. change `API_URL` to the right network you want to deploy to in `packages/hardhat/.env`
    2. Comment out the deployment part of `vault contract`, if you only want to upgrade `portfolio contract` (e.g. comment out `apolloxBscVault` in `deployContracts()`, [upgradeProxy.js](https://github.com/all-weather-protocol/contract/blob/master/packages/hardhat/deploy/upgradeProxy.js#L19C47-L19C47))
    3. command: ` npx hardhat run --network <network> deploy/upgradeProxy.js`
    4. (optional): if you see this error, it means you're verifying the wrong contract. You should only verify the implementation contract since the proxy should remain the same. `message: 'execution reverted: ERC1967: new implementation is not a contract',`
2. Upgrade Vault Contract: N/A, you need to create a new deploy script for this.

## Test

* dpx: `BLOCK_NUMBER=97022421 yarn test test/dpxArbitrumVaultTest.js`
* radiant:
    * USDT: `BLOCK_NUMBER=86630670 yarn test test/radiantArbitrumVaultTest.js`
    * wETH: `BLOCK_NUMBER=101043121  yarn test test/radiantArbitrumVaultTest.js`
* arbitrum rich impersonate address: `0x2B9AcFd85440B7828DB8E54694Ee07b2B056B30C`

### How to Integrate New Protocols?

add the new vault into:
1. `deposit()` for loop
2. `redeem()` for loop
3. add new vault address in the portfolio's contructor, add its `require` accordingly and add this new vault into the `vault[]`
4. need to add lots of variable in `utils.js`
5. update need to manually add some tokens into `/debank` route in rebalance backend (for instance, 0xeeeeee for each blockchain can be different token)
6. need to find the API of that protocol you integrated first, and then calculate its `apr_composition` in `/apr_composition` endpoint in rebalance backend
7. check the result of `apr composition` on frontend side
8. frontend side:
    1. `/addresses`: [github](https://github.com/all-weather-protocol/all-weather-frontend/blob/94dc69d2307b1b3af056c284e6164d6b21395141/utils/rebalanceSuggestions.js#L26C32-L26C32)

## Develop

1. clean up cache:
    1. `rm -rf hardhat/cache`
    2. `yarn cache clean`
    3. `rm -rf artifacts`