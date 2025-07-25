import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Image from 'next/image';
import { Button, Avatar, Text } from '@vapor-ui/core';
import { Flex, HStack, Box, Container } from './ui/Layout';
import authService from '../services/authService';

const Navbar = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const router = useRouter();

  // 인증 상태 변경을 감지하는 효과
  useEffect(() => {
    const checkAuth = () => {
      const user = authService.getCurrentUser();
      console.log('=== Navbar 사용자 정보 확인 ===');
      console.log('가져온 사용자:', user);
      console.log('profileImage:', user?.profileImage);
      console.log('profileImage 타입:', typeof user?.profileImage);
      if (user?.profileImage) {
        console.log('profileImage 시작 부분:', user.profileImage.substring(0, 30));
        console.log('http로 시작하는지:', user.profileImage.startsWith('http'));
      }
      console.log('=============================');
      setCurrentUser(user);
    };

    // 초기 인증 상태 확인
    checkAuth();

    // authStateChange 이벤트 리스너 등록
    const handleAuthChange = () => {
      checkAuth();
    };

    // userProfileUpdate 이벤트 리스너 등록
    const handleProfileUpdate = () => {
      checkAuth();
    };

    window.addEventListener('authStateChange', handleAuthChange);
    window.addEventListener('userProfileUpdate', handleProfileUpdate);

    // 정리 함수
    return () => {
      window.removeEventListener('authStateChange', handleAuthChange);
      window.removeEventListener('userProfileUpdate', handleProfileUpdate);
    };
  }, []);

  const handleNavigation = (path) => {
    router.push(path);
  };

  const handleLogout = async () => {
    await authService.logout();
    // 로그아웃 후 authStateChange 이벤트 발생
    window.dispatchEvent(new Event('authStateChange'));
  };

  // 프로필 이미지 URL 처리
  const getProfileImageSrc = (profileImage) => {
    console.log('=== getProfileImageSrc 처리 ===');
    console.log('입력 profileImage:', profileImage);
    
    if (!profileImage) {
      console.log('profileImage가 없음, undefined 반환');
      return undefined;
    }
    
    // 이미 완전한 URL인 경우 (S3 URL 등)
    if (profileImage.startsWith('http')) {
      console.log('http로 시작함, 그대로 반환:', profileImage);
      return profileImage;
    }
    
    // 로컬 파일 경로인 경우
    const result = `${process.env.NEXT_PUBLIC_API_URL}${profileImage}`;
    console.log('로컬 파일로 처리, 결과:', result);
    console.log('==============================');
    return result;
  };

  const isInChatRooms = router.pathname === '/chat-rooms';

  return (
    <nav>
      <Container>
        <Flex justify="space-between" align="center">
          {/* Logo */}
          <Box>
            <div 
              onClick={() => handleNavigation(currentUser ? '/chat-rooms' : '/')}
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleNavigation(currentUser ? '/chat-rooms' : '/');
                }
              }}
            >
              <Image
                src="/images/logo.png"
                alt="Chat App Logo"
                width={240}
                height={81}
                style={{ objectFit: 'contain' }}
                priority
              />
            </div>
          </Box>

          {/* Navigation Menu */}
          <Box>
            {currentUser && (
              <HStack gap="150">
                <Button
                  color="primary"
                  size="md"
                  onClick={() => handleNavigation('/chat-rooms')}
                >
                  채팅방 목록
                </Button>
                <Button
                  color="primary"
                  size="md"
                  onClick={() => handleNavigation('/chat-rooms/new')}
                >
                  새 채팅방
                </Button>
              </HStack>
            )}
          </Box>

          {/* User Menu */}
          <Box>
            {currentUser ? (
              <HStack gap="150" align="center">
                {/* Profile Image */}
                <Avatar.Root
                  size="md"
                  style={{ flexShrink: 0 }}
                  src={getProfileImageSrc(currentUser.profileImage)}
                >
                  <Avatar.Image />
                  <Avatar.Fallback>{currentUser.name?.[0]?.toUpperCase()}</Avatar.Fallback>
                </Avatar.Root>
                
                {/* Member Name */}
                <Text typography="body2" style={{ fontWeight: 500 }}>
                  {currentUser.name}
                </Text>
                
                {/* Profile Button */}
                <Button
                  size="md"
                  onClick={() => handleNavigation('/profile')}
                >
                  프로필
                </Button>
                
                {/* Logout Button */}
                <Button
                  color="danger"
                  size="md"
                  onClick={handleLogout}
                >
                  로그아웃
                </Button>
              </HStack>
            ) : (
              <HStack gap="150">
                <Button
                  size="md"
                  onClick={() => handleNavigation('/')}
                >
                  로그인
                </Button>
                <Button
                  size="md"
                  onClick={() => handleNavigation('/register')}
                >
                  회원가입
                </Button>
              </HStack>
            )}
          </Box>
        </Flex>
      </Container>
    </nav>
  );
};

export default Navbar;