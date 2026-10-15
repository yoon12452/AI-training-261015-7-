# DentalFlow

Google Apps Script + Google Sheets 기반 치과기공 작업 관리 웹앱입니다.

## 포함 기능

- 대시보드 KPI, 공정 진행률, 납기 주의 작업, 최근 변경 이력
- 의뢰 등록·수정·삭제·상세 조회
- 상태 변경 및 변경 이력 기록
- 의뢰별 공정 상태 변경
- 납기 필터 및 담당자/상태/보철물 검색
- 통계 및 CSV 내보내기
- 테스트용 가상 샘플 데이터 생성
- 모바일 대응 레이아웃

## 1. Google Sheets 준비

1. Google Drive에서 새 Google 스프레드시트를 만듭니다.
2. 스프레드시트의 **확장 프로그램 → Apps Script**를 엽니다.
3. 기본 `Code.gs` 내용을 제공된 `Code.gs`로 교체합니다.
4. `Index.html`, `Styles.html`, `Client.html` 파일을 HTML 파일로 각각 추가하고 내용을 복사합니다.
5. 프로젝트 설정에서 `appsscript.json` 매니페스트 파일 표시를 켠 뒤, 제공된 매니페스트를 적용합니다.
6. 함수 선택에서 `setupDentalFlow`를 선택하고 **실행**합니다.
7. 첫 실행 시 Google 권한 승인 화면을 검토하고 승인합니다.
8. 스프레드시트에 `Orders`, `Processes`, `History`, `Settings` 시트가 생성됐는지 확인합니다.

> 주의: 초기화 시 스프레드시트 ID를 Script Properties에 저장하며, 이후 웹 앱 요청은 해당 ID로 스프레드시트를 엽니다. 반드시 대상 스프레드시트에서 연 Apps Script 프로젝트(컨테이너 바인드형)에서 `setupDentalFlow()`를 먼저 실행하세요.

## 2. 웹 앱 배포

1. Apps Script에서 **배포 → 새 배포**를 선택합니다.
2. 유형에서 **웹 앱**을 선택합니다.
3. 설명을 입력합니다.
4. 실행 사용자 설정을 검토합니다. 일반적으로 소유자 권한으로 실행하면 사용자가 스프레드시트에 직접 접근하지 않아도 앱이 동작할 수 있지만, 앱에 접근 가능한 사람은 서버 기능을 호출할 수 있으므로 접근 범위를 제한해야 합니다.
5. 액세스 권한은 실제 업무상 필요한 조직 또는 사용자로 제한합니다. 실제 환자 식별정보를 넣지 말고, 실제 데이터 사용 전 권한·보안 검토를 수행하세요.
6. 배포 후 웹 앱 URL을 열어 동작을 확인합니다.

코드를 변경한 후 배포에 반영하려면 **배포 → 배포 관리 → 수정**에서 새 버전을 배포합니다.

## 3. GitHub 및 clasp 로컬 개발

### 준비

- Node.js LTS 설치
- Git 설치
- GitHub 저장소 생성
- Google Apps Script API 활성화: Apps Script 사용자 설정에서 Google Apps Script API를 활성화합니다.

터미널에서 프로젝트 폴더로 이동한 뒤:

```bash
npm install -g @google/clasp
clasp login
```

`.clasp.json.example`을 `.clasp.json`으로 복사하고 `scriptId`에 Apps Script 프로젝트 ID를 입력합니다. `.clasp.json`에는 프로젝트 식별 정보가 있으므로 저장소 공개 정책에 따라 관리하고, 인증 토큰은 절대 커밋하지 마세요.

```bash
clasp pull
clasp push
```

새 프로젝트를 로컬에서 만들고 싶다면 Apps Script에서 먼저 프로젝트를 생성한 후 해당 프로젝트 ID를 연결하는 방식이 초보자에게 가장 단순합니다. `clasp push` 전에 로컬 파일과 서버 파일이 동일한 프로젝트인지 확인하세요.

GitHub 업로드 예시:

```bash
git init
git add Code.gs Index.html Styles.html Client.html appsscript.json README.md .gitignore .clasp.json.example
git commit -m "Initial DentalFlow app"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/DentalFlow.git
git push -u origin main
```

GitHub Pages는 정적 파일 호스팅이며 이 프로젝트의 `google.script.run` 서버 기능을 제공하지 않습니다. 이 앱은 Apps Script 웹 앱 URL로 실행해야 합니다.

## 4. 시트 구조

### Orders

`orderId, clinic, restoration, material, tooth, technician, receivedDate, dueDate, priority, status, notes, isSample, createdAt, updatedAt`

### Processes

`processId, orderId, code, name, technician, status, startedAt, completedAt, sequence`

### History

`historyId, orderId, changedAt, field, beforeValue, afterValue, actor, note`

### Settings

`key, value`

## 5. 테스트 시나리오

1. 앱 접속 후 DEMO 샘플 의뢰가 대시보드에 표시되는지 확인합니다.
2. 신규 의뢰를 필수값과 함께 등록하고 Orders/Processes/History 시트에 저장되는지 확인합니다.
3. 의뢰번호를 눌러 상세를 확인하고 수정 후 시트 값과 변경 이력을 확인합니다.
4. 의뢰 목록에서 상태를 변경하고 변경 이력이 추가되는지 확인합니다.
5. 공정 화면에서 공정 상태를 변경하고 의뢰 상태가 자동 갱신되는지 확인합니다.
6. 납기일을 과거 날짜로 설정한 미출고 의뢰가 지연으로 표시되는지 확인합니다.
7. 검색/필터를 적용한 뒤 CSV를 내보내고 인코딩과 열 구성을 확인합니다.
8. 샘플 데이터 숨기기, 모바일 화면, 빈 검색 결과를 확인합니다.
9. 서로 다른 브라우저/계정에서 동시에 저장해 잠금 동작을 확인합니다.

## 6. 현재 구현 범위 및 운영 전 점검

- 잠금은 저장/수정/삭제/상태 변경의 동시 실행 충돌을 줄이기 위한 기본 보호입니다. 완전한 트랜잭션이나 충돌 해결 시스템은 아닙니다.
- 현재 로그인 이메일은 Apps Script 실행 컨텍스트에 따라 비어 있거나 `미확인`으로 반환될 수 있습니다. 이를 보안 인증으로 간주하면 안 됩니다.
- 직원별 계정·역할 권한, 승인 워크플로, 알림, 첨부 파일, 상세한 감사 추적은 향후 확장 항목입니다.
- 납기 준수율은 현재 `출고 완료` 의뢰의 `dueDate`와 `updatedAt`을 비교하는 간단한 지표입니다. 정확한 실제 출고일 필드를 추가하기 전에는 공식 품질 KPI로 사용하지 마세요.
- `setupDentalFlow()`는 필요한 시트를 만들고 Orders가 비어 있을 때 샘플 데이터를 넣습니다. 실제 데이터가 있는 시트에서 헤더를 임의로 바꾸지 마세요.
- 시트 데이터가 많아지면 전체 데이터를 매번 읽는 구조는 느려질 수 있으므로 페이지네이션/캐시/검색 서버 API로 개선할 수 있습니다.

## 7. 오류 해결

- **필수 시트가 없다는 오류:** 스프레드시트에 바인드된 Apps Script인지 확인하고 `setupDentalFlow()`를 실행합니다.
- **권한 오류:** 스크립트 편집기에서 초기화 함수를 직접 실행해 승인하고, 웹 앱 배포 권한을 확인합니다.
- **코드 변경이 화면에 반영되지 않음:** 기존 배포를 수정해 새 버전을 배포한 후 새로고침합니다.
- **`google.script.run`을 찾을 수 없음:** Apps Script 웹 앱 URL이 아니라 HTML 파일을 직접 열었는지 확인합니다.
- **시트 헤더 불일치:** 기존 데이터 백업 후 1행의 헤더가 README의 컬럼명과 정확히 일치하는지 확인합니다.
- **CSV 한글 깨짐:** UTF-8 BOM을 포함해 내보내지만, 사용하는 스프레드시트/편집기에서 UTF-8로 가져오기를 선택합니다.
