# shottachigo-data

[샀다치고](https://github.com/johyunmin/shottachigo) 앱이 사용하는 한국 종목 마스터 데이터.

## 데이터 소스

[공공데이터포털 — 금융위원회_주식시세정보](https://www.data.go.kr/data/15094808/openapi.do) API에서 일별로 받아 가공.

## 갱신 주기

매일 한국 시각 03:30 (UTC 18:30) GitHub Actions cron으로 자동 갱신.

## 파일

- `data/krx-stocks.json` — 종목 마스터 (티커, 한글명, 시장)

## 앱에서 사용

```ts
const url = 'https://raw.githubusercontent.com/johyunmin/shottachigo-data/main/data/krx-stocks.json';
const stocks = await fetch(url).then((r) => r.json());
```

## 로컬 테스트

```bash
export KRX_API_KEY='your_decoded_service_key'
npm install
npm run fetch
```
