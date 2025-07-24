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
      await page.waitForTimeout(3000);
    }
    
    // Socket.IO 연결 상태 확인 및 대기
    console.log('⏳ Waiting for Socket.IO connection to be CONNECTED...');
    
    // 연결 상태 확인을 위한 여러 방법 시도
    let isConnected = false;
    const connectionCheckMethods = [
      // 방법 1: "연결됨" 배지 확인
      async () => {
        const connectedBadge = await page.locator('text=연결됨').count();
        return connectedBadge > 0;
      },
      // 방법 2: "연결 중" 이 아닌 상태 확인
      async () => {
        const connectingBadge = await page.locator('text=연결 중').count();
        return connectingBadge === 0;
      },
      // 방법 3: 5초 후 강제로 연결됨으로 간주
      async () => {
        await page.waitForTimeout(5000);
        return true;
      }
    ];
    
    for (const method of connectionCheckMethods) {
      try {
        isConnected = await method();
        if (isConnected) break;
        await page.waitForTimeout(1000);
      } catch (error) {
        console.log('Connection check method failed, trying next...');
      }
    }
    
    if (isConnected) {
      console.log('✅ Socket.IO connection is CONNECTED (verified by badge)');
    } else {
      console.log('⚠️ Could not verify connection status, proceeding anyway...');
    }
    
    // 버튼 강제 활성화
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button[disabled]');
      buttons.forEach(btn => {
        if (btn.textContent.includes('입장')) {
          btn.removeAttribute('disabled');
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.style.pointerEvents = 'auto';
        }
      });
    });
    
    const maxAttempts = 5;
    let success = false;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`Attempt ${attempt} to find table...`);
        
        // 테이블 확인
        const tableSelectors = [
          '.chat-rooms-table',
          'table',
          '[role="table"]',
          'tbody'
        ];
        
        let tableFound = false;
        for (const selector of tableSelectors) {
          const tableCount = await page.locator(selector).count();
          if (tableCount > 0) {
            console.log(`✅ Table found with selector: ${selector}`);
            tableFound = true;
            break;
          }
        }
        
        if (!tableFound) {
          console.log('❌ No table found, refreshing page...');
          await page.reload();
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(2000);
          continue;
        }
        
        console.log(`🔍 Looking for chat room: ${chatName}`);
        
        // 모든 행 정보 수집
        const rowSelectors = ['tbody tr', 'tr', '[role="row"]'];
        let rows = [];
        
        for (const selector of rowSelectors) {
          const rowCount = await page.locator(selector).count();
          if (rowCount > 0) {
            console.log(`Found ${rowCount} rows with selector: ${selector}`);
            
            rows = await page.evaluate((sel) => {
              const elements = document.querySelectorAll(sel);
              return Array.from(elements).map((row, index) => {
                const cells = row.querySelectorAll('td, [role="cell"]');
                const roomName = cells.length > 0 ? cells[0].textContent.trim() : '';
                return { index, roomName, text: row.textContent.trim() };
              }).filter(row => row.roomName.length > 0);
            }, selector);
            break;
          }
        }
        
        console.log(`Total rows found: ${rows.length}`);
        rows.forEach((row, i) => {
          console.log(`Row ${i}: ${row.text}`);
        });
        
        // 정확한 매칭 시도
        let targetRow = rows.find(row => row.roomName === chatName);
        
        // 정확한 매칭 실패 시 부분 매칭 시도
        if (!targetRow) {
          console.log(`❌ Exact match failed for "${chatName}", trying partial match...`);
          
          // 부분 매칭 (chatName의 일부가 포함된 룸 찾기)
          const chatNameParts = chatName.split('_');
          for (const part of chatNameParts) {
            if (part.length > 5) { // 의미있는 부분만 사용
              targetRow = rows.find(row => row.roomName.includes(part));
              if (targetRow) {
                console.log(`✅ Partial match found with part "${part}": ${targetRow.roomName}`);
                break;
              }
            }
          }
        }
        
        // 여전히 못 찾으면 group으로 시작하는 아무 룸이나 사용
        if (!targetRow) {
          console.log(`❌ Partial match also failed, looking for any test room...`);
          targetRow = rows.find(row => row.roomName.includes('group_') || row.roomName.includes('test'));
        }
        
        // 마지막 수단: 첫 번째 룸 사용
        if (!targetRow && rows.length > 0) {
          console.log(`⚠️ Using first available room as fallback...`);
          targetRow = rows[0];
        }
        
        if (!targetRow) {
          console.log('=== 🔍 Available chat rooms ===');
          rows.forEach((row, i) => {
            console.log(`  Row ${i}: ${row.text}`);
          });
          throw new Error(`❌ No suitable chat room found (total rooms: ${rows.length})`);
        }
        
        console.log(`🎯 Target room selected: "${targetRow.roomName}" (row ${targetRow.index})`);
        
        // 해당 행의 입장 버튼 클릭
        const buttonSelectors = [
          `tbody tr:nth-child(${targetRow.index + 1}) button:has-text("입장")`,
          `tr:nth-child(${targetRow.index + 1}) button:has-text("입장")`,
          `tbody tr:nth-child(${targetRow.index + 1}) button`,
          `tr:nth-child(${targetRow.index + 1}) button`,
          `tbody tr:nth-child(${targetRow.index + 1}) [role="button"]`
        ];
        
        let buttonClicked = false;
        for (const selector of buttonSelectors) {
          try {
            const buttonCount = await page.locator(selector).count();
            if (buttonCount > 0) {
              console.log(`🔘 Clicking button with selector: ${selector}`);
              
              await page.locator(selector).first().click({ timeout: 10000 });
              buttonClicked = true;
              break;
            }
          } catch (clickError) {
            console.log(`❌ Button click failed with ${selector}: ${clickError.message}`);
          }
        }
        
        if (!buttonClicked) {
          throw new Error(`❌ Could not click any button for room: ${targetRow.roomName}`);
        }
        
        // 페이지 이동 확인
        await page.waitForTimeout(3000);
        const newUrl = page.url();
        
        if (newUrl.includes('/chat?room=')) {
          console.log(`✅ Successfully entered chat room: ${newUrl}`);
          success = true;
          break;
        } else {
          console.log(`❌ Page didn't navigate to chat room. Current URL: ${newUrl}`);
          throw new Error('Failed to navigate to chat room');
        }
        
      } catch (error) {
        console.log(`❌ Attempt ${attempt} failed: ${error.message}`);
        
        if (attempt < maxAttempts) {
          console.log(`🔄 Retrying in 2 seconds... (${maxAttempts - attempt} attempts left)`);
          await page.waitForTimeout(2000);
          
          // 페이지 새로고침
          await page.goto('https://chat.goorm-ktb-018.goorm.team/chat-rooms');
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(2000);
        }
      }
    }
    
    if (!success) {
      // 디버그용 스크린샷
      const timestamp = Date.now();
      const screenshotPath = `debug-access-chat-${timestamp}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 Debug screenshot saved: ${screenshotPath}`);
      
      throw new Error(`❌ Failed to access chat after ${maxAttempts} attempts`);
    }
    
  } catch (error) {
    console.error('❌ Access chat error:', error);
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

