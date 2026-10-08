# Meridian program key material

**Never commit secret key bytes.** This directory is gitignored except this README and `.gitkeep`.

## Current program id (pubkey only)

```
3X3ETGZYNcZ5BMMxcEuDhXxfisAmWzgqvdnhivbK91Hj
```

## Retired (lost — DLV-124, 2026-10-08)

```
9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6
```

Its keypair existed only on the old build box, which is gone. It was never deployed to devnet or mainnet. The current id
replaced it; the new keypair is kept outside the repo with an offline backup held by Debu.

## Revoked (compromised — was committed to git)

```
GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2
```

Treat `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2` as **revoked**. Anyone with historical repo access has that deploy/upgrade key. Redeploy with the new id above. Git history still contains the old secret until Debu runs `git filter-repo` / BFG + force-push scrub on `main` (MRs cannot rewrite history alone).

## Generate a local deploy keypair (do not commit)

```bash
solana-keygen new --no-bip39-passphrase -o keys/meridian-keypair.json
solana-keygen pubkey keys/meridian-keypair.json
# Must match declare_id! / Anchor.toml / IDL address / apps defaults
```

For CI/local Anchor builds, copy the matching keypair to `target/deploy/meridian-keypair.json` (also gitignored via `target/`).

Deployer / automation authority keys are separate Railway secrets (`AUTOMATION_KEYPAIR`) — never store them here in git.
