# MOR.NEVEN

MOR.NEVEN은 도자기 공방을 위한 웹사이트입니다. 드래그 가능한 이미지 보드,
macOS 스타일 이미지 창, 하단 Dock 링크, 비밀번호로 보호되는 이미지 관리 기능을
포함합니다.

버전: v1.0.1

운영 사이트: https://morneven-fc90f.web.app

## 버전 기록

버전은 `vMAJOR.MINOR.PATCH` 형식으로 관리합니다.

- 큰 기능 추가, 구조 변경, 호환성에 큰 영향을 주는 업데이트는 `MAJOR`를 올립니다.
- 기능 개선이나 사용자가 체감하는 중간 규모 업데이트는 `MINOR`를 올립니다.
- 버그 수정, 리팩토링, 문서 보강 같은 자잘한 업데이트는 `PATCH`를 올립니다.

### v1.0.1 - 2026-05-22

운영 동작을 유지하면서 API와 화면 배치 유지보수성을 정리한 리팩토링 버전입니다.

변경된 내용:

- Firebase Function과 로컬 서버가 공유하는 이미지 정규화, 세션, 쿠키,
  data URL 파싱 로직을 `functions/shared.js`로 분리했습니다.
- `/api/images` 응답에서 내부 저장 경로인 `storagePath`가 클라이언트로
  노출되지 않도록 public 이미지 응답 형태를 분리했습니다.
- 기본 이미지 삭제 후 모바일 배치가 DOM 순서에 따라 바뀌지 않도록
  모바일 좌표를 각 이미지의 CSS 변수로 고정했습니다.
- 관리자 이미지 삭제 실패와 여러 이미지 저장 중 일부 실패 상황에서 상태 메시지와
  pending 이미지 목록이 어긋나지 않도록 처리했습니다.
- `npm run verify`가 공유 로직, 세션 토큰, 이미지 파싱, 모바일 배치 불변식,
  public API 응답 형태를 함께 검증하도록 보강했습니다.

### v1.0.0 - 2026-05-19

MOR.NEVEN 사이트의 첫 운영 버전입니다.

추가된 기능:

- PC에서 드래그할 수 있는 도자기 아카이브 이미지 보드.
- 닫기, 최소화, 확대 버튼이 있는 macOS 스타일 이미지 창.
- PC에서 최대 3개까지 겹쳐 열 수 있는 이미지 창.
- 모바일에서 배경을 누르면 닫히는 이미지 모달.
- Instagram, KakaoTalk, Naver Booking, Naver Map으로 이동하는 하단 Dock.
- MOR.NEVEN 로고 배경과 달 모양 favicon 에셋.
- PC 전용 비밀번호 보호 이미지 매니저.
- 이미지 이름, 타입, 설명을 입력할 수 있는 이미지 추가/삭제 흐름.
- 관리 가능한 갤러리 이미지 최대 20장 제한.
- Firebase Hosting, Cloud Functions, Firestore, Storage, Secret Manager 연동.
- 로컬 업로드와 메타데이터 저장을 지원하는 로컬 미리보기 서버.

## 주요 기능

- PC에서 도자기 아카이브 이미지를 드래그할 수 있습니다.
- 이미지를 클릭하면 macOS 스타일 창으로 크게 볼 수 있습니다.
- PC에서는 이미지 창을 최대 3개까지 동시에 열 수 있습니다.
- 모바일에서는 하나의 이미지 모달을 사용하며, 바깥 배경을 누르면 닫힙니다.
- 하단 Dock에서 Instagram, KakaoTalk, Naver Booking, Naver Map으로 이동합니다.
- 관리자 이미지 매니저는 서버에서 비밀번호를 확인한 뒤 접근할 수 있습니다.
- 이미지 추가/삭제는 총 20장 제한 안에서 동작합니다.
- 운영 환경은 Firebase를 사용하고, 로컬 미리보기는 IndexedDB fallback을 사용합니다.

## 프로젝트 구조

```text
.
├── index.html              # 정적 페이지 마크업
├── styles.css              # 사이트, 모달, Dock, 매니저 스타일
├── script.js               # 이미지 보드, 모달, 관리자 UI, API 클라이언트
├── server.js               # 로컬 미리보기 서버와 로컬 API 미러
├── assets/                 # 로고, favicon, Dock 아이콘, 기본 도자기 이미지
├── functions/index.js      # Firebase Cloud Function API
├── functions/shared.js     # 로컬 서버와 Function이 공유하는 순수 로직
├── firestore.rules         # 클라이언트의 Firestore 직접 접근 차단
├── storage.rules           # 클라이언트의 Storage 직접 접근 차단
├── firebase.json           # Hosting, rewrites, functions, rules 설정
└── FIREBASE_DEPLOY.md      # Firebase 배포 상세 메모
```

로컬에서만 생성되는 런타임 폴더는 git에서 제외됩니다:

```text
.local-data/
uploads/
```

## 로컬 개발

로컬 서버는 관리자 비밀번호를 환경 변수로 받습니다. 실제 비밀번호를 소스 파일에
적지 마세요.

```sh
MORNEVEN_ADMIN_PASSWORD='your-admin-password' \
MORNEVEN_SESSION_SECRET='local-dev-session-secret' \
node server.js
```

브라우저에서 열기:

```text
http://127.0.0.1:4173/
```

로컬 업로드 파일은 `uploads/`에 저장되고, 로컬 이미지 메타데이터는
`.local-data/images.json`에 저장됩니다.

## 관리자 이미지 매니저

PC에서는 오른쪽 위의 은은한 `+` 버튼으로 관리자 매니저를 열 수 있습니다.

지원 기능:

- 이미지 파일 추가
- 저장 전 이미지 이름, 타입, 설명 입력
- 기존 기본 이미지 또는 업로드 이미지 삭제
- 전체 이미지 최대 20장 관리

운영 환경의 관리자 인증은 Firebase Function에서 처리합니다. 비밀번호는 클라이언트
코드가 아니라 Firebase Secret Manager의 `MORNEVEN_ADMIN_PASSWORD`에 저장합니다.

## Firebase

운영 환경에서 사용하는 것:

- Firebase Hosting: 정적 파일 호스팅
- Cloud Functions v2: `/api/**`
- Firestore: 이미지 메타데이터와 숨김 처리된 기본 이미지 상태 저장
- Cloud Storage: 업로드 이미지 파일 저장
- Secret Manager: 관리자 비밀번호와 세션 서명 secret 저장

secret 설정:

```sh
firebase functions:secrets:set MORNEVEN_ADMIN_PASSWORD --project morneven-fc90f
firebase functions:secrets:set MORNEVEN_SESSION_SECRET --project morneven-fc90f
```

Function 의존성 설치:

```sh
cd functions
npm install
cd ..
```

전체 배포:

```sh
firebase deploy --project morneven-fc90f
```

정적 파일만 배포:

```sh
firebase deploy --only hosting --project morneven-fc90f
```

## 검증

배포 전 유용한 확인 명령:

```sh
npm run verify
firebase deploy --only hosting --project morneven-fc90f --non-interactive
```

Function/API를 변경한 경우에는 배포 후 `/api/session`, `/api/images`, 로그인,
이미지 업로드, 이미지 삭제를 확인하세요.

## 에셋 메모

현재 Dock 아이콘:

- `assets/dock-instagram.svg`
- `assets/dock-kakao.svg`
- `assets/dock-naver-booking-20260519.webp`
- `assets/dock-naver-map.webp`

기본 보드 이미지는 `assets/pottery-01.jpeg`부터 `assets/pottery-08.jpeg`까지입니다.

## 보안 메모

- `.env`, `.local-data/`, `uploads/`, 실제 비밀번호 값은 절대 커밋하지 마세요.
- Firestore와 Storage rules는 클라이언트의 직접 읽기/쓰기를 차단합니다.
- 브라우저는 `/api/**`만 호출하고, 권한이 필요한 작업은 서버 또는 Firebase
  Function에서 처리합니다.
- 관리자 비밀번호는 환경 변수 또는 Firebase Secret Manager에만 보관해야 합니다.
