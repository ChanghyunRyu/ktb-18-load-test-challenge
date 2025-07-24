const { chromium } = require('playwright');
const { addUser, login } = require('./app/auth/services');
const { createChat, talkChat, accessChat, scrollDown, addReactions, uploadFile } = require('./app/chat/services');
const { addProfileImage } = require('./app/profile/services');
const { generateAiResponse } = require('./app/ai/services');
const crypto = require('crypto');

const passwd = "123123";
const domain = "@test.com";
const site = "https://chat.goorm-ktb-018.goorm.team/";
const filename = './photo/test.jpeg';
const aiMention = "@wayneAI";
const findText = "hello";
const msg = "hello";
const group = "group_b";

// 동적으로 채팅방 이름 생성
let chatName = `${group}_test_${Date.now()}`;

// 채팅방 생성 및 이름 반환하는 헬퍼 함수
async function ensureChatRoomExists(page) {
  try {
    // 먼저 기존 채팅방이 있는지 확인
    await page.goto('https://chat.goorm-ktb-018.goorm.team/chat-rooms');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    // 기존 채팅방 목록 확인
    const existingRooms = await page.evaluate(() => {
      const rows = document.querySelectorAll('tbody tr');
      const roomNames = [];
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length > 0) {
          const roomName = cells[0].textContent.trim();
          // group_b로 시작하는 테스트 룸만 선택
          if (roomName.includes('group_b')) {
            roomNames.push(roomName);
          }
        }
      });
      return roomNames;
    });
    
    console.log('📋 Found existing test rooms:', existingRooms);
    
    // 기존 테스트 룸이 있으면 첫 번째 룸 사용
    if (existingRooms.length > 0) {
      chatName = existingRooms[0];
      console.log(`♻️ Reusing existing chat room: ${chatName}`);
      return chatName;
    }
    
    // 기존 룸이 없으면 새로 생성
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    chatName = `${group}_test_${timestamp}_${randomStr}`;
    
    console.log(`🆕 Creating new chat room: ${chatName}`);
    await createChat(page, chatName);
    
    // 채팅방 생성 후 충분한 대기 시간
    console.log('⏳ Waiting for room creation to be reflected...');
    await page.waitForTimeout(5000);
    
    // 채팅방 목록 페이지로 돌아가서 생성 확인
    await page.goto('https://chat.goorm-ktb-018.goorm.team/chat-rooms');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    // 생성된 채팅방이 목록에 있는지 여러 번 확인
    const maxVerifyAttempts = 5;
    let roomVerified = false;
    
    for (let attempt = 1; attempt <= maxVerifyAttempts; attempt++) {
      try {
        console.log(`🔍 Verifying chat room creation (attempt ${attempt}/${maxVerifyAttempts})...`);
        
        const roomExists = await page.evaluate((targetName) => {
          const rows = document.querySelectorAll('tbody tr');
          for (let row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length > 0) {
              const roomName = cells[0].textContent.trim();
              if (roomName === targetName) {
                return true;
              }
            }
          }
          return false;
        }, chatName);
        
        if (roomExists) {
          console.log(`✅ Chat room "${chatName}" verified in list`);
          roomVerified = true;
          break;
        } else {
          console.log(`❌ Chat room "${chatName}" not yet visible, waiting...`);
          await page.waitForTimeout(3000);
          // 페이지 새로고침
          await page.reload();
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(2000);
        }
      } catch (verifyError) {
        console.log(`⚠️ Verification attempt ${attempt} failed:`, verifyError.message);
        await page.waitForTimeout(2000);
      }
    }
    
    if (!roomVerified) {
      console.log(`⚠️ Could not verify room creation, but will try to proceed with: ${chatName}`);
      // 검증 실패해도 계속 진행 (룸이 실제로는 생성되었을 수 있음)
    }
    
    return chatName;
    
  } catch (error) {
    console.error('❌ Error in ensureChatRoomExists:', error.message);
    
    // 에러 발생 시 기존 룸 중 하나 사용
    try {
      await page.goto('https://chat.goorm-ktb-018.goorm.team/chat-rooms');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      
      const fallbackRoom = await page.evaluate(() => {
        const rows = document.querySelectorAll('tbody tr');
        for (let row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length > 0) {
            const roomName = cells[0].textContent.trim();
            // 아무 룸이나 사용
            return roomName;
          }
        }
        return null;
      });
      
      if (fallbackRoom) {
        chatName = fallbackRoom;
        console.log(`🔄 Using fallback room: ${chatName}`);
        return chatName;
      }
    } catch (fallbackError) {
      console.error('❌ Fallback also failed:', fallbackError.message);
    }
    
    throw new Error('No suitable chat room found');
  }
}

async function registerUser(page) {
  const id = `${group}_${Date.now()}`
  const email = id + domain;

  try {
    await page.goto(site);
    await page.waitForLoadState('networkidle');
  } catch (e) {
    console.error('Error during page navigation:', e);
    await browser.close();
  }

  await addUser(page, id, passwd, email);
};

async function loginUser(page) {
  await registerUser(page);
};

async function createNewChat(page) {
  await registerUser(page);
  await createChat(page, `${group}_${Date.now()}`);
};

async function scrollChat(page) {
  await registerUser(page);
  await scrollDown(page);
};

async function sendMessageToChat(page) {
  try {
    await registerUser(page);
    // 채팅방 생성 또는 확인
    await ensureChatRoomExists(page);
    await accessChat(page, chatName);
    await talkChat(page, msg);
  } catch (error) {
    if (error.message.includes('Session expired')) {
      console.log('Session expired during sendMessageToChat, re-authenticating...');
      await registerUser(page);
      await ensureChatRoomExists(page);
      await accessChat(page, chatName);
      await talkChat(page, msg);
    } else if (error.message.includes('No chat rooms available')) {
      console.log('No chat rooms available, creating a new one...');
      await ensureChatRoomExists(page);
      await accessChat(page, chatName);
      await talkChat(page, msg);
    } else {
      throw error;
    }
  }
};

async function reactionToMessage(page) {
  try {
    await registerUser(page);
    // 채팅방 생성 또는 확인
    await ensureChatRoomExists(page);
    await accessChat(page, chatName);
    await addReactions(page, findText);
  } catch (error) {
    if (error.message.includes('Session expired')) {
      console.log('Session expired during reactionToMessage, re-authenticating...');
      await registerUser(page);
      await ensureChatRoomExists(page);
      await accessChat(page, chatName);
      await addReactions(page, findText);
    } else if (error.message.includes('No chat rooms available')) {
      console.log('No chat rooms available, creating a new one...');
      await ensureChatRoomExists(page);
      await accessChat(page, chatName);
      await addReactions(page, findText);
    } else {
      throw error;
    }
  }
};

async function uploadFileToChat(page) {
  try {
    await registerUser(page);
    // 채팅방 생성 또는 확인
    await ensureChatRoomExists(page);
    await accessChat(page, chatName);
    await uploadFile(page, filename);
  } catch (error) {
    if (error.message.includes('Session expired')) {
      console.log('Session expired during uploadFileToChat, re-authenticating...');
      await registerUser(page);
      await ensureChatRoomExists(page);
      await accessChat(page, chatName);
      await uploadFile(page, filename);
    } else if (error.message.includes('No chat rooms available')) {
      console.log('No chat rooms available, creating a new one...');
      await ensureChatRoomExists(page);
      await accessChat(page, chatName);
      await uploadFile(page, filename);
    } else {
      throw error;
    }
  }
};

async function updateProfileImage(page) {
  try {
    await registerUser(page);
    await addProfileImage(page, filename);
  } catch (error) {
    if (error.message.includes('Session expired')) {
      console.log('Session expired during updateProfileImage, re-authenticating...');
      await registerUser(page);
      await addProfileImage(page, filename);
    } else {
      throw error;
    }
  }
};

async function generateChatAiResponse(page) {
  try {
    await registerUser(page);
    // 채팅방 생성 또는 확인
    await ensureChatRoomExists(page);
    await accessChat(page, chatName);
    await generateAiResponse(page, aiMention);
  } catch (error) {
    if (error.message.includes('Session expired')) {
      console.log('Session expired during generateChatAiResponse, re-authenticating...');
      await registerUser(page);
      await ensureChatRoomExists(page);
      await accessChat(page, chatName);
      await generateAiResponse(page, aiMention);
    } else if (error.message.includes('No chat rooms available')) {
      console.log('No chat rooms available, creating a new one...');
      await ensureChatRoomExists(page);
      await accessChat(page, chatName);
      await generateAiResponse(page, aiMention);
    } else {
      throw error;
    }
  }
};

module.exports = { registerUser, loginUser, createNewChat, scrollChat, sendMessageToChat, reactionToMessage, uploadFileToChat, updateProfileImage, generateChatAiResponse };

/* for test
let browserInstance = null;
let pageInstance = null;

const getPage = async () => {
  if (!browserInstance) {
    browserInstance = await chromium.launch({ headless: true });
    console.log("Browser launched");
  }

  if (!pageInstance) {
    pageInstance = await browserInstance.newPage();
    console.log("Page created");
    await pageInstance.goto(site);
  }
  return pageInstance;
};

const run = async () => {
  // await loginUser();
  // await createNewChat();
  // await scrollChat();
  // await sendMessageToChat();
  // await reactionToMessage();
  await uploadFileToChat();
  // await updateProfileImage();
  // await generateChatAiResponse();
};

const main = async () => {
  await run();

  if (browserInstance) {
    await browserInstance.close();
    console.log("Browser closed");
  }
};

main();
*/
