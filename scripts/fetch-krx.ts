/**
 * Fetch full KOSPI / KOSDAQ / KONEX listing from data.go.kr
 * (금융위원회_주식시세정보 — getStockPriceInfo)
 *
 * Output: data/krx-stocks.json
 *
 * Env:
 *   KRX_API_KEY  — Decoded service key from data.go.kr
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ENDPOINT =
  'https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo';

type RawItem = {
  basDt: string;        // 기준일자 YYYYMMDD
  srtnCd: string;       // 단축코드 (6자리)
  isinCd: string;       // ISIN
  itmsNm: string;       // 한글 종목명
  mrktCtg: string;      // KOSPI / KOSDAQ / KONEX
  clpr?: string;        // 종가
};

type Body = {
  numOfRows: number;
  pageNo: number;
  totalCount: number;
  items?: { item?: RawItem[] | RawItem };
};

type ApiResponse = {
  response: {
    header: { resultCode: string; resultMsg: string };
    body: Body;
  };
};

type Stock = {
  ticker: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ' | 'KONEX';
};

const apiKey = process.env.KRX_API_KEY;
if (!apiKey) {
  console.error('환경변수 KRX_API_KEY 가 필요합니다.');
  process.exit(1);
}

function fmtDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// 가장 최근 거래일을 찾을 때까지 어제부터 거꾸로 시도 (최대 10일 = 연휴 안전)
async function findLatestTradingDate(): Promise<string> {
  for (let i = 1; i <= 10; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const basDt = fmtDate(d);
    const items = await fetchPage(basDt, 1, 10);
    if (items.length > 0) {
      console.log(`기준일자: ${basDt}`);
      return basDt;
    }
  }
  throw new Error('최근 10일 안에 거래일을 찾지 못했어요.');
}

async function fetchPage(basDt: string, pageNo: number, numOfRows: number): Promise<RawItem[]> {
  const url =
    `${ENDPOINT}?serviceKey=${encodeURIComponent(apiKey!)}` +
    `&numOfRows=${numOfRows}&pageNo=${pageNo}&resultType=json&basDt=${basDt}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on page ${pageNo}`);
  const text = await res.text();
  let data: ApiResponse;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`JSON 파싱 실패: ${text.slice(0, 200)}`);
  }
  if (data.response?.header?.resultCode !== '00') {
    throw new Error(
      `API 오류 ${data.response?.header?.resultCode}: ${data.response?.header?.resultMsg}`
    );
  }
  const raw = data.response.body?.items?.item;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

async function fetchAll(basDt: string): Promise<RawItem[]> {
  const numOfRows = 1000;
  const first = await fetchPage(basDt, 1, numOfRows);
  if (first.length === 0) return [];
  // 첫 페이지로 total 확인을 위해 다시 fetch (위 함수는 body만 줘서)
  // 실용적: 첫 페이지 < numOfRows면 끝. 같으면 계속 페이징.
  const all = [...first];
  let page = 2;
  while (true) {
    const next = await fetchPage(basDt, page, numOfRows);
    if (next.length === 0) break;
    all.push(...next);
    if (next.length < numOfRows) break;
    page += 1;
    if (page > 20) {
      console.warn('20 페이지 초과 — 안전을 위해 중단');
      break;
    }
  }
  return all;
}

function normalize(raw: RawItem[]): Stock[] {
  const seen = new Set<string>();
  const result: Stock[] = [];
  for (const r of raw) {
    const ticker = r.srtnCd?.padStart(6, '0');
    const name = r.itmsNm?.trim();
    const m = r.mrktCtg?.toUpperCase();
    if (!ticker || !name || !m) continue;
    if (m !== 'KOSPI' && m !== 'KOSDAQ' && m !== 'KONEX') continue;
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    result.push({ ticker, name, market: m });
  }
  // 시장별로 정렬: KOSPI → KOSDAQ → KONEX, 그 안에서 ticker 순
  const marketOrder: Record<Stock['market'], number> = { KOSPI: 0, KOSDAQ: 1, KONEX: 2 };
  result.sort(
    (a, b) =>
      marketOrder[a.market] - marketOrder[b.market] || a.ticker.localeCompare(b.ticker)
  );
  return result;
}

async function main() {
  console.log('KRX 데이터 가져오는 중…');
  const basDt = await findLatestTradingDate();
  const raw = await fetchAll(basDt);
  console.log(`원본 ${raw.length}건`);
  const stocks = normalize(raw);
  const byMarket = stocks.reduce<Record<string, number>>((acc, s) => {
    acc[s.market] = (acc[s.market] ?? 0) + 1;
    return acc;
  }, {});
  console.log('정규화 결과:', byMarket, `총 ${stocks.length}건`);

  const outDir = resolve(process.cwd(), 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'krx-stocks.json');
  const payload = {
    basDt,
    fetchedAt: new Date().toISOString(),
    count: stocks.length,
    stocks,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`완료 → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
