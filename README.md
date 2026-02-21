# Polymarket Copy Trading Bot

A TypeScript bot that watches a Polymarket wallet and places matching orders with your own wallet in real time. It uses Polymarket’s real-time activity feed and CLOB API, with optional automatic redemption of resolved markets.

---

## Requirements

- **Node.js** (with ts-node) or **Bun**
- A **Polygon** wallet with USDC for placing orders
- A **Polymarket** account
- The **address of the wallet** you want to copy (target wallet)

---

## Installation

Clone the repo and install dependencies:

```bash
git clone <your-repo-url>
cd polymarket-copy-trading-bot
npm install
```

Or with Bun:

```bash
bun install
```

---

## Configuration

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` and set at least:

- **`PRIVATE_KEY`** – Your Polygon wallet private key (the one that will place orders and hold positions).
- **`TARGET_WALLET`** – The Polymarket wallet address you want to copy.

Optional settings (with defaults):

| Variable              | Meaning                                                          | Default |
| --------------------- | ---------------------------------------------------------------- | ------- |
| `SIZE_MULTIPLIER`     | Your order size as a fraction of the target’s (e.g. `0.3` = 30%) | `0.3`   |
| `MAX_ORDER_AMOUNT`    | Maximum USDC per order                                           | `5`     |
| `ENABLE_COPY_TRADING` | Turn copy trading on/off                                         | `true`  |
| `REDEEM_DURATION`     | Minutes between auto-redemption runs (0 = disabled)              | `15`    |
| `ORDER_TYPE`          | `FAK` or `FOK`                                                   | `FAK`   |
| `TICK_SIZE`           | Price tick: `0.1`, `0.01`, `0.001`, `0.0001`                     | `0.01`  |
| `NEG_RISK`            | Use negative risk market format                                  | `false` |

On first run, the bot creates API credentials and stores them in `src/data/credential.json`. It also records positions in `src/data/token-holding.json` for redemption.

---

## Running the bot

Start the main process (copy trading + optional auto-redemption):

```bash
npm run start
```

Or:

```bash
bun src/index.ts
```

The bot will:

1. Connect to Polymarket’s real-time feed and subscribe to trades.
2. When the **target wallet** trades, build and place an order on your behalf (subject to multiplier and max amount).
3. If `REDEEM_DURATION` is set, periodically redeem resolved markets from `token-holding.json` (and briefly pause copy trading during redemption).

---

## CLI commands

**Auto-redeem (batch)**  
Uses local `token-holding.json`:

```bash
npm run auto-redeem
# or
bun src/cli/auto-redeem.ts
```

Dry run (no redemption, just report what would happen):

```bash
npm run auto-redeem -- --dry-run
bun src/cli/auto-redeem.ts --dry-run
```

Use API balances instead of local holdings:

```bash
npm run auto-redeem -- --api
bun src/cli/auto-redeem.ts --api
```

**Check if a market is resolved** (by condition ID):

```bash
npm run auto-redeem -- --check <conditionId>
bun src/cli/auto-redeem.ts --check <conditionId>
```

Optionally redeem that market after checking:

```bash
bun src/cli/auto-redeem.ts --check <conditionId> --redeem
```

**Redeem a single market** (by condition ID):

```bash
npm run redeem -- <conditionId>
bun src/cli/redeem.ts <conditionId>
```

You can pass index sets as extra args or set `CONDITION_ID` and `INDEX_SETS` in `.env`. With no args, `redeem.ts` lists current holdings from `token-holding.json`.

---

## How it works

1. **Real-time feed** – The bot connects to Polymarket’s WebSocket and subscribes to trade activity.
2. **Filter** – Only trades from `TARGET_WALLET` are considered.
3. **Order building** – For each such trade, it builds an order: applies `SIZE_MULTIPLIER`, caps with `MAX_ORDER_AMOUNT`, and uses the configured tick size and order type (FAK/FOK).
4. **Execution** – The order is sent via the CLOB API; your wallet must have USDC and sufficient allowance (the bot handles allowance setup on startup).
5. **Holdings** – Filled positions are tracked in `src/data/token-holding.json`.
6. **Redemption** – Either on a timer (when `REDEEM_DURATION` is set) or via the CLI, the bot checks resolved markets and redeems winning outcomes from those holdings (or from API when using `--api`).

---

## Project structure

```
src/
├── index.ts              Entrypoint: WebSocket client, copy logic, optional auto-redeem loop
├── cli/
│   ├── redeem.ts         Single-market redeem; list holdings if no args
│   └── auto-redeem.ts    Batch redeem (holdings or API), --check, --dry-run
├── redemption/
│   └── redeem.ts         Resolution checks, CTF/API redemption, auto-redeem logic
├── order-builder/        Converts a trade into an order (multiplier, limits, FAK/FOK)
├── providers/            CLOB client, real-time WebSocket, RPC
├── security/             API credential creation, USDC allowance
├── data/
│   ├── credential.json   API credentials (created on first run)
│   └── token-holding.json  Local position tracking for redemption
└── utils/                Logging, balance, holdings, types
```

Built with TypeScript, `@polymarket/clob-client`, `@polymarket/real-time-data-client`, Ethers v6, and Polygon.

---

## Security and risks

- Your private key and API credentials are read from `.env` and `src/data/` only; they are not hardcoded.
- The bot approves USDC allowance and syncs with the CLOB on startup so orders can be placed.
- Use a small `SIZE_MULTIPLIER` and low `MAX_ORDER_AMOUNT` while testing. Use `--dry-run` for redemption to see what would be redeemed without sending transactions.

Trading and redemption involve market, liquidity, slippage, gas, and API risks. Use at your own risk and only with funds you can afford to lose.

---

## Development

Type-check and run in watch mode:

```bash
npx tsc --noEmit
npx ts-node --watch src/index.ts
```

With Bun:

```bash
bun run tsc --noEmit
bun --watch src/index.ts
```
