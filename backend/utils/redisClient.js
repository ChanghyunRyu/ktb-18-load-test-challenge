// backend/utils/redisClient.js
const { createClient, createCluster } = require('redis');

let redis;

if (process.env.REDIS_CLUSTER_MODE === 'true') {
  // 클러스터 모드
  let clusterNodes;
  try {
    clusterNodes = JSON.parse(process.env.REDIS_CLUSTER_NODES);
    if (!Array.isArray(clusterNodes) || clusterNodes.length === 0) {
      throw new Error('REDIS_CLUSTER_NODES is empty or invalid');
    }
  } catch (e) {
    console.error('Invalid REDIS_CLUSTER_NODES:', e);
    throw new Error('REDIS_CLUSTER_NODES configuration error');
  }

  // 정확한 Redis v4 클러스터 문법
  const rootNodes = clusterNodes.map(node => ({
    url: `redis://${node.host}:${node.port}`
  }));

  redis = createCluster({
    rootNodes: rootNodes
  });

} else {
  // 단일 Redis 모드 
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = process.env.REDIS_PORT || 6379;
  const password = process.env.REDIS_PASSWORD;
  
  let url = `redis://${host}:${port}`;
  if (password) {
    url = `redis://:${password}@${host}:${port}`;
  }
  
  redis = createClient({ 
    url,
    socket: {
      family: 4, // IPv4 강제 사용
      connectTimeout: 10000,
      reconnectStrategy: (retries) => Math.min(retries * 50, 2000)
    }
  });
}

// Redis 연결 이벤트 리스너
redis.on('connect', () => {
  console.log('Redis Client: Connection established');
});

redis.on('ready', () => {
  console.log('Redis Client: Ready to receive commands');
});

redis.on('error', (error) => {
  console.error('Redis Client: Connection error:', error.message);
});

redis.on('end', () => {
  console.log('Redis Client: Connection ended');
});

redis.on('reconnecting', () => {
  console.log('Redis Client: Attempting to reconnect...');
});

// 동기적 Redis 연결 함수 (서버 시작 전 필수 실행)
const connectRedis = async () => {
  try {
    console.log('🔄 Connecting to Redis...');
    await redis.connect();
    
    // 연결 테스트 - ping() 대신 set/get 사용
    const testKey = `test_connection_${Date.now()}`;
    await redis.set(testKey, 'test_value');
    const testValue = await redis.get(testKey);
    await redis.del(testKey); // 테스트 키 삭제
    
    if (testValue === 'test_value') {
      console.log('✅ Redis: Connection successful and tested');
      return true;
    } else {
      throw new Error('Redis set/get test failed');
    }
  } catch (error) {
    console.error('❌ Redis: Connection FAILED:', error.message);
    throw new Error(`Redis connection failed: ${error.message}`);
  }
};

// Redis 연결 상태 확인 함수 (단순화)
const checkRedisConnection = async () => {
  try {
    if (!redis.isReady) {
      return false;
    }
    // ping() 대신 간단한 set/get 테스트
    const testKey = `health_check_${Date.now()}`;
    await redis.set(testKey, 'ok');
    const result = await redis.get(testKey);
    await redis.del(testKey);
    return result === 'ok';
  } catch (error) {
    return false;
  }
};

// Redis 클라이언트와 연결 함수들 내보내기
module.exports = redis;
module.exports.connectRedis = connectRedis;
module.exports.checkRedisConnection = checkRedisConnection;
