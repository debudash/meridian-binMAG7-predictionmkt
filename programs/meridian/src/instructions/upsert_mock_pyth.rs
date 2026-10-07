use anchor_lang::prelude::*;
use crate::utils::pyth::MockPythPrice;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MockPythParams {
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_slot: u64,
    pub feed_id: [u8; 32],
}

#[derive(Accounts)]
pub struct UpsertMockPyth<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: mock pyth price account; created by this ix for local fixtures
    #[account(mut)]
    pub pyth_price_feed: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<UpsertMockPyth>, params: MockPythParams) -> Result<()> {
    let mock = MockPythPrice {
        price: params.price,
        conf: params.conf,
        expo: params.expo,
        publish_slot: params.publish_slot,
        feed_id: params.feed_id,
    };
    let data = mock.pack();
    let acc = &ctx.accounts.pyth_price_feed;
    let lamports_needed = Rent::get()?.minimum_balance(MockPythPrice::LEN);
    if acc.lamports() == 0 {
        let ix = anchor_lang::solana_program::system_instruction::create_account(
            &ctx.accounts.payer.key(),
            &acc.key(),
            lamports_needed,
            MockPythPrice::LEN as u64,
            ctx.program_id,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.payer.to_account_info(),
                acc.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    }
    let mut dst = acc.try_borrow_mut_data()?;
    require_eq!(dst.len(), MockPythPrice::LEN);
    dst.copy_from_slice(&data);
    Ok(())
}
