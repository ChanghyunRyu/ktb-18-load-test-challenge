const addUser = async (page, id, passwd, email) => {
    // 페이지 로딩 대기
    await page.waitForLoadState('networkidle');
    
    await page.getByRole('button', { name: '회원가입' }).click();
    
    // 폼 필드가 나타날 때까지 대기
    await page.waitForSelector('input[placeholder="이름을 입력하세요"]');
    
    await page.getByPlaceholder('이름을 입력하세요').click();
    await page.getByPlaceholder('이름을 입력하세요').fill(id);
    await page.getByPlaceholder('이름을 입력하세요').press('Tab');
    await page.getByPlaceholder('이메일을 입력하세요').fill(email);
    await page.getByPlaceholder('이메일을 입력하세요').press('Tab');
    await page.getByPlaceholder('비밀번호를 입력하세요').fill(passwd);
    await page.getByPlaceholder('비밀번호를 입력하세요').press('Tab');
    await page.getByPlaceholder('비밀번호를 다시 입력하세요').fill(passwd);
    
    // 폼 안의 제출 버튼 클릭 (type="submit"인 버튼)
    await page.getByRole('button', { name: '회원가입' }).click();
    
    // 성공 모달이 나타날 때까지 대기
    await page.waitForSelector('text=지금 이동하기', { timeout: 10000 });
    await page.getByRole('button', { name: '지금 이동하기' }).click();
  
    console.info(email+ ' Registry Success');
  };
  
  const login = async (page, email, passwd) => {
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('이메일을 입력하세요').click();
    await page.getByPlaceholder('이메일을 입력하세요').fill(email);
    await page.getByPlaceholder('이메일을 입력하세요').press('Tab');
    await page.getByPlaceholder('비밀번호를 입력하세요').fill(passwd);
    
    // 로그인 폼의 제출 버튼 클릭
    await page.getByRole('button', { name: '로그인' }).click();
  
    // 채팅방 목록 페이지로 이동 대기
    await page.waitForURL('**/chat-rooms', { timeout: 10000 });
    console.info(email+ ' Login Success');
    await page.waitForTimeout(3000);
  };

  module.exports = { addUser, login };
  