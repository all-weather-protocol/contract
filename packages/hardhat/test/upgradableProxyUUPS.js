const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const {
  getBeforeEachSetUp,
  initTokens,
} = require("./utilsBSC");


let ALP;
describe("All Weather Protocol", function () {
  beforeEach(async () => {
    ({
      deployer
    } = await getBeforeEachSetUp([
        {protocol: "ApolloX-ALP", percentage: 100}
      ]));
    ({ApolloX, USDC, APX, ALP} = await initTokens());
  });

  describe("ApolloX Contract Test", function () {
    it('proxy should be able to upgrade', async () => {
      const apolloxBsc = (await ethers.getContractFactory("ApolloXBscVault")).connect(deployer);
      const apolloxBscV2 = (await ethers.getContractFactory("ApolloXBscVaultV2")).connect(deployer);
    
      const apolloxBscVault = await upgrades.deployProxy(apolloxBsc, [ALP.target, "ApolloX-ALP", "ALP-APO-ALP", 1, 1], {gasLimit:30000000, kind: 'uups'});
      await apolloxBscVault.waitForDeployment();
      const originalAPXaddress = await apolloxBscVault.APX();
      const upgraded = await upgrades.upgradeProxy(await apolloxBscVault.getAddress(), apolloxBscV2);      
      expect(await upgraded.APX()).to.not.equal(originalAPXaddress);
      expect(upgraded.target).to.equal(apolloxBscVault.target);
    });
  });
});