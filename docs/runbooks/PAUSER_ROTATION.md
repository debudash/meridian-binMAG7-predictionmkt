# Runbook: Phoenix pauser key — offline backup and rotation

| | |
| --- | --- |
| **Owner** | Meridian operator (Debu) with Engineers |
| **Applies to** | devnet staging now; mainnet only until M1 ships (then the pauser is a program PDA and this runbook retires) |
| **Source** | Reviewers mr72-73 M1 fix "(now) add a pauser rotation runbook (6 + 7 signed by the pauser → new key) and an offline backup"; Reviewers !78 R-1 (offline keygen), R-2 (no-pauser window), R-3 (attacker race) |

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
- **R-1: never run `solana-keygen new`, `solana-keygen recover`, `age` / `gpg` or any seed-phrase step on the ops box or
  in an agent session.** The box is operated through agent shells whose output is logged, and `solana-keygen new`
  prints the 12-word seed phrase to stdout. Key generation and backup happen **only on the operator's offline
  machine**; the box receives the JSON key file and nothing else.

Environment used below (all paths, nothing secret in the shell history):

```
export RPC=<devnet RPC> KEYS_DIR=<keys dir> STATE=<staging state json>
export OLD_PAUSER_KEY=$KEYS_DIR/pauser.json NEW_PAUSER_KEY=$KEYS_DIR/pauser-next.json
export AUTO=<checkout>/apps/automation          # after: npm ci && npm run build
export PAUSER_MUST_DIFFER_FROM=<upgrade pubkey>,<keeper pubkey>,<settler pubkey>
```

## 1. Key generation and offline backup (operator's offline machine only)

Everything in this section runs **on the offline machine** (air-gapped laptop with the Solana CLI), never on the ops box
and never in an agent session (R-1). Only step 6 touches the box, and it moves the JSON key file alone.

1. On the offline machine, generate the key **with a BIP39 seed phrase** (not `--no-bip39-passphrase`):
   `solana-keygen new -o pauser-next.json` → note the pubkey; `chmod 600 pauser-next.json`. The seed phrase is shown
   on this offline screen only.
2. On the offline machine: write the seed phrase (and the optional BIP39 passphrase, stored separately) on paper. Keep
   **two copies in two physically separate places** (e.g. a safe and a bank box). No photos, no cloud notes.
3. On the offline machine: encrypted copy `age -p -o pauser-<pubkey8>.json.age pauser-next.json` (or `gpg -c`) onto
   **two offline USB drives**; the passphrase lives with the paper copy, not with the drive.
4. On the offline machine: verify the phrase: `solana-keygen recover -o /tmp/check.json`, then
   `solana-keygen pubkey /tmp/check.json` must equal the new pubkey; `shred -u /tmp/check.json`.
5. Record the pubkey, date and backup locations (not the phrase) in the ops log.
6. Copy **only the JSON key file** to the box, by the operator (not pasted into chat or an agent prompt):
   `scp pauser-next.json <box>:"$NEW_PAUSER_KEY"`, then on the box `chmod 600 "$NEW_PAUSER_KEY"` (dir `700`). On the
   box, check only the pubkey: `solana-keygen pubkey "$NEW_PAUSER_KEY"` must equal the one from step 1. Never `cat` it.
7. Update `EXPECTED_PAUSER_PUB` in `staging.env` to the new pubkey **at the switch in §2 step 5** (not before): the
   handoff and the pause watcher abort when `$PAUSER_KEY`'s pubkey differs from the pin (!77 L-3).

## 2. Planned rotation (old pauser → new pauser)

PSM `NameSuccessor` (6, signed by the **current** SM authority) + `ClaimSeatManagerAuthority` (7, signed by the
**new** key) in **one** transaction per book: the successor is a named pubkey and only it can claim, so there is no
front-run window. `ops-cli handoff` does exactly this with the current authority = the old pauser.

0. **Pick the time (R-2: the no-pauser window).** Between step 3 (handoff) and step 5 (switching the online copies)
   the books are on the new key, but the running watchers (Railway worker, box `pause-watch`) still hold the old one,
   so **no online pauser can pause**. Rotate only when **no book expires within the next ~1 h**
   (`pause-status --state "$STATE"` lists expiries), or start a `pause-watch` with the new key right after step 3:
   `cd "$AUTO" && SOLANA_RPC_URL=$RPC PHOENIX_PAUSER_KEYPAIR=$NEW_PAUSER_KEY PAUSER_MUST_DIFFER_FROM=$PAUSER_MUST_DIFFER_FROM nohup node dist/ops-cli.js pause-watch --state "$STATE" --memory none >>"$STATE.rotate-pause.log" 2>&1 &`
   (stop it once step 5 is done).
1. New key + offline backup (§1, offline machine; only the JSON reaches the box). Fund it with ~0.02 SOL. The old
   pauser pays the handoff fees (keep ~0.01 SOL on it).
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
     "$KEYS_DIR/.pauser.json.new" "$KEYS_DIR/pauser.json"`; set `EXPECTED_PAUSER_PUB=<NEW pubkey>` in `staging.env`;
     restart the staging watcher / `ops-cli pause-watch`; stop the temporary step-0 watcher if you started one.
6. Re-run the step-4 check, then retire the old key: `shred -u` the old hot copy once the new one is live. Its offline
   backup can be destroyed after one clean expiry cycle.
7. Log the rotation (pubkeys only) in TRACKER and AI_LOG.

## 3. Emergency rotation (suspected leak)

Same as §2 but immediately, books **nearest expiry / already expired first** (those are what an attacker would unpause).
Skip the step-0 timing (there is no safe time), but do start the new-key watcher right after the handoff.

**R-3: the attacker can race the rotation.** Whoever holds the leaked key can send their own atomic PSM 6 + 7 to a key
they control, for any book, before our handoff lands; PSM accepts whichever lands first. Rotation is a race we can
lose per book. After the emergency handoff, any book that reports `[pause] ALERT handoff skip … neither the given
current key nor the pauser` (SM authority is a key we don't hold) is **lost**: ops can never pause, close or evict it
again. Treat it like §4 / a book that left PSM: tell users on that market to **cancel and withdraw** (still possible),
stop routing the UI to it, and record its pubkey in TRACKER. Only M1 (PDA authority) removes this race.

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
