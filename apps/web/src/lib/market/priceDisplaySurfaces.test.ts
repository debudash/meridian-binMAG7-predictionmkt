/**
 * DLV-116 surfaces (node vitest, no DOM): every price control goes through lib/market/priceDisplay and
 * no surface prints an unlabeled mid. Acceptance: AMZN bid 0.41 / ask 0.43 → Buy Yes 0.43 / Buy No 0.59,
 * `42% implied`; ticket also Sell Yes 0.41 / Sell No 0.57.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buyButtonPrices, headerPills, ticketIntentPrices, marketPriceDisplay } from "./priceDisplay";

const src = (f: string) => readFileSync(path.join(__dirname, "../..", f), "utf8");
const AMZN = { yesBid: 0.41, yesAsk: 0.43, lastYes: 0.42, yesMid: 0.42, tickSize: 0.01, status: "open" as const };

describe("view models (AMZN acceptance)", () => {
  it("card / table / ladder buttons: Buy Yes 0.43, Buy No 0.59", () => {
    expect(buyButtonPrices(marketPriceDisplay(AMZN))).toEqual({
      yes: { price: "0.43", title: undefined },
      no: { price: "0.59", title: undefined },
      implied: "42% implied Yes",
    });
  });
  it("header pills: Buy Yes 0.43 / Buy No 0.59 + a separate implied label", () => {
    expect(headerPills(marketPriceDisplay(AMZN))).toEqual({
      yes: { label: "Buy Yes", price: "0.43", text: "Buy Yes 0.43", title: undefined },
      no: { label: "Buy No", price: "0.59", text: "Buy No 0.59", title: undefined },
      implied: "42% implied Yes",
    });
    expect(headerPills(marketPriceDisplay(AMZN, { open: false }))).toEqual({
      yes: { label: "Yes", price: null, text: "Yes", title: undefined },
      no: { label: "No", price: null, text: "No", title: undefined },
      implied: null,
    });
  });
  it("ticket 2×2: price under each label", () => {
    expect(ticketIntentPrices(marketPriceDisplay(AMZN))).toEqual({
      "buy-yes": { price: "0.43", title: undefined },
      "sell-yes": { price: "0.41", title: undefined },
      "buy-no": { price: "0.59", title: undefined },
      "sell-no": { price: "0.57", title: undefined },
    });
  });
});

describe("MarketCard", () => {
  const card = src("components/market/MarketCard.tsx");
  it("replaces the Yes · No mid row with NN% implied from the helper", () => {
    expect(card).toMatch(/marketPriceDisplay\(/);
    expect(card).toMatch(/impliedText\(/);
    expect(card).not.toMatch(/impliedLabel\(/);
    expect(card).not.toMatch(/market\.yesMid/);
    expect(card).not.toMatch(/noPriceFromYes/);
    expect(card).toMatch(/display\.open && \(/);
    expect(card).toMatch(/title=\{impliedTooltip\(display\)\}/);
  });
});

describe("Buy links (card, table, ladder)", () => {
  const links = src("components/market/MarketBuyLinks.tsx");
  it("show the executable price and the no-liquidity tooltip, keep blocked/disabled rules", () => {
    expect(links).toMatch(/buyButtonPrices\(/);
    expect(links).toMatch(/data-testid=\{`buy-\$\{side\}-price`\}/);
    expect(links).toMatch(/aria-disabled=\{!ok\}/);
    expect(links).toMatch(/className=\{`btn \$\{side === "yes" \? "btn-yes" : "btn-no"\}`\}/);
  });
});

describe("Markets table + ladder", () => {
  const mc = src("app/markets/MarketsClient.tsx");
  it("table keeps labeled bid/ask columns and adds an Implied column (header stays `Implied`)", () => {
    const thead = mc.slice(mc.indexOf("<th>Underlying</th>"), mc.indexOf("<th>Trade</th>"));
    expect(thead).toMatch(/<th>Yes bid\/ask<\/th>/);
    expect(thead).toMatch(/<th>No bid\/ask<\/th>/);
    expect(thead).toMatch(/<th>Implied<\/th>/);
  });
  it("ladder implied comes from the helper (no raw yesMid %)", () => {
    expect(mc).not.toMatch(/Math\.round\(m\.yesMid \* 100\)/);
    expect((mc.match(/impliedText\(marketPriceDisplay\(m/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("Trade header + book spread row", () => {
  const trade = src("app/markets/[marketId]/TradeClient.tsx");
  const book = src("components/trade/OrderBook.tsx");
  it("pills stay the perspective toggle but show Buy prices; no ?? 0.5 mid", () => {
    expect(trade).toMatch(/headerPills\(/);
    expect(trade).toMatch(/aria-pressed=\{perspective === "yes"\}/);
    expect(trade).toMatch(/aria-pressed=\{perspective === "no"\}/);
    expect(trade).not.toMatch(/market\.lastYes \?\? 0\.5/);
    expect(trade).not.toMatch(/liveMid/);
    expect(trade).toMatch(/data-testid="trade-implied"/);
    expect(trade).toMatch(/title=\{impliedTooltip\(priceView\)\}/);
  });
  it("no chart stub on the trade page (D-031: chart not in the SPEC); no doubled Yes", () => {
    expect(trade).not.toMatch(/Chart \(stub\)|TODO\(indexer\)/);
    expect(trade).not.toMatch(/Yes\{" "\}\s*\{impliedText\(priceView\)\}/);
  });
  it("trade header and spread row never print a bare mid", () => {
    expect(trade).not.toMatch(/Mid\{" "\}/);
    expect(book).not.toMatch(/· Mid \$\{/);
    expect(book).toMatch(/spreadText\(/);
  });
});

describe("Ticket 2×2", () => {
  const ticket = src("components/trade/TradeTicket.tsx");
  it("each intent button shows its executable price (selection/disabled rules unchanged)", () => {
    expect(ticket).toMatch(/ticketIntentPrices\(/);
    expect(ticket).toMatch(/data-testid=\{`intent-price-\$\{i\}`\}/);
    expect(ticket).toMatch(/className=\{`btn choice \$\{i\.includes\("yes"\) \? "btn-yes" : "btn-no"\}`\}/);
    expect(ticket).toMatch(/disabled=\{!enabled\}/);
    expect(ticket).toMatch(/aria-pressed=\{intent === i\}/);
  });
});
