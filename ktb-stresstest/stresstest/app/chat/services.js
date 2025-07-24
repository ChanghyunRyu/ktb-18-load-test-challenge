const path = require('path');

const accessChat = async (page, chatName) => {
  try {
    // 현재 URL 확인 및 세션 만료 체크
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);
    
    // 더 포괄적인 세션 만료 감지
    if (currentUrl.includes('session_expired') || 
        currentUrl.includes('session_ended') || 
        currentUrl.includes('login') || 
        currentUrl === 'https://chat.goorm-ktb-018.goorm.team/' ||
        currentUrl === 'https://chat.goorm-ktb-018.goorm.team') {
      console.log('Session expired or redirected to login, need to re-authenticate');
      throw new Error('Session expired - need to re-login');
    }
    
    // 채팅방 목록 페이지에 있는지 확인
    if (!currentUrl.includes('chat-rooms')) {
      console.log('Not on chat-rooms page, navigating...');
      await page.goto('https://chat.goorm-ktb-018.goorm.team/chat-rooms');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000); // 추가 대기
    }
    
    // 페이지 로딩 대기 및 테이블 확인
    let tableFound = false;
    const maxRetries = 3;
    
    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        console.log(`Attempt ${retry + 1} to find table...`);
        
        // 여러 방법으로 테이블 찾기
        try {
          await page.waitForSelector('table', { timeout: 5000 });
          tableFound = true;
          break;
        } catch (e1) {
          try {
            await page.waitForSelector('.chat-rooms-table', { timeout: 5000 });
            tableFound = true;
            break;
          } catch (e2) {
            try {
              await page.waitForSelector('tbody tr', { timeout: 5000 });
              tableFound = true;
              break;
            } catch (e3) {
              console.log(`Table not found in attempt ${retry + 1}, retrying...`);
              if (retry < maxRetries - 1) {
                await page.reload();
                await page.waitForLoadState('networkidle');
                await page.waitForTimeout(2000);
              }
            }
          }
        }
      } catch (error) {
        console.log(`Retry ${retry + 1} failed:`, error.message);
      }
    }
    
    if (!tableFound) {
      console.log('Table not found after all retries, checking page content...');
      
      // 페이지 내용 확인
      const pageContent = await page.content();
      console.log('Page title:', await page.title());
      
      // 빈 채팅방 목록인지 확인
      const hasNoChatRoomsMessage = await page.locator('text=생성된 채팅방이 없습니다').count() > 0;
      if (hasNoChatRoomsMessage) {
        console.log('No chat rooms exist, creating one first...');
        // 이 경우는 정상이므로 에러를 던지지 않고 상위에서 처리하도록 함
        throw new Error('No chat rooms available - need to create one first');
      }
      
      // 다시 세션 확인
      if (pageContent.includes('로그인') || pageContent.includes('회원가입')) {
        throw new Error('Session expired - redirected to login page');
      }
      
      throw new Error('Table not found and page seems invalid');
    }
    
    // 채팅방 찾기 - 여러 방법 시도
    console.log(`Looking for chat room: ${chatName}`);
    
    let targetRow = null;
    
    try {
      // 방법 1: 기존 방식
      const rows = await page.locator('tr');
      targetRow = await rows.filter({ hasText: chatName });
      
      if (await targetRow.count() === 0) {
        throw new Error('Chat room not found with hasText filter');
      }
    } catch (error1) {
      console.log('Method 1 failed, trying method 2...');
      try {
        // 방법 2: 텍스트 포함 검색
        targetRow = page.locator(`tr:has-text("${chatName}")`);
        
        if (await targetRow.count() === 0) {
          throw new Error('Chat room not found with has-text selector');
        }
      } catch (error2) {
        console.log('Method 2 failed, trying method 3...');
        
        // 방법 3: 모든 행 검사
        const allRows = await page.locator('tr').all();
        for (let i = 0; i < allRows.length; i++) {
          const rowText = await allRows[i].textContent();
          if (rowText && rowText.includes(chatName)) {
            targetRow = page.locator('tr').nth(i);
            break;
          }
        }
        
        if (!targetRow) {
          // 디버깅: 현재 페이지의 모든 채팅방 목록 출력
          console.log('=== Available chat rooms ===');
          const chatRoomRows = await page.locator('tbody tr').all();
          for (let i = 0; i < chatRoomRows.length; i++) {
            const rowText = await chatRoomRows[i].textContent();
            console.log(`Row ${i}: ${rowText}`);
          }
          console.log('============================');
          
          throw new Error(`Chat room "${chatName}" not found in any method`);
        }
      }
    }
    
    // 입장 버튼 찾기 및 클릭
    try {
      // 방법 1: 원래 방식
      await targetRow.locator("button:has-text('입장')").first().click();
    } catch (buttonError1) {
      console.log('Button method 1 failed, trying alternatives...');
      try {
        // 방법 2: role 기반
        await targetRow.getByRole('button', { name: '입장' }).click();
      } catch (buttonError2) {
        try {
          // 방법 3: 일반 버튼 텍스트
          await targetRow.getByText('입장').click();
        } catch (buttonError3) {
          // 방법 4: 마지막 수단 - 행의 마지막 버튼
          await targetRow.locator('button').last().click();
        }
      }
    }
    
    await page.waitForTimeout(3000);
    
    // 채팅 페이지로 이동 확인
    await page.waitForURL('**/chat?room=*', { timeout: 10000 });
    console.info('Chat accessed successfully');
    
  } catch (error) {
    console.error('Access chat error:', error);
    
    // 스크린샷 촬영 (디버깅용)
    try {
      await page.screenshot({ path: `debug-access-chat-${Date.now()}.png` });
      console.log('Debug screenshot saved');
    } catch (screenshotError) {
      console.log('Failed to save screenshot:', screenshotError.message);
    }
    
    throw error;
  }
};

const createChat = async (page, chatName) => {
  // 네비게이션에서 새 채팅방 버튼 클릭 (더 안정적)
  const newChatButton = page.getByRole('button', { name: '새 채팅방' });
  await newChatButton.click();

  const chatNameInput = page.getByPlaceholder('채팅방 이름을 입력하세요');
  await chatNameInput.fill(chatName);

  const createChatButton = page.getByRole('button', { name: '채팅방 만들기' });
  await createChatButton.click();

  await page.waitForTimeout(3000);
  console.info('Chat created');
};


const talkChat = async (page, text) => {
  const messageInput = page.getByPlaceholder('메시지를 입력하세요... (@를 입력하여 멘션,');
  const sendButton = page.getByRole('button', { name: '보내기' });

  for (let i = 0; i < 3; i++) {
    await messageInput.fill(text);
    await sendButton.click();
  }
  await page.waitForTimeout(1000);
  console.info('Chat talk completed');
};

const addReactions = async (page, findText, reaction) => {
  // 채팅방 목록에 접근했을 때의 문자열만 이모지 추가
  // 모든 글이 필요하면 맨 위 휠로 접근해서 진행 필요
  await page.waitForTimeout(2000);
  const messagesLocator = await page.locator('div.messages');
  const messages = await messagesLocator.all();
  console.log("message count: ",messages.length);
  await Promise.all(
      messages.map(async (message) => {
          try {
              const messageText = await message.locator('div.message-content').innerText();
              if (!messageText.includes(findText)) return;
  
              const reactionButton = await message.locator('button[title="리액션 추가"]');
              if (!await reactionButton.isVisible()) return;
  
              await reactionButton.click();
              const allReactions = await page.locator('button[aria-label]').all();
              if (allReactions.length > 0) {
                  const randomReactionIndex = Math.floor(Math.random() * allReactions.length);
                  const randomReaction = allReactions[randomReactionIndex];
  
                  if (await randomReaction.isVisible()) {
                      await randomReaction.click({ force: true });
                      console.info(`${randomReactionIndex} Random reaction added`);
                  } else {
                      console.warn('Reaction not visible, skipping');
                  }
              }
          } catch (error) {
              console.error('Error processing message:', error);
          }
      })
      );
  };
  
  const scrollDown = async (page) => {
    // 채팅방 목록 페이지에서 스크롤 가능한 테이블 컨테이너 찾기
    try {
      // 먼저 채팅방 테이블 컨테이너가 로드될 때까지 대기
      await page.waitForSelector('.chat-rooms-table', { timeout: 10000 });
      
      const tableContainer = page.locator('.chat-rooms-table');
      const boundingBox = await tableContainer.boundingBox();
      
      if (!boundingBox) {
        console.info('Table container not found, trying alternative selector...');
        
        // 대안: 테이블 헤더로 찾기
        await page.waitForSelector('table thead tr', { timeout: 5000 });
        const tableHeader = page.locator('table thead tr').first();
        const headerBox = await tableHeader.boundingBox();
        
        if (!headerBox) {
          console.info('No scrollable element found.');
          return;
        }
        
        await page.mouse.move(
          headerBox.x + headerBox.width / 2,
          headerBox.y + headerBox.height / 2
        );
      } else {
        await page.mouse.move(
          boundingBox.x + boundingBox.width / 2,
          boundingBox.y + boundingBox.height / 2
        );
      }

      console.info('Scroll started');
      let stopScrolling = false;

      setTimeout(() => {
        console.info('Scroll stopped after 10 seconds.');
        stopScrolling = true;
      }, 10000);

      try {
        while (!stopScrolling) {
          await page.mouse.wheel(0, 100);
          await page.waitForTimeout(500);
        }
      } finally {
        console.info('Scroll ended');
      }
      
    } catch (error) {
      console.error('Scroll error:', error);
      // 스크롤 실패해도 테스트는 계속 진행
      console.info('Scroll failed, but continuing test...');
    }
  };
  

const uploadFile = async (page, filename) => {
  const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '파일 첨부' }).click(),
  ]);

  await fileChooser.setFiles(path.resolve(filename));

  // 파일 업로드 후 보내기 버튼 클릭
  await page.getByRole('button', { name: '보내기' }).click();

  console.info('File uploaded');
  await page.waitForTimeout(3000);
};


module.exports = { accessChat, createChat, talkChat, addReactions, scrollDown, uploadFile };
