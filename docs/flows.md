# Meridian Instruction Flows

Sequence diagrams for mint, Phoenix trading (beside Meridian), settle, and redeem. Account lists and state machines match [`SCHEMA.md`](SCHEMA.md).

---

## 1. Daily lifecycle (product)

```mermaid
sequenceDiagram
    autonumber
    participant Auto as Automation (TS)
    participant Mer as Meridian program
    participant Phx as Phoenix CLOB
    participant Pyth as Pyth
    participant User as User

    Note over Auto,Mer: ~08:00 ET — compute strikes from prior close
    Auto->>Mer: create_strike_market (per strike)
    Auto->>Phx: create/configure market (base=Yes, quote=USDC)
    Auto->>Mer: set_phoenix_market (if not set at create)

    Note over User,Phx: 09:30–16:00 ET — mint + trade
    User->>Mer: mint(amount)
    User->>Phx: place/cancel/fill Yes↔USDC

    Note over Auto,Pyth: ~16:05 ET — settle
    Auto->>Pyth: read equity close
    Auto->>Mer: settle (permissionless; retries)
    User->>Mer: redeem(winning amount)
```

---

## 2. Mint Yes/No against collateral

Users lock USDC and receive equal Yes and No SPL tokens. Trading happens afterward on Phoenix (not inside this ix).

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant Mer as Meridian
    participant Vault as Collateral vault PDA
    participant Yes as Yes mint
    participant No as No mint
    participant Treasury

    User->>Mer: mint(amount)
    Mer->>Mer: check !paused, status==Open, now < expiry_ts
    Mer->>Vault: transfer amount USDC (user → vault)
    opt mint_fee_bps > 0
        Mer->>Treasury: transfer fee USDC
    end
    Mer->>Yes: mint amount → user Yes ATA
    Mer->>No: mint amount → user No ATA
    Mer->>Mer: pairs_minted += amount
    Mer-->>User: Minted event
```

**State transition:** `pairs_minted` increases; `status` unchanged (`Open`).

**Invariant:** `yes.supply == no.supply`; vault balance covers outstanding pairs.

---

## 3. Phoenix beside mint (trade path)

Meridian does not match orders. After mint (or after buying Yes on Phoenix), the user interacts with Phoenix directly.

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant Mer as Meridian
    participant Phx as Phoenix market
    participant Yes as Yes mint / ATA
    participant USDC as USDC ATA

    Note over User,Mer: Optional: mint to get inventory
    User->>Mer: mint(amount)
    Mer-->>User: Yes + No tokens

    Note over User,Phx: Trade on Phoenix Yes/USDC book
    User->>Phx: place bid/ask (base=Yes, quote=USDC)
    Phx->>Yes: transfer base on fill
    Phx->>USDC: transfer quote on fill

    Note over User: UI maps Buy/Sell Yes/No onto this single book
```

**Wiring stored on `StrikeMarket`:**

- `phoenix_market`
- `phoenix_base_mint == yes_mint`
- `phoenix_quote_mint == collateral_mint`

**No Meridian CPI required for trades.** Indexers join fills via Phoenix + `MarketCreated` / `PhoenixMarketSet` events.

---

## 4. Settle via Pyth

Permissionless after `expiry_ts`. Automation retries per PRD (~15m window / 30s interval); anyone may call when Pyth is fresh enough.

```mermaid
sequenceDiagram
    autonumber
    participant Caller as Caller (auto or user)
    participant Mer as Meridian
    participant Pyth as Pyth price account
    participant Clock as Clock sysvar

    Caller->>Mer: settle
    Mer->>Clock: load now, slot
    Mer->>Mer: require now >= expiry_ts, status==Open
    Mer->>Pyth: load price, conf, expo, publish slot
    Mer->>Mer: staleness + conf ratio gates
    Mer->>Mer: settlement_price_e6 = pyth_to_e6(price, expo)
    alt settlement_price_e6 >= strike_price_e6
        Mer->>Mer: status = SettledYes
    else
        Mer->>Mer: status = SettledNo
    end
    Mer-->>Caller: Settled event
```

**State transition:** `Open` → `SettledYes` | `SettledNo`. Vault unchanged at settle.

### Admin settle (delayed override)

```mermaid
sequenceDiagram
    autonumber
    participant Auth as Config authority
    participant Mer as Meridian
    participant Clock as Clock sysvar

    Auth->>Mer: admin_settle(price_e6, outcome_yes)
    Mer->>Clock: load now
    Mer->>Mer: require now >= expiry_ts + admin_settle_delay_secs
    Mer->>Mer: write settlement fields + status
    Mer-->>Auth: AdminSettled event
```

---

## 5. Redeem winning tokens

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant Mer as Meridian
    participant Win as Winning mint (Yes or No)
    participant Vault as Collateral vault PDA
    participant Treasury

    User->>Mer: redeem(amount)
    Mer->>Mer: require SettledYes|SettledNo, mint matches winner
    Mer->>Win: burn amount from user ATA
    opt redeem_fee_bps > 0
        Mer->>Treasury: fee USDC from vault
    end
    Mer->>Vault: transfer amount - fee USDC → user
    Mer->>Mer: pairs_redeemed += amount
    Mer-->>User: Redeemed event
```

**State transition:** `pairs_redeemed` increases; status unchanged.

**Losing tokens:** optional `burn_losing(amount)` burns without USDC transfer (supply cleanup).

---

## 6. Create market + wire Phoenix

```mermaid
sequenceDiagram
    autonumber
    participant Auth as Authority / automation
    participant Mer as Meridian
    participant Phx as Phoenix
    participant Pyth as Pyth

    Auth->>Mer: create_strike_market(...)
    Mer->>Mer: init StrikeMarket PDA, Yes/No mints, vault
    Mer-->>Auth: MarketCreated

    Auth->>Phx: create market (base=yes_mint, quote=USDC)
    Auth->>Mer: set_phoenix_market(phoenix_market)
    Mer-->>Auth: PhoenixMarketSet

    Note over Pyth: pyth_price_feed already stored at create
```

---

## 7. Pause behavior

```mermaid
stateDiagram-v2
    [*] --> Running: initialize / unpause
    Running --> Paused: pause
    Paused --> Running: unpause

    note right of Paused
      Blocked: create_strike_market, mint
      Allowed: settle, redeem, admin_settle
    end note
```

---

## 8. Client checklist

| Step | Client action |
| --- | --- |
| Mint | Ensure Yes/No/USDC ATAs exist; pass vault + mint PDAs |
| Trade | Use Phoenix SDK against `StrikeMarket.phoenix_market` |
| Settle | Pass canonical Pyth price account; handle stale/conf errors with retry |
| Redeem | Select winning mint from `status`; burn + receive USDC |

See [`units.md`](units.md) for price conversion and [`accounts.md`](accounts.md) for PDA seeds.
