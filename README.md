# 박승민.log

## 구현된 화면과 기능

- 홈: 대표 글, 최근 글
- 아카이브: 제목 검색(`/` 단축키), 사용 빈도 상위 태그 5개 + 더보기 필터, 연도별 목록
- 상세 글: Shiki 코드 하이라이팅, 자동 목차, 스크롤 진행률, 이전·다음 글
- 관리자 에디터: Front Matter 폼, 분할 미리보기, 서식 도구, 이미지 드래그앤드롭, `Cmd/Ctrl+B`·`Cmd/Ctrl+K`, 30초 자동 저장, Markdown 다운로드, OAuth 저장·삭제
- OAuth API: 작성자 계정 제한, 암호화 세션, CSRF 방어, 비공개 원고 저장, 공개 발행, 충돌 없는 slug 변경
- 공통: 반응형 레이아웃, 시스템/수동 다크 모드, 키보드 포커스, RSS, sitemap, SEO 메타태그

## 로컬 실행

```bash
npm install
npm run dev
```

정적 결과 확인:

```bash
npm run build
npm run preview
```

## 새 글 작성

`src/content/posts`에 다음 형식의 파일을 추가합니다.

```yaml
---
title: "포스트 제목"
slug: "post-slug"
date: 2026-08-20
status: public
aliases: []
tags: ["github", "blog"]
category: "개발"
summary: "한 줄 요약"
author: "박승민"
commit: "a1b2c3"
featured: false
---
```

`aliases`는 slug를 변경했을 때 에디터가 과거 slug를 자동으로 누적하는 필드입니다. 과거 `/posts/{old-slug}/` 주소는 새 주소로 이동하는 정적 리다이렉트 페이지가 됩니다.

## 임시 저장과 발행

- `임시 저장`: `status: draft` 원고를 별도의 비공개 저장소에 커밋합니다.
- `발행`: `status: public` 글을 공개 블로그 저장소에 커밋하고 Pages 빌드를 시작합니다.
- 발행된 글을 불러와 임시 저장하면 현재 공개본은 그대로 두고 새 수정 원고만 저장합니다.
- 다음 발행 때 공개본을 수정 원고로 갱신하고 비공개 저장소의 해당 초안을 정리합니다.
- 이미지도 먼저 비공개 원고 저장소에 올리고, 글을 발행할 때 공개 저장소로 복사합니다.

```text
비공개 저장소의 초안 ──발행──▶ 공개 저장소의 글
          ▲                         │
          └──── 수정 원고 저장 ─────┘  공개본은 계속 노출
```

에디터에는 공개 글을 다시 비공개로 만드는 기능이 없습니다. 대신 발행 글을 현재 사이트에서 내리는 `삭제` 기능을 제공합니다. 공개 저장소에서 파일을 삭제해도 Git 히스토리와 외부 캐시에 이미 공개된 내용이 남을 수 있으므로, 삭제는 비밀 상태로 되돌리는 기능이 아닙니다.

실서비스에서는 공개 글 저장소와 비공개 원고 저장소를 분리하세요.

- [실서비스 생성·연결·배포·운영 가이드](docs/DEPLOYMENT.md): 어떤 레포를 만들고 어떤 순서로 Pages·Worker·OAuth를 연결하는지
- [아키텍처 문서](docs/ARCHITECTURE.md): 왜 콘텐츠·화면·인증 책임을 나눴는지
- [에디터 API 안내](editor-api/README.md): 저장 규칙과 API의 보안 성질

## GitHub Pages 배포

1. 저장소의 Settings → Pages → Source를 **GitHub Actions**로 선택합니다.
2. `main` 브랜치에 push하면 `.github/workflows/deploy.yml`이 빌드·배포합니다.
3. 관리자 GitHub 저장을 연결할 때만 저장소 변수 `PUBLIC_EDITOR_API_URL`을 추가합니다.

처음부터 서비스 환경을 만드는 경우에는 [실서비스 배포 가이드](docs/DEPLOYMENT.md)를 순서대로 따르세요. 공개 레포 생성, 비공개 원고 레포 초기화, Worker URL 확보, OAuth callback 등록, Actions 변수 연결 순서가 중요합니다.
