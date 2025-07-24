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
    clusterNodes = [];
  }

  // Redis v4 클러스터 문법
  const rootNodes = clusterNodes.map(node => ({
    url: `redis://${node.host}:${node.port}`
  }));

  redis = createCluster({
    rootNodes,
    defaults: {
      password: process.env.REDIS_PASSWORD || undefined
    }
  });
} else {
  // 단일 Redis 모드
  redis = createClient({
    url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`,
    password: process.env.REDIS_PASSWORD || undefined
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

// Redis 연결
redis.connect().catch(err => {
  console.error('Redis initial connection failed:', err.message);
});

// Redis 연결 상태 확인 함수
const checkRedisConnection = async () => {
  try {
    await redis.ping();
    console.log('Redis Client: Connection test successful');
    return true;
  } catch (error) {
    console.error('Redis Client: Connection test failed:', error.message);
    return false;
  }
};

// Redis 클라이언트와 연결 체크 함수 내보내기
module.exports = redis;
module.exports.checkRedisConnection = checkRedisConnection;
