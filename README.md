# BTC × 맘카페 시그널 데스크

맘카페의 “비트코인” 주간 언급량과 BTC-USD 가격을 함께 탐색하는 정적 데이터 대시보드입니다.

## 현재 구조

- Next.js 16 App Router + React 19 + TypeScript 6
- Tailwind CSS 4 + Recharts 3 + Lucide
- Python 3.13 증분 수집기 + 시계열 검정 (`requests`, `statsmodels`)
- GitHub Actions 검증·수집·GitHub Pages 배포
- KST 월요일 시작 주간 집계

## 데이터 안전 원칙

`scrape.py`는 `public/data.json`을 기준점으로 사용합니다.

1. 기존 파일에 OHLCV가 없을 때만 Coinbase Exchange 일봉을 구간별로 한 번 보강합니다.
2. 보강 시에도 기존 과거 `btcClose`·`btcMean`은 덮어쓰지 않고 OHLCV 결측만 채웁니다.
3. 보강 후에는 Coinbase Exchange의 최근 28일만 직접 조회하고 최근 2주만 가격을 갱신합니다.
4. 카페 글은 기본적으로 현재 주와 직전 주만 조회합니다. 검증된 일회성 전체 재수집은 `--backfill-posts`를 명시해야 합니다.
5. 가격 응답이 비었거나 최신 날짜·주간 범위를 충족하지 못하면 파일을 쓰지 않습니다.
6. 카페 소스 일부가 실패하면 기존 언급량을 보존하고 `collection.posts.status=degraded`로 표시합니다.
7. 새 스냅샷은 임시 파일에 완전히 쓴 뒤 원자적으로 교체합니다.

## 분석 지표

- 이전 52주 중앙값·MAD 기반 관심도 서프라이즈와 4주 언급량 모멘텀
- OHLCV, 실현변동성, 고저 변동폭, 거래량 변화
- Pearson·Spearman, ±8주 선행·후행 히트맵, 52주 롤링 상관
- +2σ 관심 급증 이벤트의 1·2·4·8주 수익률, 상승률, MFE·MAE, 이동 블록 부트스트랩 구간
- 26주 추세·52주 변동성 체제별 결과
- 정상화 변화율의 양방향 Granger 1–4주 검정과 Benjamini–Hochberg FDR 보정
- 매 시점 이전 자료만 쓰는 확장형 워크포워드 OOS R²·방향 적중률

## 로컬 실행

```powershell
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python scrape.py
# 과거 언급량을 의도적으로 전수 재수집할 때만 사용
python scrape.py --backfill-posts

npm install
npm run dev
```

전체 검증:

```powershell
npm run check
```

## 배포

저장소의 **Settings → Pages → Build and deployment → Source**를 `GitHub Actions`로 한 번 변경해야 합니다. 이후:

- 소스 push: `.github/workflows/deploy.yml`
- 매일 03:15 UTC 증분 갱신: `.github/workflows/scrape.yml`

두 워크플로 모두 린트, 프런트 테스트, TypeScript 빌드를 통과한 정적 출력만 배포합니다.

## 데이터 해석

- 진행 중인 주의 BTC 값은 주간 확정 종가가 아니라 최신 관측 종가입니다.
- 기존 `btcClose`는 보존하며, OHLC 이벤트 분석은 원천 일관성을 위해 별도 `btcExchangeClose`를 사용합니다.
- 산점도는 언급량 `t`와 이후 `t+h` 주 수익률을 비교해 미래참조를 피합니다.
- 결측 가격은 보간하지 않습니다.
- 상관관계는 인과관계를 의미하지 않습니다.
- 과거 게시글 원문과 카페별 시계열이 없어 감성·주제·확산도·집중도는 추정하지 않습니다.
