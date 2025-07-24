
## 주요 기능 설명

### 1. **메인 엔트리 (`app.js`)**
- 애플리케이션 실행 시 호출되는 메인 파일
- 주요기능:
  - Playwright를 통해 브라우저 제어
  - 부하테스트에 필요한 기능 호출
    - 서비스 모듈(`auth`, `chat`, `profile`, `ai`)에서 제공하는 기능 호출
  - 사용자 ID 및 설정을 랜덤 생성하여 테스트 환경 설정

### 2. **채팅 모듈 (`app/chat/services.js`)**
- 채팅 방과 관련된 작업을 담당
- 주요 기능:
  - `accessChat(page, chatName)`: 특정 채팅 방 입장
  - `createChat(page, chatName)`: 새로운 채팅 방 생성
  - `talkChat(page, text)`: 채팅방 대화
  - `addReactions(page, findText, reaction)`: 특정 단어에 리액션 추가
  - `scrollDown(page)`: 채팅 방 목록 무한 스크롤 다운
  - `uploadFile(page, filename)`: 채팅 방 파일 업로드

### 3. **인증 모듈 (`app/auth/services.js`)**
- 계정 관리 및 로그인
- 주요 기능:
  - `addUser(page, id, passwd, email)`: 회원가입
  - `login(page, email, passwd)`: 로그인 

### 4. **프로필 관리 모듈 (`app/profile/services.js`)**
- 사용자 프로필 처리
- 주요 기능:
  - `addProfileImage(page, filename)`: 프로필 이미지 업로드

### 5. **AI 모듈 (`app/ai/services.js`)**
- AI 시스템과의 대화
- 주요 기능:
  - `generateAiResponse(page, aiMention)`: AI와 대화를 시작 후 응답 생성

## 설치 및 실행

1. **의존성 설치**
    * Ubuntu
   ```bash
   npm install -g artillery@latest
   npm init playwright@latest
   ```

2. **실행**
   ```bash
   artillery run playwright-artillery.yml
   ```


## 기타 참고
* playwright-wrtillery.yml 설정
    * 시나리오에 필요한 함수 수정 : testFunction: "loginUser"
    * 부하테스트에 필요한 값 수정
        ```bash
          phases:
          - duration: 1
            arrivalRate: 1
        ```

* 하나의 탭에서 처리 가능, 필요시 @jerry.kim 요청
* 모든 기능 한번에 동작 가능, 필요시 @jerry.kim 요청
