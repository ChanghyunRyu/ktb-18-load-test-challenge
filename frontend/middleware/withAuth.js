import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Text } from '@vapor-ui/core';
import authService from '../services/authService';

export const withAuth = (WrappedComponent) => {
  const WithAuthComponent = (props) => {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [authChecked, setAuthChecked] = useState(false);

    useEffect(() => {
      const checkAuth = async () => {
        try {
          const user = authService.getCurrentUser();
          
          if (!user) {
            console.log('[withAuth] No user found, redirecting to login');
            // 이미 로그인 페이지에 있으면 리다이렉트하지 않음
            if (router.pathname !== '/') {
              await router.replace('/?redirect=' + encodeURIComponent(router.asPath));
            } else {
              setIsLoading(false);
            }
            return;
          }

          // 토큰 유효성 검증 (네트워크 오류는 무시)
          try {
            await authService.verifyToken();
            console.log('[withAuth] Token verification successful');
            setIsLoading(false);
          } catch (verifyError) {
            console.error('[withAuth] Token verification failed:', verifyError);
            
            // 네트워크 오류가 아닌 경우만 로그아웃 처리
            if (verifyError.message.includes('세션이 만료') || 
                verifyError.message.includes('인증')) {
              console.log('[withAuth] Authentication failed, logging out');
              authService.logout();
              if (router.pathname !== '/') {
                await router.replace('/?error=session_expired');
              }
            } else {
              // 네트워크 오류는 기존 세션 유지
              console.log('[withAuth] Network error during verification, keeping session');
              setIsLoading(false);
            }
          }
        } catch (error) {
          console.error('[withAuth] Auth check error:', error);
          setIsLoading(false);
        } finally {
          setAuthChecked(true);
        }
      };

      if (router.isReady && !authChecked) {
        checkAuth();
      }
    }, [router, authChecked]);

    // 인증 상태 변경 감지
    useEffect(() => {
      const handleAuthStateChange = () => {
        console.log('[withAuth] Auth state changed');
        setAuthChecked(false);
      };

      window.addEventListener('authStateChange', handleAuthStateChange);
      return () => {
        window.removeEventListener('authStateChange', handleAuthStateChange);
      };
    }, []);

    if (isLoading) {
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: 'var(--vapor-color-background)',
          color: 'var(--vapor-color-text-primary)'
        }}>
          <Text typography="body1">인증 확인 중...</Text>
        </div>
      );
    }

    return <WrappedComponent {...props} />;
  };

  // HOC에 displayName 설정
  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component';
  WithAuthComponent.displayName = `WithAuth(${displayName})`;

  return WithAuthComponent;
};

export const withoutAuth = (WrappedComponent) => {
  const WithoutAuthComponent = (props) => {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [authChecked, setAuthChecked] = useState(false);

    useEffect(() => {
      const checkAuth = async () => {
        // 라우터가 준비될 때까지 대기
        if (!router.isReady) {
          return;
        }
        
        try {
          const user = authService.getCurrentUser();
          
          if (user && router.pathname === '/') {
            console.log('[withoutAuth] User found, verifying session');
            // 세션 검증 후 리다이렉트 (무한 루프 방지)
            try {
              await authService.verifyToken();
              console.log('[withoutAuth] Session valid, redirecting to chat-rooms');
              await router.replace('/chat-rooms');
              return;
            } catch (error) {
              console.log('[withoutAuth] Session invalid, staying on login page:', error.message);
              
              // 네트워크 오류가 아닌 경우만 로그아웃
              if (error.message.includes('세션이 만료') || 
                  error.message.includes('인증')) {
                authService.logout();
              }
              setIsLoading(false);
            }
          } else {
            console.log('[withoutAuth] No user or not on login page');
            setIsLoading(false);
          }
        } catch (error) {
          console.error('[withoutAuth] Auth check error:', error);
          setIsLoading(false);
        } finally {
          setAuthChecked(true);
        }
      };

      if (!authChecked) {
        checkAuth();
      }
    }, [router, router.isReady, authChecked]);

    // 인증 상태 변경 감지
    useEffect(() => {
      const handleAuthStateChange = () => {
        console.log('[withoutAuth] Auth state changed');
        setAuthChecked(false);
      };

      window.addEventListener('authStateChange', handleAuthStateChange);
      return () => {
        window.removeEventListener('authStateChange', handleAuthStateChange);
      };
    }, []);

    if (isLoading) {
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: 'var(--vapor-color-background)',
          color: 'var(--vapor-color-text-primary)'
        }}>
          <Text typography="body1">로딩 중...</Text>
        </div>
      );
    }

    return <WrappedComponent {...props} />;
  };

  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component';
  WithoutAuthComponent.displayName = `WithoutAuth(${displayName})`;

  return WithoutAuthComponent;
};