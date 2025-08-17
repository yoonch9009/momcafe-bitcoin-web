# 맘카페 “비트코인” 언급량 vs BTC (주간, KST)

네이버/다음 카페에서 **“비트코인” 언급 게시글 수(주간)** 를 모아, **비트코인 가격(BTC/USD)** 과 함께 **서버리스(무료)** 로 시각화하는 프로젝트입니다.

* **집계/크롤링**: GitHub Actions (스케줄 실행)
* **호스팅**: GitHub Pages (정적 웹)
* **시각화**: ECharts (인터랙티브 차트, 다크모드, 로그 스케일)

> **핵심**: 모든 시간은 **KST(Asia/Seoul)** 로 정규화하고, 주간 윈도우는 \*\*월요일 시작(W-MON, closed='left')\*\*을 사용합니다. 예측 관점에서는 **t 주 게시글 → t+1(또는 t+x) 주 수익률**을 사용하여 **미래참조(look-ahead) 편향**을 방지합니다.

---

## 데모(예시 URL)

* GitHub Pages 설정 후: `https://<YOUR_USERNAME>.github.io/<YOUR_REPO>/`

---

## 기능

* 📊 **메인 차트**: 주간 게시글(막대) + BTC 가격(선)

  * 가격 지표 선택: **주간 평균가**, **주간 종가**, **다음 주 종가(예측)**, **다음 주 수익률(예측)**
  * **BTC 로그 스케일 토글** (수익률 모드 제외)
  * 줌/팬, 툴팁, 범례
* 🔍 **산점도**: 주 t 게시글 수 ↔ **t+*x* 주 수익률** (지평 x=1..8 선택) + **피어슨 r** 표시
* 🧭 **시간 동기화**: KST, 주간 월요일 시작, 가격 결측은 **보간 없이 null** 유지
* 🎛️ **UI**: KPI 블록(갱신 시각, 최근 주 지표), **라이트/다크 테마 토글**, `data.json` 다운로드

---

## 아키텍처

```
.
├─ scrape.py                    # 데이터 수집/정렬/직렬화 (액션에서 실행)
├─ requirements.txt
├─ .github/workflows/scrape.yml # 스케줄 실행(매일/수동)
└─ docs/
   ├─ index.html                # 대시보드(정적)
   └─ data.json                 # 액션이 생성/갱신 (schema v2)
```

---

## 데이터 파이프라인 요약

1. **카페 수집**

   * 네이버/다음 카페 검색 결과에서 게시글 날짜를 파싱 → **KST tz-aware** 로 변환
   * 게시글 수를 **주간(월요일 시작)** 으로 집계

2. **BTC 가격**

   * CryptoCompare 일봉(UTC) → **KST로 변환** → 주간 **평균/종가** 집계
   * **예측용 지표**: `t+1`(혹은 `t+x`) 주 **종가/수익률** 계산

3. **직렬화(`docs/data.json`)**

   * `schemaVersion: 2`
   * **NaN/Inf → null** 로 변환 (`allow_nan=False`)
   * 주요 키:

     * `weeks`: `YYYY-MM-DD` (주 시작, 월요일, KST)
     * `postCounts`: 주간 게시글 수
     * `btcWeeklyMean`, `btcWeeklyClose`: 같은 주의 평균/종가(설명용)
     * `btcNextWeekClose`, `btcNextWeekReturn`: **t→t+1** 지표(예측용)
     * `kpis.lastWeek`: 최근 완료 주의 요약

---

## 빠른 시작 (로컬)

```bash
# Python 3.11 권장
python -m venv .venv
source .venv/bin/activate        # (Windows: .venv\Scripts\activate)
pip install -r requirements.txt

# 선택: CryptoCompare API 키(없어도 일부 기간만 동작할 수 있음)
export CRYPTOCOMPARE_API_KEY=YOUR_KEY

# 데이터 생성
python scrape.py                 # docs/data.json 생성
# 브라우저로 docs/index.html 열기 (Live Server 사용 권장)
```

---

## 배포 (GitHub Pages + Actions)

1. 리포지토리 생성 후 본 프로젝트 파일을 푸시
2. **Secrets** 추가: `CRYPTOCOMPARE_API_KEY` (Settings → Secrets and variables → Actions)
3. **GitHub Pages**: Settings → Pages

   * Source: **Deploy from a branch**, Branch: `main`, Folder: `/docs`
4. 워크플로(`.github/workflows/scrape.yml`)가 **매일/수동** 실행되어 `docs/data.json`을 갱신하고 푸시

> 워크플로 커밋 단계는 **`docs/data.json`만** 추가하도록 되어 있어야 합니다.
> (백업 이미지를 쓰지 않는 최신 구조 기준)

예시 커밋 단계:

```yaml
- name: Commit & Push changes (if any)
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git add docs/data.json
    if ! git diff --cached --quiet; then
      git commit -m "Update data.json [skip ci]"
      git push
    else
      echo "No changes to commit."
    fi
```

---

## 설정(커스터마이즈)

`scrape.py` 상단:

* `SEARCH_KEYWORD = "비트코인"` → 다른 키워드로 변경 가능
* 카페 목록:

  * 네이버 `naver_ids = [...]`
  * 다음 `daum_ids = [...]`
* 요청 간 지연: `time.sleep(random.uniform(1.2, 3.8))` (서비스 부담/차단 방지)

**주의(중요)**

* 각 서비스의 **이용약관/robots 정책**을 확인하고 준수하세요.
* 과도한 호출/대량 수집은 제한될 수 있습니다.

---

## 문제 해결(Troubleshooting)

* **차트가 안 뜸 / 콘솔에 `Unexpected token N in JSON`**
  → `data.json`에 `NaN`이 들어간 경우. `save_json`에서 **NaN/Inf→null** 처리 + `allow_nan=False` 사용 여부 확인.
* **`data.json` 404**
  → 워크플로 실패 or 경로 오타. Actions 로그에서 `scrape.py` 에러/커밋 단계 확인.
* **CDN 차단으로 스크립트 로드 실패**
  → `echarts.min.js`를 `docs/libs/`에 로컬로 두고 `<script src="./libs/echarts.min.js">`로 교체.
* **시간 정렬이 어색함**
  → 시스템 시간/타임존이 아닌, **KST 기준**으로 주간 집계되는지 확인.
* **산점도 라벨/축 잘림**
  → `index.html`의 산점도 옵션에서 `grid.containLabel: true`와 여백(좌 90/하 72)이 적용되어 있어야 합니다.

---

## 향후 확장 아이디어

* 라그(±8주) **교차상관 히트맵**
* **이상치 강조**(상·하위 5% 주 마커)
* **복수 키워드**(탭으로 전환) / 지역·카페별 필터
* 간단한 **회귀선 및 신뢰구간** 오버레이

---

## 라이선스 / 데이터 출처

* 라이선스: 필요에 맞게 선택해 `LICENSE` 파일을 추가하세요(예: MIT).
* 데이터 출처: 네이버/다음 카페 공개 검색(약관 준수), CryptoCompare (BTC/USD).

---

## 감사

* 시각화: \[Apache ECharts]
* CI/CD & 호스팅: GitHub Actions / GitHub Pages

프로젝트에 개선 아이디어나 버그 제보가 있으면 이슈로 남겨 주세요!
