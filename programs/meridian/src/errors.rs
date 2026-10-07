use anchor_lang::prelude::*;

#[error_code]
pub enum MeridianError {
    #[msg("Protocol paused")]
    Paused,
    #[msg("Market not open")]
    MarketNotOpen,
    #[msg("Market not settled")]
    MarketNotSettled,
    #[msg("Expiry not reached")]
    ExpiryNotReached,
    #[msg("Cannot mint after expiry")]
    MintAfterExpiry,
    #[msg("Invalid Pyth account")]
    InvalidPythAccount,
    #[msg("Stale Pyth price")]
    StalePythPrice,
    #[msg("Pyth confidence too wide")]
    PythConfidenceTooWide,
    #[msg("Invalid Pyth price")]
    InvalidPythPrice,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid winning mint")]
    InvalidWinningMint,
    #[msg("Admin settle too early")]
    AdminSettleTooEarly,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid Phoenix mints")]
    InvalidPhoenixMints,
    #[msg("Insufficient vault")]
    InsufficientVault,
    #[msg("Zero amount")]
    ZeroAmount,
    #[msg("Invalid collateral decimals")]
    InvalidCollateralDecimals,
    #[msg("Trading window closed (sim session)")]
    TradingClosed,
    #[msg("Sim session still open — close before settle")]
    SessionNotClosed,
    #[msg("Fee bps exceeds hard cap")]
    FeeTooHigh,
    #[msg("Config update timelock not elapsed")]
    ConfigTimelock,
    #[msg("Admin settle delay below production minimum")]
    AdminSettleDelayTooLow,
    #[msg("outcome_yes inconsistent with settlement_price_e6 vs strike")]
    OutcomeInconsistent,
    #[msg("Simulated clock not enabled")]
    SimClockNotEnabled,
}
