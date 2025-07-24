import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Text } from '@vapor-ui/core';
import authService from '../services/authService';

export const withAuth = (WrappedComponent) => {
  const WithAuthComponent = (props) => {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
      const checkAuth = () => {
        const user = authService.getCurrentUser();
        if (!user) {
          // 이미 로그인 페이지에 있으면 리다이렉트하지 않음
          if (router.pathname !== '/') {
          router.replace('/?redirect=' + router.asPath);
          } else {
            setIsLoading(false);
          }
        } else {
          setIsLoading(false);
        }
      };

      checkAuth();
    }, [router]);

    if (isLoading) {
      return null;
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

    useEffect(() => {
      const checkAuth = async () => {
        // 라우터가 준비될 때까지 대기
        if (!router.isReady) {
          return;
        }
        
        const user = authService.getCurrentUser();
        if (user && router.pathname === '/') {
          // 세션 검증 후 리다이렉트 (무한 루프 방지)
          try {
            await authService.verifyToken();
          await router.replace('/chat-rooms');
          } catch (error) {
            console.log('Session invalid, staying on login page');
            authService.logout();
            setIsLoading(false);
          }
        } else {
          setIsLoading(false);
        }
      };

      checkAuth();
    }, [router, router.isReady]);

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
          <Text typography="body1">Loading...</Text>
        </div>
      );
    }

    return <WrappedComponent {...props} />;
  };

  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component';
  WithoutAuthComponent.displayName = `WithoutAuth(${displayName})`;

  return WithoutAuthComponent;
};