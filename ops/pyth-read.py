#!/usr/bin/env python3
"""Read the last published Pyth price for the Mag-7 sponsored feed accounts (shard-0 PriceUpdateV2 PDAs).
Usage: python3 pyth-read.py <rpc-url>     (or PYTH_PRICE_RPC env). Prints one line per feed, then a JSON map
{symbol: price}. Used by run-staging.sh as the admin_settle fallback price when the Hermes pull settle can't land.
No keys, no Hermes (public account read only)."""
import os
import sys,json,base64,struct,time,urllib.request
RPC=sys.argv[1] if len(sys.argv) > 1 else os.environ["PYTH_PRICE_RPC"]
F={"AAPL":"DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy","MSFT":"7VYuuJxz8w2rLA9tJG2KZ9T1fSMcjC7uECoYA6nDaqtK","GOOGL":"HShKFQqhYkUiXpVyyLmrAALXwWqHB7ikLmPbrwJzpRNh","AMZN":"GBkjjFxbaFY9TBHpAPypk5JBchpPPve2jskAcd9zuFNd","META":"GsKrMNoa1Mqjpif4SYk2WjdduWZP699hXRdP51yBM6K2","NVDA":"2w1Tg1XTZbUib7srfRoStJ4v5JXVsK7roQEGMsMaGZFC","TSLA":"E8WFH8brgP58arcuW2wwsPHiomYrSvrgWTsRLZLAEZUQ"}
req=urllib.request.Request(RPC,data=json.dumps({"jsonrpc":"2.0","id":1,"method":"getMultipleAccounts","params":[list(F.values()),{"encoding":"base64"}]}).encode(),headers={"content-type":"application/json"})
r=json.load(urllib.request.urlopen(req,timeout=20))["result"]
out={}
for (s,pk),v in zip(F.items(),r["value"]):
  if not v: print(s,"MISSING"); continue
  b=base64.b64decode(v["data"][0]); off=40; vl=b[off]; off+= 2 if vl==0 else 1
  off+=32; price,conf,expo,pt=struct.unpack_from("<qQiq",b,off)
  out[s]=price*10**expo
  print(s, round(price*10**expo,2), "conf", round(conf*10**expo,3), "age_h", round((time.time()-pt)/3600,1))
print(json.dumps(out))
