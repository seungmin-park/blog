# Editor OAuth API

GitHub Pages의 정적 에디터와 GitHub API 사이에서 OAuth 비밀값과 토큰을 보호하는 Cloudflare Worker입니다.

빈 계정에서 Public/Private 레포를 만들고 Pages·Worker·OAuth를 순서대로 연결하는 전체 절차는 [실서비스 생성·연결·배포·운영 가이드](../docs/DEPLOYMENT.md)를 먼저 확인하세요.

## 설정

1. GitHub OAuth App을 만들고 callback URL을 `https://<worker-domain>/auth/callback`로 지정합니다.
2. `wrangler.jsonc`의 공개 변수 일곱 개를 실제 값으로 바꿉니다.
3. 비밀값을 등록합니다.

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET`은 충분히 긴 무작위 문자열을 사용합니다. 이후 `npm install && npm run deploy`로 배포하고, 반환된 Worker 주소를 블로그 저장소 변수 `PUBLIC_EDITOR_API_URL`에 등록합니다.

## 보안 성질

- 허용한 GitHub 사용자 한 명만 쓰기 가능
- 토큰을 AES-GCM으로 암호화한 HttpOnly 쿠키에 보관
- 모든 쓰기 요청에 세션 내부 CSRF 토큰 요구
- CORS origin을 에디터 주소 하나로 고정
- 저장소 owner/name은 브라우저 입력을 받지 않고 서버 설정만 사용
- draft는 비공개 원고 저장소, public은 Pages 저장소에 커밋
- 저장된 발행 글과 임시 글 목록·원문을 에디터에서 다시 불러오기
- 발행된 글의 수정 초안을 저장해도 현재 공개본은 유지
- 저장·삭제 전에 불러온 Git SHA를 비교해 오래된 화면의 덮어쓰기 방지
- slug 목적지 파일과 기존 리다이렉트의 충돌 검사
- 공개 slug 변경 시 과거 주소를 `aliases`에 누적하고 정적 리다이렉트 생성
- 발행할 때 본문이 참조한 초안 이미지만 공개 저장소로 복사
- 이미지 크기를 5MB로 제한

## 저장 규칙

```text
임시 저장: private-repo/draft/{slug}.md 갱신
발행:      public-repo/src/content/posts/{slug}.md 갱신
           → 성공 후 private-repo/draft/{slug}.md 정리
```

`임시 저장`은 같은 슬러그의 공개 파일을 삭제하지 않습니다. 따라서 발행된 글을 고치는 동안에도 기존 공개본이 계속 서비스됩니다.

공개 글을 비공개로 되돌리는 API는 제공하지 않습니다. 공개 저장소에서 파일을 삭제해도 Git 히스토리나 외부 캐시에 이미 공개된 내용이 남아 비밀로 복구되지 않기 때문입니다.

## slug 변경과 삭제

```text
slug 변경: 원본 SHA 확인 → 목적지 충돌 확인 → 새 파일 저장 → 옛 파일 삭제
글 삭제:   원본 SHA 확인 → 선택한 draft 또는 public 파일만 삭제
```

- 공개 글의 옛 slug는 새 글의 `aliases`에 들어가므로 기존 링크가 새 주소로 이동합니다.
- 발행 글 삭제는 현재 사이트 노출을 끝내지만 Git 히스토리를 지우지 않습니다.
- 발행 글과 임시 저장 글은 별도 원본이므로 하나를 삭제해도 다른 하나는 자동 삭제하지 않습니다.
- 이미지는 여러 글이 공유할 수 있어 글 삭제 때 자동 삭제하지 않습니다.
