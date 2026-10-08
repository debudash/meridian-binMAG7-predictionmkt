#!/usr/bin/env python3
"""Read the last published Pyth price of the Mag-7 sponsored feed accounts (shard-0 PriceUpdateV2 PDAs).

Usage: python3 pyth-read.py <rpc-url> [--max-age-secs N]   (or PYTH_PRICE_RPC env; default N = 900)

INFORMATIONAL ONLY — never a settle price (Reviewers mr72-73 M3). The shard-0 accounts are weeks stale; the
admin_settle fallback comes from `ops-cli admin-price` (Hermes price at expiry, or an operator price with its
source). Age guard: feeds older than N seconds are printed as STALE and left out of the JSON map; exit code 2 if
any feed is stale or missing. No keys, no Hermes (public account read only)."""
import os, sys, json, base64, struct, time, urllib.request

F = {"AAPL": "DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy", "MSFT": "7VYuuJxz8w2rLA9tJG2KZ9T1fSMcjC7uECoYA6nDaqtK",
     "GOOGL": "HShKFQqhYkUiXpVyyLmrAALXwWqHB7ikLmPbrwJzpRNh", "AMZN": "GBkjjFxbaFY9TBHpAPypk5JBchpPPve2jskAcd9zuFNd",
     "META": "GsKrMNoa1Mqjpif4SYk2WjdduWZP699hXRdP51yBM6K2", "NVDA": "2w1Tg1XTZbUib7srfRoStJ4v5JXVsK7roQEGMsMaGZFC",
     "TSLA": "E8WFH8brgP58arcuW2wwsPHiomYrSvrgWTsRLZLAEZUQ"}


def age_ok(publish_time, now, max_age_secs):
    """True only if the price was published within max_age_secs of now."""
    return 0 <= now - publish_time <= max_age_secs


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    max_age = int(argv[argv.index("--max-age-secs") + 1]) if "--max-age-secs" in argv else 900
    if "--max-age-secs" in argv:
        args.remove(str(max_age))
    rpc = args[0] if args else os.environ["PYTH_PRICE_RPC"]
    req = urllib.request.Request(rpc, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "getMultipleAccounts",
                                 "params": [list(F.values()), {"encoding": "base64"}]}).encode(),
                                 headers={"content-type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=20))["result"]
    out, bad, now = {}, 0, time.time()
    for (s, _pk), v in zip(F.items(), r["value"]):
        if not v:
            print(s, "MISSING"); bad += 1; continue
        b = base64.b64decode(v["data"][0]); off = 40; vl = b[off]; off += 2 if vl == 0 else 1
        off += 32; price, conf, expo, pt = struct.unpack_from("<qQiq", b, off)
        fresh = age_ok(pt, now, max_age)
        print(s, round(price * 10 ** expo, 2), "conf", round(conf * 10 ** expo, 3), "age_h", round((now - pt) / 3600, 1),
              "" if fresh else f"STALE (> {max_age}s) — not usable")
        if fresh:
            out[s] = price * 10 ** expo
        else:
            bad += 1
    print(json.dumps(out))
    return 2 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
