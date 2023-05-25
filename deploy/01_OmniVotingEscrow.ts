import "dotenv/config";
import "hardhat-deploy";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { endpoint } from "../constants/layerzero.json";

export default async ({ getNamedAccounts, deployments, network }: HardhatRuntimeEnvironment) => {
    const { deploy, get } = deployments;
    const { deployer } = await getNamedAccounts();

    let networkName = network.name == "hardhat" ? "ethereum" : network.name;
    const forked = networkName.endsWith("-fork");
    if (forked) {
        networkName = networkName.slice(0, -5);
    }
    const { address } = await get("ERC20Mock");
    const args = [address, "Voting-escrowed Mock", "veMOCK", endpoint[networkName], 101];
    await deploy("OmniVotingEscrow", {
        from: deployer,
        args,
        log: true,
    });
};
