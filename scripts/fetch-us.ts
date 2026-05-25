/**
 * Fetch all US-listed stocks + ETFs from NASDAQ Trader public symbol directory.
 *
 * Output: data/us-stocks.json
 *
 * No auth required. https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const NASDAQ_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const OTHER_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';

type USStock = {
  ticker: string;
  name: string;
  market: 'NASDAQ' | 'NYSE';
  isEtf: boolean;
};

async function fetchPipeText(url: string): Promise<string[][]> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const text = await res.text();
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('File Creation Time'));
  return lines.map((l) => l.split('|'));
}

function cleanName(raw: string): string {
  // 흔한 suffix 정리
  return raw
    .replace(/\s*-\s*Common Stock\s*$/i, '')
    .replace(/\s+Common Stock\s*$/i, '')
    .replace(/\s+Class\s+[A-Z]\s+(Ordinary|Common)?\s*Shares?\s*$/i, '')
    .replace(/\s+Ordinary Shares?\s*$/i, '')
    .replace(/\s+ETF Trust\s*$/i, ' ETF')
    .trim();
}

function parseNasdaq(rows: string[][]): USStock[] {
  // Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
  const out: USStock[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 8) continue;
    const ticker = r[0]?.trim();
    const name = r[1]?.trim();
    const testIssue = r[3]?.trim();
    const etf = r[6]?.trim();
    if (!ticker || !name) continue;
    if (testIssue === 'Y') continue;
    out.push({
      ticker,
      name: cleanName(name),
      market: 'NASDAQ',
      isEtf: etf === 'Y',
    });
  }
  return out;
}

function parseOther(rows: string[][]): USStock[] {
  // ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
  const out: USStock[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 7) continue;
    const ticker = r[0]?.trim();
    const name = r[1]?.trim();
    const etf = r[4]?.trim();
    const testIssue = r[6]?.trim();
    if (!ticker || !name) continue;
    if (testIssue === 'Y') continue;
    // NYSE 또는 AMEX/ARCA 등 — 우리 앱은 NASDAQ/NYSE만 다루니 통일
    out.push({
      ticker,
      name: cleanName(name),
      market: 'NYSE',
      isEtf: etf === 'Y',
    });
  }
  return out;
}

function dedup(items: USStock[]): USStock[] {
  const seen = new Set<string>();
  const out: USStock[] = [];
  for (const it of items) {
    if (seen.has(it.ticker)) continue;
    seen.add(it.ticker);
    out.push(it);
  }
  return out;
}

async function main() {
  console.log('NASDAQ Trader 받아오는 중…');
  const [nasdaqRows, otherRows] = await Promise.all([
    fetchPipeText(NASDAQ_URL),
    fetchPipeText(OTHER_URL),
  ]);
  console.log(`✓ nasdaqlisted: ${nasdaqRows.length - 1}행 (헤더 제외)`);
  console.log(`✓ otherlisted: ${otherRows.length - 1}행`);

  const nasdaq = parseNasdaq(nasdaqRows);
  const other = parseOther(otherRows);
  const all = dedup([...nasdaq, ...other]);

  const stats = all.reduce<{ stock: number; etf: number; nasdaq: number; nyse: number }>(
    (acc, s) => {
      if (s.isEtf) acc.etf += 1;
      else acc.stock += 1;
      if (s.market === 'NASDAQ') acc.nasdaq += 1;
      else acc.nyse += 1;
      return acc;
    },
    { stock: 0, etf: 0, nasdaq: 0, nyse: 0 }
  );
  console.log('통합:', stats, `총 ${all.length}건`);

  const outDir = resolve(process.cwd(), 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'us-stocks.json');
  writeFileSync(
    outPath,
    JSON.stringify(
      { fetchedAt: new Date().toISOString(), count: all.length, stocks: all },
      null,
      2
    )
  );
  console.log(`완료 → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
