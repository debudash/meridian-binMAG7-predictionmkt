# Peak6 PRD — Meridian (Gauntlet AI Platinum brief, v1, last updated 2026-08-07)

Source brief for this project. Copied here verbatim so every deliverable can trace back to it.
Technical contact: Myles Lewis (Peak6).

## Summary

Build a non-custodial decentralized application for trading binary outcome contracts tied to daily closing prices of
MAG7 US equities. Users trade Yes/No tokens representing whether a stock will close above a given strike price, with
each contract settling at $1 USDC if correct, $0 if wrong. The system needs to automate daily market creation,
facilitate trading, and handle settlements via price oracles.

## Business context

Provides retail traders a simple, intuitive way to express directional views on stock prices through binary outcomes.
Eliminates complexity of traditional options by having known maximum gain/loss at entry. Non-custodial blockchain
architecture removes intermediaries and increases transparency.

## Impact metrics

100% accuracy in settlements, markets created before market open daily, settlements within 10 minutes of market
close, full lifecycle demo on testnet, $1.00 payout invariant maintained.

## Functional requirements

Daily market creation for 7 stocks (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA), Yes/No token trading, automated
settlement via oracle, position management, real-time order book, wallet integration, minting/redemption functionality.

## Performance benchmarks

Sub-second finality for transactions, settlement within 10 minutes of market close, real-time order book updates,
oracle price staleness under 5 minutes.

## Code quality expectations

Unit tests for all core functions, integration tests for full lifecycle, frontend tests for UI flows, invariant
testing, clear documentation, reproducible deployment scripts.

## Time constraints

Daily lifecycle: market creation by 8:00 AM ET, trading 9:30 AM - 4:00 PM ET, settlement by 4:05 PM ET.

## Technology

- Required languages: Rust, TypeScript, JavaScript
- Dev tools: React, Next.js, Node.js, Anchor Framework, Git
- Cloud: not specified, but likely needs cloud hosting for the automation service
- Other: Solana (preferred) or EVM L2, price oracle integration, USDC integration, Central Limit Order Book (CLOB),
  environment variables for secrets

## Submission

AI usage documentation is required.

Required deliverables: Source Code · Technical Documentation · Demo Video · Deployment Guide · Test Results · AI Usage Log
