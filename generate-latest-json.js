const fs = require("fs");
const path = require("path");

const { chromium } = require("playwright");

const TARGET_URL = "https://adurite.com/";

const SEARCH_SELECTOR =
  ".input_input__JVjrL.market_search__AqW_5, [class*=\"market_search__\"][class*=\"input_input__\"], [class*=\"market_search__\"] input, input[placeholder*=\"Search\" i]";

const CARD_SELECTOR =
  ".card_root__U6W9B.card_robloxCard__2ogeP, [class*=\"card_root__\"][class*=\"card_robloxCard__\"]";
const TITLE_SELECTOR =
  ".text_text__6Ucz4.text_size16__lZN8U.text_w700__f9Szj.card_infoTitle__7Slao.card_infoTitleRoblox__auvpo, [class*=\"card_infoTitle__\"][class*=\"card_infoTitleRoblox__\"], [class*=\"card_infoTitle__\"]";
const RAP_PRICE_SELECTOR =
  ".text_text__6Ucz4.text_size16__lZN8U.card_rowPrice__6weCk, [class*=\"card_rowPrice__\"][class*=\"text_size16__\"], [class*=\"card_rowPrice__\"]";

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function parsePriceValue(text) {
  const s = String(text || "");
  const m = s.match(/([$€£])\s*([\d,]+(?:\.\d{1,2})?)/);
  const raw = m ? m[2] : s;
  const n = Number(String(raw).replace(/,/g, "").match(/[\d.]+/)?.[0] || NaN);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

async function autoScrollUntilStable(page, { stableRounds = 3, maxRounds = 40 } = {}) {
  let lastCount = 0;
  let stable = 0;
  for (let round = 0; round < maxRounds; round++) {
    const count = await page.locator(CARD_SELECTOR).count().catch(() => 0);
    if (count === lastCount) stable++;
    else stable = 0;
    if (stable >= stableRounds) return;
    lastCount = count;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
  }
}

async function scrapeOnce(page, { query } = {}) {
  const q = clean(query || "");
  if (q) {
    const search = page.locator(SEARCH_SELECTOR).first();
    await search.waitFor({ state: "visible", timeout: 45000 });
    await search.fill("");
    await search.fill(q);
    await page.waitForTimeout(1200);
  }

  // load more cards (site often lazy-loads)
  await autoScrollUntilStable(page, {
    stableRounds: Number(process.env.SCROLL_STABLE_ROUNDS || 3),
    maxRounds: Number(process.env.SCROLL_MAX_ROUNDS || 80)
  });

  const items = await page.$$eval(
    CARD_SELECTOR,
    (cards, selectors) => {
      const clean2 = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const parseRapPrice = (s) => {
        const txt = clean2(s);
        const m = txt.match(/RAP\s*([^\sP]+.*?)\s*Price\s*([$€£]?\s*[\d,]+(?:\.\d{1,2})?)/i);
        if (m) return { rap: clean2(m[1]), price: clean2(m[2]) };
        const m2 = txt.match(/RAP\s*([^\sP]+.*)/i);
        return { rap: m2 ? clean2(m2[1]) : "", price: "" };
      };

      const occ = new Map();
      return cards
        .map((card, idx) => {
          const titleEl = card.querySelector(selectors.titleSel);
          const title = clean2(titleEl?.textContent || "");
          const rapPriceEl = card.querySelector(selectors.rapPriceSel);
          const { rap, price } = parseRapPrice(rapPriceEl?.textContent || "");
          const rapPriceText = clean2(rapPriceEl?.textContent || "");

          const occKey = `${title.toLowerCase()}||${rapPriceText}`;
          const n = (occ.get(occKey) || 0);
          occ.set(occKey, n + 1);

          return {
            title,
            rap,
            price,
            rapPriceText,
            idx,
            occurrence: n,
            verified: false,
            query: selectors.query || ""
          };
        })
        .filter((v) => v && v.title);
    },
    { titleSel: TITLE_SELECTOR, rapPriceSel: RAP_PRICE_SELECTOR, query: q }
  );

  items.sort((a, b) => {
    const av = parsePriceValue(a.price || a.rapPriceText);
    const bv = parsePriceValue(b.price || b.rapPriceText);
    if (bv !== av) return bv - av;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });

  return items;
}

async function main() {
  const outPath = path.resolve(process.env.OUT_PATH || path.join("web", "latest.json"));
  const headful = String(process.env.HEADFUL || "") === "1";

  const browser = await chromium.launch({ headless: !headful });
  const page = await browser.newPage();
  page.setDefaultTimeout(Number(process.env.TIMEOUT_MS || 45000));

  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // Full snapshot: scrape without filtering query.
  // The website UI will filter locally for whatever the user searches.
  const all = await scrapeOnce(page);

  await browser.close();

  const payload = { generatedAt: new Date().toISOString(), items: all };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");

  process.stdout.write(`Wrote ${all.length} items to ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exit(1);
});

