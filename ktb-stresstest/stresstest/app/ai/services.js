const generateAiResponse = async (page, aiMention) => {
  const messageInput = await page.getByPlaceholder('메시지를 입력하세요... (@를 입력하여 멘션,');
  await messageInput.fill(`${aiMention} hi`);

  const sendButton = await page.getByRole('button', { name: '보내기' });
  await sendButton.click();

  console.info('AI response generated.');
  await page.waitForTimeout(5000);
};

module.exports = { generateAiResponse };