const hre = require("hardhat");
const { deployContracts } = require("../test/utilsBSC");
const { config } = require('dotenv');
config();

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.API_URL);
    const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const balanceWei = await provider.getBalance(deployer.address);

    // Convert the balance from Wei to Ether
    const balanceEther = ethers.formatEther(balanceWei);
    console.log("bnb Balance: " + balanceEther);
    // should use a different wallet for deploying contracts
    const wallet2 = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const allocations = [
        { protocol: "ApolloX-ALP", percentage: 100 }
    ];
    const { portfolioContract } = await deployContracts(allocations, deployer, wallet2);

    // Verify the contract on Etherscan
    console.log("Verifying contract...");
    for (const contract of [portfolioContract]) {
        // const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(contract.target);
        // console.log("Proxy address: ", contract.target, "Implementation Address:", implementationAddress);
        try {
            await hre.run("verify:verify", {
                address: contract.target,
                constructorArguments: []
            });
            // await hre.run("verify:verify", {
            //     address: contract.target,
            //     constructorArguments: []
            // });
        } catch (error) {
            console.log(error);
        }
    }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })