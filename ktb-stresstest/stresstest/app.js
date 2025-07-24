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
    // 새 채팅방 생성
    chatName = `${group}_test_${Date.now()}`;
    await createChat(page, chatName);
    console.log(`Created chat room: ${chatName}`);
    return chatName;
  } catch (error) {
    console.error('Failed to create chat room:', error);
    // 기본 채팅방 이름 사용
    chatName = "asdfasdf";
    return chatName;
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
