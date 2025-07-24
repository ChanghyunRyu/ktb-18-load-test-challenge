# Node.js 18 LTS 사용
FROM node:18-alpine

# 작업 디렉토리 설정
WORKDIR /app

# 시스템 패키지 업데이트 및 필요한 도구 설치
RUN apk update && apk add --no-cache \
    curl \
    && rm -rf /var/cache/apk/*

# package.json과 package-lock.json 복사 (캐싱 최적화)
COPY package*.json ./

# 의존성 설치
RUN npm ci --only=production && npm cache clean --force

# 애플리케이션 코드 복사
COPY . .

# uploads 디렉토리 생성 및 권한 설정
RUN mkdir -p uploads && \
    chmod 755 uploads

# 포트 노출
EXPOSE 5000

# 비특권 사용자로 실행하기 위한 설정
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001 -G nodejs

# uploads 디렉토리 소유권 변경
RUN chown -R nodeuser:nodejs /app/uploads

# 사용자 변경
USER nodeuser

# 헬스체크 추가
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# 애플리케이션 시작
CMD ["npm", "start"] 