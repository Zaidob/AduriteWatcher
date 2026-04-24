const fs = require("fs");
const path = require("path");

const { chromium } = require("playwright");

const TARGET_URL = "https://adurite.com/";

const SEARCH_SELECTOR =
  ".input_input__JVjrL.market_search__AqW_5, [class*=\"market_search__\"][class*=\"input_input__\"], [class*=\"market_search__\"] input, input[placeholder*=\"Search\" i]";

const MINIMIZED_VIEW_SWITCH_SELECTOR =
  ".input_input__JVjrL.switcher_root__EjaK8, [class*=\"switcher_root__\"][class*=\"input_input__\"], [class*=\"switcher_root__\"]";

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

async function clickConsentIfPresent(page) {
  const locators = [
    page.getByRole("button", { name: /^i\s*agree$/i }).first(),
    page.getByText(/^i\s*agree$/i, { exact: true }).first(),
    page.locator("button:has-text(\"I Agree\"), button:has-text(\"I agree\")").first(),
    page.locator(":is(button,div,span,a)[role=\"button\"]:has-text(\"I Agree\")").first(),
    page.locator(":is(button,div,span,a):has-text(\"I Agree\")").first()
  ];

  for (const loc of locators) {
    try {
      if (await loc.isVisible({ timeout: 1200 })) {
        await loc.click({ timeout: 5000, force: true });
        await page.waitForTimeout(600);
        return true;
      }
    } catch {
      // ignore
    }
  }

  // Last-resort DOM click (some consent modals aren't semantic)
  try {
    const clicked = await page.evaluate(() => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
      const els = Array.from(document.querySelectorAll("button, [role='button'], a, div, span"));
      const target = els.find((el) => norm(el.textContent) === "i agree");
      if (!target) return false;
      target.click();
      return true;
    });
    if (clicked) {
      await page.waitForTimeout(600);
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

async function disableMinimizedViewIfEnabled(page) {
  const tryToggleOff = async (switchLike) => {
    try {
      if (!(await switchLike.isVisible({ timeout: 1500 }))) return false;
    } catch {
      return false;
    }

    try {
      const checked = await switchLike.getAttribute("aria-checked");
      if (String(checked).toLowerCase() === "true") {
        await switchLike.click({ timeout: 5000, force: true });
        await page.waitForTimeout(500);
        return true;
      }
      if (String(checked).toLowerCase() === "false") return true;
    } catch {
      // ignore
    }

    const cb = switchLike.locator("input[type=\"checkbox\"]").first();
    try {
      if (await cb.count()) {
        const enabled = await cb.isChecked().catch(() => false);
        if (enabled) {
          await switchLike.click({ timeout: 5000, force: true });
          await page.waitForTimeout(500);
        }
        return true;
      }
    } catch {
      // ignore
    }

    await switchLike.click({ timeout: 5000, force: true });
    await page.waitForTimeout(500);
    return true;
  };

  try {
    const byRole = page.getByRole("switch", { name: /minimized view/i }).first();
    if (await tryToggleOff(byRole)) return;
  } catch {
    // ignore
  }

  try {
    const label = page.getByText(/minimized view/i).first();
    if (await label.isVisible({ timeout: 1500 })) {
      const container = label
        .locator("xpath=ancestor-or-self::*[1] | xpath=ancestor::*[2] | xpath=ancestor::*[3]")
        .first();
      const near = container.locator(MINIMIZED_VIEW_SWITCH_SELECTOR).first();
      if (await tryToggleOff(near)) return;
    }
  } catch {
    // ignore
  }

  const root = page.locator(MINIMIZED_VIEW_SWITCH_SELECTOR).first();
  await tryToggleOff(root);
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

  // If we still got nothing, one more consent/minimized-view attempt and retry scroll.
  const initialCount = await page.locator(CARD_SELECTOR).count().catch(() => 0);
  if (!initialCount) {
    await clickConsentIfPresent(page);
    await disableMinimizedViewIfEnabled(page);
    await page.waitForTimeout(900);
    await autoScrollUntilStable(page, {
      stableRounds: Number(process.env.SCROLL_STABLE_ROUNDS || 3),
      maxRounds: Number(process.env.SCROLL_MAX_ROUNDS || 80)
    });
  }

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
  await clickConsentIfPresent(page);
  await disableMinimizedViewIfEnabled(page);
  await page.waitForTimeout(800);

  // Full snapshot: scrape without filtering query.
  // The website UI will filter locally for whatever the user searches.
  const all = await scrapeOnce(page);

  await browser.close();

  if (!all.length) {
    throw new Error("Scrape returned 0 items. Site may be blocking the runner, or selectors need updating.");
  }

  const payload = { generatedAt: new Date().toISOString(), items: all };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");

  process.stdout.write(`Wrote ${all.length} items to ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exit(1);
});

