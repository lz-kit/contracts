import "dotenv/config";
import "hardhat-deploy";
import { HardhatRuntimeEnvironment } from "hardhat/types";

module.exports = async ({ getNamedAccounts, deployments }: HardhatRuntimeEnvironment) => {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    await deploy("ERC20Mock", {
        from: deployer,
        log: true,
        deterministicDeployment: true,
    });
};
