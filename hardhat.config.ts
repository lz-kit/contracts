import "dotenv/config";
import "@lz-kit/cli/hardhat";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-solhint";
import "@primitivefi/hardhat-dodoc";
import "hardhat-abi-exporter";
import "hardhat-deploy";
import "hardhat-spdx-license-identifier";
import "hardhat-watcher";

import { HardhatUserConfig, task } from "hardhat/config";

import { removeConsoleLog } from "hardhat-preprocessor";

const accounts = { mnemonic: process.env.MNEMONIC || "test test test test test test test test test test test junk" };

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (args, { ethers }) => {
    const accounts = await ethers.getSigners();

    for (const account of accounts) {
        console.log(await account.address);
    }
});

const config: HardhatUserConfig = {
    abiExporter: {
        path: "./abis",
        runOnCompile: true,
        clear: true,
        flat: true,
        spacing: 2,
    },
    defaultNetwork: "hardhat",
    dodoc: {
        exclude: ["hardhat/"],
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
    gasReporter: {
        coinmarketcap: process.env.COINMARKETCAP_API_KEY,
        currency: "USD",
        enabled: process.env.REPORT_GAS === "true",
    },
    namedAccounts: {
        deployer: {
            default: 0,
        },
        alice: {
            default: 1,
        },
        bob: {
            default: 2,
        },
        carol: {
            default: 3,
        },
    },
    networks: {
        localhost: {
            live: false,
            saveDeployments: true,
            tags: ["local"],
        },
        hardhat: {
            forking: {
                enabled: process.env.FORKING === "true",
                url: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
            },
            accounts,
            live: false,
            saveDeployments: true,
            tags: ["test", "local"],
        },
        ethereum: {
            url: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
            accounts,
            chainId: 1,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
        goerli: {
            url: `https://goerli.infura.io/v3/${process.env.INFURA_API_KEY}`,
            accounts,
            chainId: 5,
            live: true,
            saveDeployments: true,
            tags: ["staging"],
        },
        arbitrum: {
            url: `https://arbitrum-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
            accounts,
            chainId: 42161,
            live: true,
            saveDeployments: true,
            tags: ["production"],
        },
        "arbitrum-goerli": {
            url: `https://arbitrum-goerli.infura.io/v3/${process.env.INFURA_API_KEY}`,
            accounts,
            chainId: 421613,
            live: true,
            saveDeployments: true,
            tags: ["staging"],
        },
    },
    preprocess: {
        eachLine: removeConsoleLog(bre => bre.network.name !== "hardhat" && bre.network.name !== "localhost"),
    },
    solidity: {
        version: "0.8.17",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            viaIR: true,
        },
    },
    watcher: {
        compile: {
            tasks: ["compile"],
            files: ["./contracts"],
            verbose: true,
        },
    },
};

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
export default config;
