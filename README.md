# BTC × 맘카페 시그널 데스크

맘카페의 “비트코인” 주간 언급량과 BTC-USD 가격을 함께 탐색하는 정적 데이터 대시보드입니다.

## 현재 구조

- Next.js 16 App Router + React 19 + TypeScript 6
- Tailwind CSS 4 + Recharts 3 + Lucide
- Python 3.13 증분 수집기 (`requests`, `BeautifulSoup`만 사용)
- GitHub Actions 검증·수집·GitHub Pages 배포
- KST 월요일 시작 주간 집계

## 데이터 안전 원칙

`scrape.py`는 `public/data.json`을 기준점으로 사용합니다.

1. BTC-USD는 Coinbase Exchange의 최근 28일 일봉만 직접 조회합니다.
2. 카페 글은 현재 주와 직전 주만 조회합니다.
3. 그 이전의 정상 주간 값은 다시 내려받거나 덮어쓰지 않습니다.
4. 가격 응답이 비었거나 최신 날짜·주간 범위를 충족하지 못하면 파일을 쓰지 않습니다.
5. 카페 소스 일부가 실패하면 기존 언급량을 보존하고 `collection.posts.status=degraded`로 표시합니다.
6. 새 스냅샷은 임시 파일에 완전히 쓴 뒤 원자적으로 교체합니다.

## 로컬 실행

```powershell
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python scrape.py

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
- 산점도는 언급량 `t`와 이후 `t+h` 주 수익률을 비교해 미래참조를 피합니다.
- 결측 가격은 보간하지 않습니다.
- 상관관계는 인과관계를 의미하지 않습니다.
