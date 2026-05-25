/**
 * Fetch full KOSPI/KOSDAQ stocks + ETF + ETN + 시장 지수 from data.go.kr.
 *
 * Output: data/krx-stocks.json
 *
 * Env:
 *   KRX_API_KEY  — Decoded service key (활용 신청된 API 4종에 공통 사용)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const STOCK_URL =
  'https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo';
const ETF_URL =
  'https://apis.data.go.kr/1160100/service/GetSecuritiesProductInfoService/getETFPriceInfo';
const ETN_URL =
  'https://apis.data.go.kr/1160100/service/GetSecuritiesProductInfoService/getETNPriceInfo';
const INDEX_URL =
  'https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService/getStockMarketIndex';

type ApiResponse = {
  response: {
    header: { resultCode: string; resultMsg: string };
    body: {
      numOfRows: number;
      pageNo: number;
      totalCount: number;
      items?: { item?: unknown };
    };
  };
};

type Kind = 'stock' | 'etf' | 'etn' | 'index';

type NormalizedItem = {
  ticker: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'INDEX';
  kind: Kind;
};

const apiKey = process.env.KRX_API_KEY;
if (!apiKey) {
  console.error('환경변수 KRX_API_KEY 가 필요합니다.');
  process.exit(1);
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchPage(url: string, basDt: string, pageNo: number, numOfRows: number) {
  const full =
    `${url}?serviceKey=${encodeURIComponent(apiKey!)}` +
    `&numOfRows=${numOfRows}&pageNo=${pageNo}&resultType=json&basDt=${basDt}`;
  const res = await fetch(full);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  let data: ApiResponse;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`JSON 파싱 실패: ${text.slice(0, 200)}`);
  }
  if (data.response?.header?.resultCode !== '00') {
    throw new Error(
      `API ${data.response?.header?.resultCode}: ${data.response?.header?.resultMsg}`
    );
  }
  const raw = data.response.body?.items?.item;
  if (!raw) return [] as Record<string, unknown>[];
  const list = Array.isArray(raw) ? raw : [raw];
  return list as Record<string, unknown>[];
}

async function fetchAll(url: string, basDt: string) {
  const numOfRows = 1000;
  const all: Record<string, unknown>[] = [];
  let page = 1;
  while (page <= 20) {
    const next = await fetchPage(url, basDt, page, numOfRows);
    if (next.length === 0) break;
    all.push(...next);
    if (next.length < numOfRows) break;
    page += 1;
  }
  return all;
}

async function findLatestTradingDate(): Promise<string> {
  for (let i = 1; i <= 10; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const basDt = fmtDate(d);
    const items = await fetchPage(STOCK_URL, basDt, 1, 10).catch(() => []);
    if (items.length > 0) return basDt;
  }
  throw new Error('최근 10일 안에 거래일 없음');
}

function normalizeStock(r: Record<string, unknown>): NormalizedItem | null {
  const ticker = String(r.srtnCd ?? '').padStart(6, '0');
  const name = String(r.itmsNm ?? '').trim();
  const m = String(r.mrktCtg ?? '').toUpperCase();
  if (!ticker || !name) return null;
  if (m !== 'KOSPI' && m !== 'KOSDAQ' && m !== 'KONEX') return null;
  return { ticker, name, market: m as 'KOSPI' | 'KOSDAQ' | 'KONEX', kind: 'stock' };
}

function normalizeProduct(kind: 'etf' | 'etn') {
  return (r: Record<string, unknown>): NormalizedItem | null => {
    const ticker = String(r.srtnCd ?? '').padStart(6, '0');
    const name = String(r.itmsNm ?? '').trim();
    if (!ticker || !name) return null;
    // ETF/ETN은 시장 구분 필드가 없거나 다를 수 있음 — 일단 KOSPI로 통일 (한국 ETF는 KOSPI 상장이 표준)
    return { ticker, name, market: 'KOSPI', kind };
  };
}

function normalizeIndex(r: Record<string, unknown>): NormalizedItem | null {
  // 지수는 ticker 대신 지수명/지수클래스 필드. 응답 키를 추측해서 처리.
  const code =
    (r.idxCsf as string | undefined) ??
    (r.idxNm as string | undefined) ??
    (r.basPntm as string | undefined) ??
    '';
  const name = String(r.idxNm ?? r.idxCsf ?? '').trim();
  if (!name) return null;
  // 지수는 종목코드가 없으니 이름을 안정적인 식별자로 사용 (또는 idxNm 직접)
  const ticker = `IDX:${name}`;
  return { ticker, name, market: 'INDEX', kind: 'index' };
}

function dedup(items: NormalizedItem[]): NormalizedItem[] {
  const seen = new Set<string>();
  const out: NormalizedItem[] = [];
  for (const it of items) {
    if (seen.has(it.ticker)) continue;
    seen.add(it.ticker);
    out.push(it);
  }
  return out;
}

async function tryFetch(label: string, fn: () => Promise<NormalizedItem[]>) {
  try {
    const items = await fn();
    console.log(`✓ ${label}: ${items.length}건`);
    return items;
  } catch (e) {
    console.error(`✗ ${label} 실패: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

async function main() {
  console.log('KRX 데이터 가져오는 중…');
  const basDt = await findLatestTradingDate();
  console.log(`기준일자: ${basDt}`);

  const stocks = await tryFetch('주식', async () =>
    (await fetchAll(STOCK_URL, basDt)).map(normalizeStock).filter((x): x is NormalizedItem => !!x)
  );
  const etfs = await tryFetch('ETF', async () =>
    (await fetchAll(ETF_URL, basDt)).map(normalizeProduct('etf')).filter((x): x is NormalizedItem => !!x)
  );
  const etns = await tryFetch('ETN', async () =>
    (await fetchAll(ETN_URL, basDt)).map(normalizeProduct('etn')).filter((x): x is NormalizedItem => !!x)
  );
  const indices = await tryFetch('지수', async () =>
    (await fetchAll(INDEX_URL, basDt)).map(normalizeIndex).filter((x): x is NormalizedItem => !!x)
  );

  const all = dedup([...stocks, ...etfs, ...etns, ...indices]);
  const byKind = all.reduce<Record<string, number>>((acc, x) => {
    acc[x.kind] = (acc[x.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log('통합:', byKind, `총 ${all.length}건`);

  const outDir = resolve(process.cwd(), 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'krx-stocks.json');
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        basDt,
        fetchedAt: new Date().toISOString(),
        count: all.length,
        stocks: all,
      },
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
