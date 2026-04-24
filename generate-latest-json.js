const fs = require("fs");
const path = require("path");

const { chromium } = require("playwright");

const TARGET_URL = "https://adurite.com/";

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

async function scrapeOnce(page) {
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

          return { title, rap, price, rapPriceText, idx, occurrence: n, verified: false };
        })
        .filter((v) => v && v.title);
    },
    { titleSel: TITLE_SELECTOR, rapPriceSel: RAP_PRICE_SELECTOR }
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

  const items = await scrapeOnce(page);

  await browser.close();

  const payload = { generatedAt: new Date().toISOString(), items };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");

  process.stdout.write(`Wrote ${items.length} items to ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exit(1);
});

