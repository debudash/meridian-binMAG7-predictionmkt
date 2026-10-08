# Runbook: Phoenix pauser key — offline backup and rotation

| | |
| --- | --- |
| **Owner** | Meridian operator (Debu) with Engineers |
| **Applies to** | devnet staging now; mainnet only until M1 ships (then the pauser is a program PDA and this runbook retires) |
| **Source** | Reviewers mr72-73 M1 fix "(now) add a pauser rotation runbook (6 + 7 signed by the pauser → new key) and an offline backup" |

## Why this key matters

The pauser is each handed-off book's **full Phoenix Seat Manager (PSM) authority**, not a pause-only key. It can:

- `ChangeMarketStatus` (PSM 8) to **any** status, including Paused → **Active** (unpause after expiry);
- `NameSuccessor` (6) / `ConfirmRenounceSeatManagerAuthority` (11): move the SM authority anywhere, or burn it;
- `NameMarketAuthoritySuccessor` (9): name a new raw Phoenix market authority, which then calls Phoenix
  `ClaimAuthority` (101) and leaves PSM for good (status, seats, force-cancel, evict, fee recipient);
- evict seats, add/remove DMMs, change the fee recipient.

It can't withdraw user funds to itself (evict and force-cancel return funds to traders). A leak lets an attacker
unpause books after the outcome is known, take books out of ops control, and redirect fees. **A lost key can't be
recovered**: PSM has no override, so those books can never be paused, closed or evicted by ops again. Hence the
offline backup is mandatory and rotation must be rehearsed.

## Rules

- Keys are files passed by **path** (`chmod 600`, dir `700`). **Never commit** a key, never paste it in chat, email,
  tickets or logs. Only the public key goes in TRACKER / AI_LOG.
- The only online copies: the operator box (`$KEYS_DIR/pauser.json`) and the Railway secret `PHOENIX_PAUSER_KEYPAIR`
  on the meridian-staging **automation** service. Never the upgrade key on Railway; never reuse the keeper, settler or
  upgrade key as the pauser (`ops-cli` refuses: `PAUSER_MUST_DIFFER_FROM`, `assertPauserDistinct`).
- Railway changes use only the project-scoped token (`RAILWAY_PROJECT_TOKEN`); never print it.

Environment used below (all paths, nothing secret in the shell history):

```
export RPC=<devnet RPC> KEYS_DIR=<keys dir> STATE=<staging state json>
export OLD_PAUSER_KEY=$KEYS_DIR/pauser.json NEW_PAUSER_KEY=$KEYS_DIR/pauser-next.json
export AUTO=<checkout>/apps/automation          # after: npm ci && npm run build
export PAUSER_MUST_DIFFER_FROM=<upgrade pubkey>,<keeper pubkey>,<settler pubkey>
```

## 1. Offline backup (at creation and after every rotation)

1. Generate the key **with a BIP39 seed phrase** (not `--no-bip39-passphrase`):
   `solana-keygen new -o "$NEW_PAUSER_KEY"` → note the pubkey; `chmod 600 "$NEW_PAUSER_KEY"`.
2. Write the seed phrase (and the optional BIP39 passphrase, stored separately) on paper. Keep **two copies in two
   physically separate places** (e.g. a safe and a bank box). No photos, no cloud notes.
3. Encrypted copy: `age -p -o pauser-<pubkey8>.json.age "$NEW_PAUSER_KEY"` (or `gpg -c`) onto **two offline USB
   drives**; the passphrase lives with the paper copy, not with the drive.
4. Verify on an offline machine: `solana-keygen recover -o /tmp/check.json` from the phrase, then
   `solana-keygen pubkey /tmp/check.json` must equal the new pubkey; `shred -u /tmp/check.json`.
5. Record the pubkey, date and backup locations (not the phrase) in the ops log.

## 2. Planned rotation (old pauser → new pauser)

PSM `NameSuccessor` (6, signed by the **current** SM authority) + `ClaimSeatManagerAuthority` (7, signed by the
**new** key) in **one** transaction per book: the successor is a named pubkey and only it can claim, so there is no
front-run window. `ops-cli handoff` does exactly this with the current authority = the old pauser.

1. New key + offline backup (§1). Fund it with ~0.02 SOL. The old pauser pays the handoff fees (keep ~0.01 SOL on it).
2. Dry run (reads only):
   ```
   cd "$AUTO" && SOLANA_RPC_URL=$RPC PHOENIX_PAUSER_KEYPAIR=$NEW_PAUSER_KEY SEAT_MANAGER_AUTHORITY_KEYPAIR=$OLD_PAUSER_KEY \
     PAUSER_MUST_DIFFER_FROM=$PAUSER_MUST_DIFFER_FROM DRY_RUN=1 node dist/ops-cli.js handoff --state "$STATE"
   ```
   Every book should read `would hand off`; `handoff ok` means it's already on the new key; `[pause] ALERT handoff
   skip … neither` means a book is on an unexpected key (stop, investigate, see §3).
3. Real run: the same command without `DRY_RUN=1` (exit 2 if any book failed or was foreign).
4. Verify, no key needed:
   `cd "$AUTO" && SOLANA_RPC_URL=$RPC node dist/ops-cli.js pause-status --state "$STATE" --expect-pauser <NEW pubkey>`
   → `N/N books have the pauser … as seat-manager authority`, exit 0.
5. Switch the online copies **promptly** (until then the worker's old key gets `seat-manager authority changed from the
   pauser` / `skip-not-authority` ALERTs, which is expected):
   - Railway: upsert `PHOENIX_PAUSER_KEYPAIR` on **automation** (project token; confirm by name only), redeploy, and
     check the worker log line `[worker] phoenix pauser=<NEW pubkey>`.
   - Box: back up, then atomically replace: `cp -p "$NEW_PAUSER_KEY" "$KEYS_DIR/.pauser.json.new" && mv -f
     "$KEYS_DIR/.pauser.json.new" "$KEYS_DIR/pauser.json"`; restart the staging watcher / `ops-cli pause-watch`.
6. Re-run the step-4 check, then retire the old key: `shred -u` the old hot copy once the new one is live. Its offline
   backup can be destroyed after one clean expiry cycle.
7. Log the rotation (pubkeys only) in TRACKER and AI_LOG.

## 3. Emergency rotation (suspected leak)

Same as §2 but immediately, books **nearest expiry / already expired first** (those are what an attacker would unpause).
Then:

- Watch for `[pause] ALERT … Phoenix market authority … is not the Seat Manager PDA`: that book has been taken out of
  PSM (PSM 9 → Phoenix 101). Ops can no longer pause it. Tell users on that market to **cancel and withdraw** (still
  possible), and stop pointing the UI at it.
- Watch for `went Active again … re-pausing`: the attacker unpaused; automation re-pauses each pass, but rotation is
  what ends the fight.
- Remove the old value from Railway (overwrite the secret), rotate the Railway project token, review box access.

## 4. Lost key (no usable backup)

Nothing on-chain can recover it. Books still under the lost key can't be paused/closed/evicted by ops; the web UI
still closes trading 5 s before expiry, and users can always cancel/withdraw. New books are handed to a fresh pauser
(§1). This is why M1 (PDA Seat Manager authority + permissionless `pause_book`) blocks mainnet:
`docs/design/phoenix-pause-pda-authority.md`.

## 5. Books still on the upgrade key

Not a rotation: `ops/run-staging.sh` runs `handoff_repair` (upgrade key → pauser, idempotent) after each bootstrap
phase, and `pause-status --expect-pauser` must show every book on the pauser.
