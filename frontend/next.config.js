/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // 에러 처리 문제 해결을 위해 일시적으로 비활성화
  output: 'export', // 정적 사이트 생성
  images: {
    unoptimized: true, // 이미지 최적화 비활성화
  },
  transpilePackages: ['@vapor-ui/core', '@vapor-ui/icons'],
  // 개발 환경에서의 에러 오버레이 설정
  devIndicators: {
    buildActivity: true,
    buildActivityPosition: 'bottom-right'
  },
  // AWS SDK 브라우저 호환성을 위한 webpack 설정
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // AWS SDK 브라우저 호환성 개선
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        path: false,
      };
    }

    // AWS SDK 모듈들을 외부로 처리하지 않도록 설정
    config.externals = config.externals || [];
    
    return config;
  },
  // 개발 환경에서만 더 자세한 에러 로깅
  ...(process.env.NODE_ENV === 'development' && {
    experimental: {
      forceSwcTransforms: true
    }
  })
};

module.exports = nextConfig;