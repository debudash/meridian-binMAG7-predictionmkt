/**
 * Phoenix Seat Manager (PSM) instruction builders for the ops scripts (devnet-bootstrap handoff,
 * pause). Byte-for-byte parity with apps/automation/src/phoenix/seatManager.ts is asserted by
 * apps/automation/test/phoenix-pause.test.ts. Usage: const psm = require("./lib/psm.cjs")(web3);
 * Source of truth: Ellipsis-Labs phoenix-seat-manager-v1 src/instruction.rs (6 NameSuccessor,
 * 7 ClaimSeatManagerAuthority, 8 ChangeMarketStatus).
 */
module.exports = function psm(web3) {
  const { PublicKey, TransactionInstruction } = web3;
  const PHX = new PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY");
  const PSM = new PublicKey("PSMxQbAoDWDbvd9ezQJgARyq6R9L5kJAasaLDVcZwf1");
  const STATUS = { Uninitialized: 0, Active: 1, PostOnly: 2, Paused: 3, Closed: 4, Tombstoned: 5 };
  const logAuthority = () => PublicKey.findProgramAddressSync([Buffer.from("log")], PHX)[0];
  const seatManager = (market) => PublicKey.findProgramAddressSync([market.toBuffer()], PSM)[0];
  const nameSuccessorIx = (market, authority, successor) => new TransactionInstruction({ programId: PSM, data: Buffer.from([6]), keys: [
    { pubkey: seatManager(market), isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: successor, isSigner: false, isWritable: false }] });
  const claimSeatManagerAuthorityIx = (market, successor) => new TransactionInstruction({ programId: PSM, data: Buffer.from([7]), keys: [
    { pubkey: seatManager(market), isSigner: false, isWritable: true },
    { pubkey: successor, isSigner: true, isWritable: false }] });
  const changeMarketStatusIx = (market, authority, status) => new TransactionInstruction({ programId: PSM, data: Buffer.from([8, status]), keys: [
    { pubkey: PHX, isSigner: false, isWritable: false },
    { pubkey: logAuthority(), isSigner: false, isWritable: false },
    { pubkey: market, isSigner: false, isWritable: true },
    { pubkey: seatManager(market), isSigner: false, isWritable: true }, // writable: Phoenix CPI marks its authority writable
    { pubkey: authority, isSigner: true, isWritable: false }] });
  /** SeatManager (bytemuck, no discriminator): market @0, authority @32, successor @64 */
  const decodeSeatManagerAuthority = (data) => new PublicKey(Buffer.from(data).subarray(32, 64));
  /** Phoenix MarketHeader.status: u64 @8 */
  const decodeMarketStatus = (data) => Number(Buffer.from(data).readBigUInt64LE(8));
  return { PHX, PSM, STATUS, logAuthority, seatManager, nameSuccessorIx, claimSeatManagerAuthorityIx, changeMarketStatusIx,
    decodeSeatManagerAuthority, decodeMarketStatus };
};
