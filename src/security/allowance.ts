import { MaxUint256 } from "@ethersproject/constants";
import { BigNumber } from "@ethersproject/bignumber";
import { parseUnits } from "@ethersproject/units";
import { Wallet } from "@ethersproject/wallet";
import { Contract } from "@ethersproject/contracts";
import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";
import { Chain, AssetType, ClobClient } from "@polymarket/clob-client";
import { getContractConfig } from "@polymarket/clob-client";
import { getRpcProvider } from "../clients/rpcProvider";
import { logger } from "../utils/logger";

dotenvConfig({ path: resolve(process.cwd(), ".env") });

const USDC_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
];

const CTF_ABI = [
    "function setApprovalForAll(address operator, bool approved) external",
    "function isApprovedForAll(address account, address operator) external view returns (bool)",
];

export async function approveUSDCAllowance(): Promise<void> {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("PRIVATE_KEY not found in environment");
    }

    const chainId = parseInt(`${process.env.CHAIN_ID || Chain.POLYGON}`) as Chain;
    const contractConfig = getContractConfig(chainId);
    
    const provider = getRpcProvider(chainId);
    const wallet = new Wallet(privateKey, provider);
    
    const address = await wallet.getAddress();
    logger.info(`Approving USDC allowances for address: ${address}, chainId: ${chainId}`);
    logger.info(`USDC Contract: ${contractConfig.collateral}`);
    logger.info(`ConditionalTokens Contract: ${contractConfig.conditionalTokens}`);
    logger.info(`Exchange Contract: ${contractConfig.exchange}`);

    const usdcContract = new Contract(contractConfig.collateral, USDC_ABI, wallet);

    let gasOptions: { gasPrice?: BigNumber; gasLimit?: number } = {};
    try {
        const gasPrice = await provider.getGasPrice();
        gasOptions = {
            gasPrice: gasPrice.mul(120).div(100),
            gasLimit: 200_000,
        };
    } catch (error) {
        logger.warning("Could not fetch gas price, using fallback");
        gasOptions = {
            gasPrice: parseUnits("100", "gwei"),
            gasLimit: 200_000,
        };
    }

    const ctfAllowance = await usdcContract.allowance(address, contractConfig.conditionalTokens);
    if (!ctfAllowance.eq(MaxUint256)) {
        logger.info(`Current CTF allowance: ${ctfAllowance.toString()}, setting to MaxUint256...`);
        const tx = await usdcContract.approve(contractConfig.conditionalTokens, MaxUint256, gasOptions);
        logger.info(`Transaction hash: ${tx.hash}`);
        await tx.wait();
        logger.success("✅ USDC approved for ConditionalTokens contract");
    } else {
        logger.info("✅ USDC already approved for ConditionalTokens contract (MaxUint256)");
    }

    const exchangeAllowance = await usdcContract.allowance(address, contractConfig.exchange);
    if (!exchangeAllowance.eq(MaxUint256)) {
        logger.info(`Current Exchange allowance: ${exchangeAllowance.toString()}, setting to MaxUint256...`);
        const tx = await usdcContract.approve(contractConfig.exchange, MaxUint256, gasOptions);
        logger.info(`Transaction hash: ${tx.hash}`);
        await tx.wait();
        logger.success("✅ USDC approved for Exchange contract");
    } else {
        logger.info("✅ USDC already approved for Exchange contract (MaxUint256)");
    }

    const ctfContract = new Contract(contractConfig.conditionalTokens, CTF_ABI, wallet);
    const isApproved = await ctfContract.isApprovedForAll(address, contractConfig.exchange);
    
    if (!isApproved) {
        logger.info("Approving ConditionalTokens for Exchange contract...");
        const tx = await ctfContract.setApprovalForAll(contractConfig.exchange, true, gasOptions);
        logger.info(`Transaction hash: ${tx.hash}`);
        await tx.wait();
        logger.success("✅ ConditionalTokens approved for Exchange contract");
    } else {
        logger.info("✅ ConditionalTokens already approved for Exchange contract");
    }

    const negRisk = process.env.NEG_RISK === "true";
    if (negRisk) {
        const negRiskAdapterAllowance = await usdcContract.allowance(address, contractConfig.negRiskAdapter);
        if (!negRiskAdapterAllowance.eq(MaxUint256)) {
            logger.info(`Current NegRiskAdapter allowance: ${negRiskAdapterAllowance.toString()}, setting to MaxUint256...`);
            const tx = await usdcContract.approve(contractConfig.negRiskAdapter, MaxUint256, gasOptions);
            logger.info(`Transaction hash: ${tx.hash}`);
            await tx.wait();
            logger.success("✅ USDC approved for NegRiskAdapter");
        }

        const negRiskExchangeAllowance = await usdcContract.allowance(address, contractConfig.negRiskExchange);
        if (!negRiskExchangeAllowance.eq(MaxUint256)) {
            logger.info(`Current NegRiskExchange allowance: ${negRiskExchangeAllowance.toString()}, setting to MaxUint256...`);
            const tx = await usdcContract.approve(contractConfig.negRiskExchange, MaxUint256, gasOptions);
            logger.info(`Transaction hash: ${tx.hash}`);
            await tx.wait();
            logger.success("✅ USDC approved for NegRiskExchange");
        }

        const isNegRiskApproved = await ctfContract.isApprovedForAll(address, contractConfig.negRiskExchange);
        if (!isNegRiskApproved) {
            logger.info("Approving ConditionalTokens for NegRiskExchange...");
            const tx = await ctfContract.setApprovalForAll(contractConfig.negRiskExchange, true, gasOptions);
            logger.info(`Transaction hash: ${tx.hash}`);
            await tx.wait();
            logger.success("✅ ConditionalTokens approved for NegRiskExchange");
        }

        const isNegRiskAdapterApproved = await ctfContract.isApprovedForAll(address, contractConfig.negRiskAdapter);
        if (!isNegRiskAdapterApproved) {
            logger.info("Approving ConditionalTokens for NegRiskAdapter...");
            const tx = await ctfContract.setApprovalForAll(contractConfig.negRiskAdapter, true, gasOptions);
            logger.info(`Transaction hash: ${tx.hash}`);
            await tx.wait();
            logger.success("✅ ConditionalTokens approved for NegRiskAdapter");
        }
    }

    logger.success("All allowances approved successfully!");
}

export async function updateClobBalanceAllowance(client: ClobClient): Promise<void> {
    try {
        logger.info("Updating CLOB API balance allowance for USDC...");
        await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
        logger.success("✅ CLOB API balance allowance updated for USDC");
    } catch (error) {
        logger.error(`Failed to update CLOB balance allowance: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

export async function approveTokensAfterBuy(): Promise<void> {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("PRIVATE_KEY not found in environment");
    }

    const chainId = parseInt(`${process.env.CHAIN_ID || Chain.POLYGON}`) as Chain;
    const contractConfig = getContractConfig(chainId);
    
    const provider = getRpcProvider(chainId);
    const wallet = new Wallet(privateKey, provider);
    
    const address = await wallet.getAddress();
    const ctfContract = new Contract(contractConfig.conditionalTokens, CTF_ABI, wallet);

    let gasOptions: { gasPrice?: BigNumber; gasLimit?: number } = {};
    try {
        const gasPrice = await provider.getGasPrice();
        gasOptions = {
            gasPrice: gasPrice.mul(120).div(100),
            gasLimit: 200_000,
        };
    } catch (error) {
        gasOptions = {
            gasPrice: parseUnits("100", "gwei"),
            gasLimit: 200_000,
        };
    }

    const isApproved = await ctfContract.isApprovedForAll(address, contractConfig.exchange);
    
    if (!isApproved) {
        logger.info("Approving ConditionalTokens for Exchange (after buy)...");
        const tx = await ctfContract.setApprovalForAll(contractConfig.exchange, true, gasOptions);
        logger.info(`Transaction hash: ${tx.hash}`);
        await tx.wait();
        logger.success("✅ ConditionalTokens approved for Exchange");
    }

    const negRisk = process.env.NEG_RISK === "true";
    if (negRisk) {
        const isNegRiskApproved = await ctfContract.isApprovedForAll(address, contractConfig.negRiskExchange);
        if (!isNegRiskApproved) {
            logger.info("Approving ConditionalTokens for NegRiskExchange (after buy)...");
            const tx = await ctfContract.setApprovalForAll(contractConfig.negRiskExchange, true, gasOptions);
            logger.info(`Transaction hash: ${tx.hash}`);
            await tx.wait();
            logger.success("✅ ConditionalTokens approved for NegRiskExchange");
        }
    }
}
