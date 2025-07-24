require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const { router: roomsRouter, initializeSocket } = require('./routes/api/rooms');
const routes = require('./routes');
const { connectRedis, checkRedisConnection } = require('./utils/redisClient');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient, createCluster } = require('redis');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// trust proxy 설정 추가
app.set('trust proxy', 1);

// CORS 설정
const corsOptions = {
  origin: [
    'https://bootcampchat-fe.run.goorm.site',
    'https://bootcampchat-hgxbv.dev-k8s.arkain.io',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'https://localhost:3000',
    'https://localhost:3001',
    'https://localhost:3002',
    'http://0.0.0.0:3000',
    "https://chat.goorm-ktb-018.goorm.team",
    'https://0.0.0.0:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'x-auth-token', 
    'x-session-id',
    'Cache-Control',
    'Pragma'
  ],
  exposedHeaders: ['x-auth-token', 'x-session-id']
};

// 기본 미들웨어
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OPTIONS 요청에 대한 처리
app.options('*', cors(corsOptions));

// 정적 파일 제공
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 요청 로깅
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
  });
}

// 기본 상태 체크
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV
  });
});

// API 라우트 마운트
app.use('/api', routes);

// Socket.IO 설정 (Redis 연결 후 Adapter 설정)
const io = socketIO(server, { cors: corsOptions });

require('./sockets/chat')(io);

// Socket.IO 객체 전달
initializeSocket(io);

// 404 에러 핸들러
app.use((req, res) => {
  console.log('404 Error:', req.originalUrl);
  res.status(404).json({
    success: false,
    message: '요청하신 리소스를 찾을 수 없습니다.',
    path: req.originalUrl
  });
});

// 글로벌 에러 핸들러
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || '서버 에러가 발생했습니다.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const setupSocketIORedisAdapter = async () => {
  try {
    if (process.env.NODE_ENV === 'development') {
      console.log('🔄 Setting up Socket.IO Redis Adapter...');
    }
    
    if (process.env.REDIS_CLUSTER_MODE === 'true') {
      if (process.env.NODE_ENV === 'development') {
        console.log('Setting up Socket.IO Redis Cluster Adapter...');
      }
      
      // 클러스터 노드 파싱
      let clusterNodes;
      try {
        clusterNodes = JSON.parse(process.env.REDIS_CLUSTER_NODES);
        if (!Array.isArray(clusterNodes) || clusterNodes.length === 0) {
          throw new Error('REDIS_CLUSTER_NODES is empty or invalid');
        }
      } catch (e) {
        console.error('Invalid REDIS_CLUSTER_NODES for Socket.IO:', e);
        return false;
      }

      // Socket.IO용 Redis 클러스터 클라이언트 생성 (기존과 동일한 설정)
      const rootNodes = clusterNodes.map(node => ({
        url: `redis://${node.host}:${node.port}`
      }));

      const pubClient = createCluster({
        rootNodes: rootNodes
      });

      const subClient = pubClient.duplicate();

      // 연결
      await pubClient.connect();
      await subClient.connect();

      // Socket.IO Redis Adapter 설정
      io.adapter(createAdapter(pubClient, subClient));
      
      if (process.env.NODE_ENV === 'development') {
        console.log('✅ Socket.IO Redis Cluster Adapter: Connected successfully');
      }
      return true;
      
    } else {
      if (process.env.NODE_ENV === 'development') {
        console.log('Setting up Socket.IO Single Redis Adapter...');
      }
      
      // 단일 Redis 모드
      const host = process.env.REDIS_HOST || '127.0.0.1';
      const port = process.env.REDIS_PORT || 6379;
      const password = process.env.REDIS_PASSWORD;
      
      let url = `redis://${host}:${port}`;
      if (password) {
        url = `redis://:${password}@${host}:${port}`;
      }
      
      const pubClient = createClient({ 
        url,
        socket: {
          family: 4,
          connectTimeout: 10000,
          reconnectStrategy: (retries) => Math.min(retries * 50, 2000)
        }
      });
      
      const subClient = pubClient.duplicate();
      
      // 연결
      await pubClient.connect();
      await subClient.connect();
      
      // Socket.IO Redis Adapter 설정
      io.adapter(createAdapter(pubClient, subClient));
      
      if (process.env.NODE_ENV === 'development') {
        console.log('✅ Socket.IO Single Redis Adapter: Connected successfully');
      }
      return true;
    }
  } catch (error) {
    console.error('❌ Failed to setup Socket.IO Redis Adapter:', error.message);
    if (process.env.NODE_ENV === 'development') {
      console.log('🔄 Using default in-memory adapter (limited to single server)');
    }
    return false;
  }
};

// 서버 시작 - MongoDB와 Redis 연결 확인
const startServer = async () => {
  try {
    console.log('🚀 SERVER VERSION: v2.2.1 - Socket.IO Redis Adapter Enabled');
    
    // MongoDB 연결
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected');

    // Redis 연결 (필수) - 실패 시 서버 시작 중단
    await connectRedis();

    // Socket.IO Redis Adapter 설정
    const socketIOAdapterSuccess = await setupSocketIORedisAdapter();
    if (!socketIOAdapterSuccess && process.env.NODE_ENV === 'development') {
      console.log('🚀 Socket.IO using default in-memory adapter');
    }

    // 서버 시작
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
      console.log('Environment:', process.env.NODE_ENV);
      
      if (process.env.NODE_ENV === 'development') {
        console.log('API Base URL:', `http://0.0.0.0:${PORT}/api`);
        
        // 연결 상태 요약
        console.log('\n=== Connection Status ===');
        console.log('MongoDB: ✅ Connected');
        console.log('Redis (Sessions): ✅ Connected');
        console.log(`Socket.IO: ${socketIOAdapterSuccess ? '✅ Redis Adapter (Cluster)' : '✅ In-Memory Adapter'}`);
        console.log('=========================\n');
      }
    });
  } catch (err) {
    console.error('❌ Server startup error:', err.message);
    
    // Redis 연결 실패 시 구체적인 안내
    if (err.message.includes('Redis connection failed')) {
      console.error('\n💡 Redis 연결이 필요합니다:');
      console.error('1. Redis 서버가 실행 중인지 확인');
      console.error('2. 환경변수 REDIS_CLUSTER_NODES 확인');
      console.error('3. 네트워크 연결 상태 확인\n');
    }
    
    process.exit(1);
  }
};

startServer();

module.exports = { app, server };