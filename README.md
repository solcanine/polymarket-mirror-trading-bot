# 🤖 Polymarket Copy Trading Bot

> Copy a Polymarket wallet in real time. When they trade, you trade—with your own size and limits.

TypeScript bot that watches a target wallet via Polymarket’s real-time feed and places matching orders from your Polygon wallet. Optional auto-redemption of resolved markets.

---

## 📋 Table of contents

- [What you need](#-what-you-need)
- [Quick start](#-quick-start)
- [Configuration](#-configuration)
- [Running the bot](#-running-the-bot)
- [CLI: Redemption](#-cli-redemption)
- [How it works](#-how-it-works)
- [Project structure](#-project-structure)
- [Security & risks](#-security--risks)
- [Development](#-development)

---

## ✅ What you need

| Need | Description |
|------|-------------|
| **Runtime** | Node.js (with ts-node) or [Bun](https://bun.sh) |
| **Wallet** | Polygon wallet with USDC for orders |
| **Account** | Polymarket account (for API credentials) |
| **Target** | The wallet address you want to copy |

---

## 🚀 Quick start

```bash
# Clone and install
git clone <your-repo-url>
cd polymarket-copy-trading-bot
npm install
# or: bun install

# Configure (required)
cp .env.example .env
# Edit .env: set PRIVATE_KEY and TARGET_WALLET

# Run
npm run start
# or: bun src/index.ts
```

On first run the bot creates `src/data/credential.json` and will track positions in `src/data/token-holding.json` for redemption.

---

## ⚙️ Configuration

Create `.env` from the example and set at least:

| Variable | Description |
|----------|-------------|
| `PRIVATE_KEY` | Your Polygon wallet private key (places orders) |
| `TARGET_WALLET` | Polymarket wallet address to copy |

### Optional settings

| Variable | Meaning | Default |
|----------|---------|---------|
| `SIZE_MULTIPLIER` | Your size as fraction of target (e.g. `0.3` = 30%) | `0.3` |
| `MAX_ORDER_AMOUNT` | Max USDC per order | `5` |
| `ENABLE_COPY_TRADING` | Enable/disable copy trading | `true` |
| `REDEEM_DURATION` | Minutes between auto-redemption; `0` = off | `15` |
| `ORDER_TYPE` | `FAK` or `FOK` | `FAK` |
| `TICK_SIZE` | Price tick: `0.1`, `0.01`, `0.001`, `0.0001` | `0.01` |
| `NEG_RISK` | Use negative risk market format | `false` |

---

## ▶️ Running the bot

```bash
npm run start
```

Or with Bun: `bun src/index.ts`

**What happens:**

1. 🔌 Connects to Polymarket’s real-time feed and subscribes to trades.
2. 🎯 When the **target wallet** trades, builds and places an order (respecting multiplier and max amount).
3. 🔄 If `REDEEM_DURATION` is set, runs auto-redemption on a timer and briefly pauses copy trading during redemption.

---

## 📦 CLI: Redemption

All examples below work with `npm run <script> --` or `bun src/cli/<script>.ts`.

### Batch auto-redeem

Uses local `src/data/token-holding.json`:

```bash
npm run auto-redeem
```

**Dry run** (no transactions, only report):

```bash
npm run auto-redeem -- --dry-run
```

**Use API balances** instead of local holdings:

```bash
npm run auto-redeem -- --api
```

### Check if a market is resolved

```bash
npm run auto-redeem -- --check <conditionId>
```

Redeem that market after checking:

```bash
bun src/cli/auto-redeem.ts --check <conditionId> --redeem
```

### Single-market redeem

```bash
npm run redeem -- <conditionId>
```

Optional: pass index sets as extra args, or set `CONDITION_ID` and `INDEX_SETS` in `.env`.  
With **no arguments**, `redeem` lists current holdings from `token-holding.json`.

---

## 🔄 How it works

1. **Real-time feed** — WebSocket subscription to Polymarket trade activity.
2. **Filter** — Only trades from `TARGET_WALLET` are processed.
3. **Order build** — Applies `SIZE_MULTIPLIER`, caps with `MAX_ORDER_AMOUNT`, uses your `TICK_SIZE` and `ORDER_TYPE` (FAK/FOK).
4. **Execution** — Order sent via CLOB API; the bot sets USDC allowance on startup.
5. **Holdings** — Filled positions are stored in `src/data/token-holding.json`.
6. **Redemption** — On a schedule (`REDEEM_DURATION`) or via CLI; resolves markets and redeems winning outcomes (from local holdings or API with `--api`).

---

## 📁 Project structure

```
src/
├── index.ts              Entrypoint: WebSocket, copy logic, optional auto-redeem
├── cli/
│   ├── redeem.ts         Single-market redeem; list holdings if no args
│   └── auto-redeem.ts    Batch redeem, --check, --dry-run, --api
├── redemption/redeem.ts  Resolution checks, CTF/API redemption
├── order-builder/        Trade → order (multiplier, limits, FAK/FOK)
├── providers/            CLOB client, WebSocket, RPC
├── security/             API credentials, USDC allowance
├── data/
│   ├── credential.json   API credentials (created on first run)
│   └── token-holding.json  Position tracking for redemption
└── utils/                Logging, balance, holdings, types
```

**Stack:** TypeScript, `@polymarket/clob-client`, `@polymarket/real-time-data-client`, Ethers v6, Polygon.

---

## ⚠️ Security & risks

- **Secrets** — Private key and API credentials are read only from `.env` and `src/data/` (not hardcoded).
- **Allowance** — The bot approves USDC allowance and syncs with the CLOB on startup.
- **Testing** — Use a small `SIZE_MULTIPLIER` and low `MAX_ORDER_AMOUNT`; use `--dry-run` for redemption to preview without sending transactions.

Trading and redemption carry market, liquidity, slippage, gas, and API risks. Use at your own risk and only with funds you can afford to lose.

---

## 🛠️ Development

```bash
# Type-check
npm run typecheck
# or: bun run typecheck

# Run in watch mode
npx ts-node --watch src/index.ts
# or: bun --watch src/index.ts
```

---

*Built for Polymarket on Polygon.*
