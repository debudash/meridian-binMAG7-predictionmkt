/**
 * Phoenix Seat Manager (PSM) instructions used to pause books at expiry (review dd46769).
 *
 * Verified against Ellipsis-Labs phoenix-seat-manager-v1 (31ad32a) and phoenix-v1 sources:
 *  - Staging books hand their Phoenix market authority to the Seat Manager PDA ([market] under PSM)
 *    via Phoenix NameSuccessor (102) + PSM ClaimMarketAuthority (0). From then on Phoenix
 *    ChangeMarketStatus can only be reached through PSM ChangeMarketStatus (8), which checks the
 *    *seat-manager authority* (SeatManager.authority) as signer and CPIs with the PDA's seeds.
 *  - SeatManager.authority starts as the ClaimMarketAuthority payer (the box upgrade key). PSM
 *    NameSuccessor (6, signed by the current SM authority) + ClaimSeatManagerAuthority (7, signed by
 *    the successor) move it, per market, to a dedicated pauser key.
 *  - The SM authority is a FULL book authority, not "pause only" (Reviewers mr72-73 M1): besides
 *    ChangeMarketStatus to ANY status (incl. Paused → Active) it can NameSuccessor (6) /
 *    ConfirmRenounceSeatManagerAuthority (11) to move or burn the SM authority, and
 *    NameMarketAuthoritySuccessor (9) to name a new raw Phoenix market authority that then leaves PSM
 *    for good (Phoenix ClaimAuthority 101: status, seats, force-cancel, evict, fee recipient). It can
 *    also evict seats, add/remove DMMs and change the fee recipient. It can't withdraw user funds to
 *    itself (evict / force-cancel return funds to traders). Mainnet needs a PDA authority instead
 *    (docs/design/phoenix-pause-pda-authority.md). Never the Meridian upgrade/config key.
 *  - Phoenix MarketStatus is Borsh-encoded (1-byte variant). Paused (3) = only reductions (cancel)
 *    and withdrawals; Active↔Paused, Paused→Closed are valid transitions.
 */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export const PHOENIX_PROGRAM_ID = new PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY");
export const PHOENIX_SEAT_MANAGER_PROGRAM_ID = new PublicKey("PSMxQbAoDWDbvd9ezQJgARyq6R9L5kJAasaLDVcZwf1");

export enum PhoenixMarketStatus {
  Uninitialized = 0,
  Active = 1,
  PostOnly = 2,
  Paused = 3,
  Closed = 4,
  Tombstoned = 5,
}

/** PSM instruction tags (seat-manager-v1 src/instruction.rs). */
export const PSM_IX = {
  ClaimMarketAuthority: 0,
  NameSuccessor: 6,
  ClaimSeatManagerAuthority: 7,
  ChangeMarketStatus: 8,
} as const;

export function phoenixLogAuthority(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("log")], PHOENIX_PROGRAM_ID)[0];
}

export function seatManagerAddress(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([market.toBuffer()], PHOENIX_SEAT_MANAGER_PROGRAM_ID)[0];
}

export function psmChangeMarketStatusIx(opts: {
  market: PublicKey;
  /** Current seat-manager authority (the pauser after the handoff) */
  authority: PublicKey;
  status: PhoenixMarketStatus;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: PHOENIX_SEAT_MANAGER_PROGRAM_ID,
    data: Buffer.from([PSM_IX.ChangeMarketStatus, opts.status]),
    keys: [
      { pubkey: PHOENIX_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: phoenixLogAuthority(), isSigner: false, isWritable: false },
      { pubkey: opts.market, isSigner: false, isWritable: true },
      // Writable although the PSM IDL says read-only: Phoenix ChangeMarketStatus marks its authority
      // (this PDA) writable, so a read-only meta fails the CPI ("writable privilege escalated").
      { pubkey: seatManagerAddress(opts.market), isSigner: false, isWritable: true },
      { pubkey: opts.authority, isSigner: true, isWritable: false },
    ],
  });
}

export function psmNameSuccessorIx(opts: {
  market: PublicKey;
  authority: PublicKey;
  successor: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: PHOENIX_SEAT_MANAGER_PROGRAM_ID,
    data: Buffer.from([PSM_IX.NameSuccessor]),
    keys: [
      { pubkey: seatManagerAddress(opts.market), isSigner: false, isWritable: true },
      { pubkey: opts.authority, isSigner: true, isWritable: false },
      { pubkey: opts.successor, isSigner: false, isWritable: false },
    ],
  });
}

export function psmClaimSeatManagerAuthorityIx(opts: {
  market: PublicKey;
  successor: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: PHOENIX_SEAT_MANAGER_PROGRAM_ID,
    data: Buffer.from([PSM_IX.ClaimSeatManagerAuthority]),
    keys: [
      { pubkey: seatManagerAddress(opts.market), isSigner: false, isWritable: true },
      { pubkey: opts.successor, isSigner: true, isWritable: false },
    ],
  });
}

/** Both signers (current SM authority + new authority) sign one transaction. */
export function seatManagerHandoffIxs(opts: {
  market: PublicKey;
  currentAuthority: PublicKey;
  newAuthority: PublicKey;
}): TransactionInstruction[] {
  if (opts.currentAuthority.equals(opts.newAuthority)) {
    throw new Error("seat-manager handoff: new authority must differ from the current one");
  }
  return [
    psmNameSuccessorIx({ market: opts.market, authority: opts.currentAuthority, successor: opts.newAuthority }),
    psmClaimSeatManagerAuthorityIx({ market: opts.market, successor: opts.newAuthority }),
  ];
}

/** Phoenix MarketHeader: discriminant u64 @0, status u64 @8 (read with dataSlice {0,16}). */
export function decodePhoenixMarketStatus(data: Buffer | Uint8Array): PhoenixMarketStatus {
  const b = Buffer.from(data);
  if (b.length < 16) throw new Error(`Phoenix market header too short (${b.length} bytes)`);
  const s = Number(b.readBigUInt64LE(8));
  if (!(s in PhoenixMarketStatus)) throw new Error(`Unknown Phoenix market status ${s}`);
  return s as PhoenixMarketStatus;
}

/** Byte offset of MarketHeader.authority (after status, size params, base/quote TokenParams, lot/tick sizes). */
export const PHOENIX_HEADER_AUTHORITY_OFFSET = 208;
/** Header slice that covers status (@8) and authority (@208..240). */
export const PHOENIX_HEADER_SLICE = 240;

/** Status (+ market authority when the slice reaches 240 bytes). Throws on short data / unknown status. */
export function decodePhoenixMarketHeader(data: Buffer | Uint8Array): { status: PhoenixMarketStatus; authority: PublicKey | null } {
  const b = Buffer.from(data);
  const status = decodePhoenixMarketStatus(b);
  const end = PHOENIX_HEADER_AUTHORITY_OFFSET + 32;
  return { status, authority: b.length >= end ? new PublicKey(b.subarray(PHOENIX_HEADER_AUTHORITY_OFFSET, end)) : null };
}

/** PSM SeatManager (bytemuck, no discriminator): market @0, authority @32, successor @64. */
export function decodeSeatManager(data: Buffer | Uint8Array): { market: PublicKey; authority: PublicKey; successor: PublicKey } {
  const b = Buffer.from(data);
  if (b.length < 96) throw new Error(`SeatManager account too short (${b.length} bytes)`);
  return {
    market: new PublicKey(b.subarray(0, 32)),
    authority: new PublicKey(b.subarray(32, 64)),
    successor: new PublicKey(b.subarray(64, 96)),
  };
}
