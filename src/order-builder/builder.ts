import { ClobClient, OrderType, Side, AssetType } from "@polymarket/clob-client";
import type { UserMarketOrder, CreateOrderOptions } from "@polymarket/clob-client";
import type { TradePayload } from "../utils/types";
import type { CopyTradeOptions, CopyTradeResult } from "./types";
import { tradeToMarketOrder, getDefaultOrderOptions } from "./helpers";
import { logger } from "../utils/logger";
import { addHoldings, getHoldings, removeHoldings } from "../utils/holdings";
import { approveTokensAfterBuy, updateClobBalanceAllowance } from "../security/allowance";
import { validateBuyOrderBalance, displayWalletBalance } from "../utils/balance";

export class TradeOrderBuilder {
    private client: ClobClient;

    constructor(client: ClobClient) {
        this.client = client;
    }

    async copyTrade(options: CopyTradeOptions): Promise<CopyTradeResult> {   
        try {
            const { trade, tickSize = "0.01", negRisk = false, orderType = OrderType.FAK } = options;
            const marketId = trade.conditionId;
            const tokenId = trade.asset;

            if (trade.side.toUpperCase() === "SELL") {
                const holdingsAmount = getHoldings(marketId, tokenId);
                
                if (holdingsAmount <= 0) {
                    logger.warning(
                        `No holdings found for token ${tokenId} in market ${marketId}. ` +
                        `Skipping SELL order.`
                    );
                    return {
                        success: false,
                        error: "No holdings available to sell",
                    };
                }

                const sellAmount = holdingsAmount;

                const marketOrder: UserMarketOrder = {
                    tokenID: tokenId,
                    side: Side.SELL,
                    amount: sellAmount,
                    orderType,
                };

                const orderOptions: Partial<CreateOrderOptions> = getDefaultOrderOptions(tickSize, negRisk);

                logger.info(`Placing SELL market order: ${sellAmount} shares (type: ${orderType})`);
                
                const response = await this.client.createAndPostMarketOrder(
                    marketOrder,
                    orderOptions,
                    orderType
                );

                if (!response || (response.status && response.status !== "FILLED" && response.status !== "PARTIALLY_FILLED")) {
                    logger.warning(`Order may not have been fully successful. Status: ${response?.status || "unknown"}`);
                }

                const tokensSold = response.makingAmount 
                    ? parseFloat(response.makingAmount) 
                    : sellAmount;

                if (tokensSold > 0) {
                    removeHoldings(marketId, tokenId, tokensSold);
                    logger.info(`✅ Removed ${tokensSold} tokens from holdings: ${marketId} -> ${tokenId}`);
                } else {
                    logger.warning("No tokens were sold - not removing from holdings");
                }

                logger.success(
                    `SELL order executed! ` +
                    `OrderID: ${response.orderID || "N/A"}, ` +
                    `Tokens sold: ${tokensSold}, ` +
                    `Status: ${response.status || "N/A"}`
                );

                return {
                    success: true,
                    orderID: response.orderID,
                    transactionHashes: response.transactionsHashes,
                    marketOrder,
                };
            }

            logger.info(
                `Building order to copy trade: ${trade.side} ${trade.size} @ ${trade.price} ` +
                `for token ${tokenId.substring(0, 20)}...`
            );

            const marketOrder = tradeToMarketOrder(options);
            
            try {
                await this.client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
            } catch (error) {
                logger.warning(`Failed to update balance allowance: ${error instanceof Error ? error.message : String(error)}`);
            }
            
            await displayWalletBalance(this.client);
            
            const balanceCheck = await validateBuyOrderBalance(
                this.client,
                marketOrder.amount
            );

            if (!balanceCheck.valid) {
                logger.warning(
                    `Insufficient USDC balance for BUY order. ` +
                    `Required: ${balanceCheck.required}, Available: ${balanceCheck.available}. ` +
                    `Adjusting order amount to available balance.`
                );
                
                if (balanceCheck.available <= 0) {
                    return {
                        success: false,
                        error: `Insufficient USDC balance. Available: ${balanceCheck.available}`,
                    };
                }

                marketOrder.amount = balanceCheck.available;
                logger.info(`Adjusted order amount to available balance: ${marketOrder.amount}`);
            }
            
            const orderOptions: Partial<CreateOrderOptions> = getDefaultOrderOptions(tickSize, negRisk);

            logger.info(`Placing ${marketOrder.side} market order: ${marketOrder.amount} (type: ${orderType})`);
            
            const response = await this.client.createAndPostMarketOrder(
                marketOrder,
                orderOptions,
                orderType
            );

            if (!response || (response.status && response.status !== "FILLED" && response.status !== "PARTIALLY_FILLED")) {
                logger.warning(`Order may not have been fully successful. Status: ${response?.status || "unknown"}`);
            }

            const tokensReceived = response.takingAmount 
                ? parseFloat(response.takingAmount) 
                : 0;
            
            if (tokensReceived > 0) {
                addHoldings(marketId, tokenId, tokensReceived);
                logger.info(`✅ Added ${tokensReceived} tokens to holdings: ${marketId} -> ${tokenId}`);
            } else {
                const estimatedTokens = marketOrder.amount / (trade.price || 1);
                if (estimatedTokens > 0) {
                    addHoldings(marketId, tokenId, estimatedTokens);
                    logger.warning(`Using estimated token amount: ${estimatedTokens} (actual amount not in response)`);
                } else {
                    logger.warning("No tokens received and cannot estimate - not adding to holdings");
                }
            }

            try {
                await approveTokensAfterBuy();
            } catch (error) {
                logger.warning(`Failed to approve tokens after buy: ${error instanceof Error ? error.message : String(error)}`);
            }

            logger.success(
                `BUY order executed! ` +
                `OrderID: ${response.orderID || "N/A"}, ` +
                `Tokens received: ${tokensReceived || "estimated"}, ` +
                `Status: ${response.status || "N/A"}`
            );

            return {
                success: true,
                orderID: response.orderID,
                transactionHashes: response.transactionsHashes,
                marketOrder,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            if (errorMessage.includes("not enough balance") || errorMessage.includes("allowance")) {
                logger.error("═══════════════════════════════════════");
                logger.error("❌ ORDER FAILED: Balance/Allowance Error");
                logger.error("═══════════════════════════════════════");
                
                try {
                    await displayWalletBalance(this.client);
                    logger.info("Attempting to update balance allowance...");
                    await this.client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
                } catch (balanceError) {
                    logger.error(`Failed to get balance: ${balanceError instanceof Error ? balanceError.message : String(balanceError)}`);
                }
                
                logger.error("═══════════════════════════════════════");
            }
            
            logger.error(`Failed to copy trade: ${errorMessage}`);
            
            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    async placeMarketBuy(
        tokenID: string,
        amount: number,
        options?: {
            tickSize?: CreateOrderOptions["tickSize"];
            negRisk?: boolean;
            orderType?: OrderType.FOK | OrderType.FAK;
            price?: number;
        }
    ): Promise<CopyTradeResult> {
        const marketOrder: UserMarketOrder = {
            tokenID,
            side: Side.BUY,
            amount,
            orderType: options?.orderType || OrderType.FAK,
            ...(options?.price !== undefined && { price: options.price }),
        };

        const orderOptions: Partial<CreateOrderOptions> = getDefaultOrderOptions(
            options?.tickSize,
            options?.negRisk
        );

        try {
            const response = await this.client.createAndPostMarketOrder(
                marketOrder,
                orderOptions,
                marketOrder.orderType || OrderType.FAK
            );

            return {
                success: true,
                orderID: response.orderID,
                transactionHashes: response.transactionsHashes,
                marketOrder,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    async placeMarketSell(
        tokenID: string,
        amount: number,
        options?: {
            tickSize?: CreateOrderOptions["tickSize"];
            negRisk?: boolean;
            orderType?: OrderType.FOK | OrderType.FAK;
            price?: number;
        }
    ): Promise<CopyTradeResult> {
        const marketOrder: UserMarketOrder = {
            tokenID,
            side: Side.SELL,
            amount,
            orderType: options?.orderType || OrderType.FAK,
            ...(options?.price !== undefined && { price: options.price }),
        };

        const orderOptions: Partial<CreateOrderOptions> = getDefaultOrderOptions(
            options?.tickSize,
            options?.negRisk
        );

        try {
            const response = await this.client.createAndPostMarketOrder(
                marketOrder,
                orderOptions,
                marketOrder.orderType || OrderType.FAK
            );

            return {
                success: true,
                orderID: response.orderID,
                transactionHashes: response.transactionsHashes,
                marketOrder,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: errorMessage,
            };
        }
    }
}
