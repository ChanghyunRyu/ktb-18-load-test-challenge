// backend/utils/redisClient.js
const Redis = require('ioredis');

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

  redis = new Redis.Cluster(clusterNodes, {
    redisOptions: process.env.REDIS_PASSWORD
      ? { password: process.env.REDIS_PASSWORD }
      : {},
  });
} else {
  // 단일 Redis 모드
  redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  });
}

module.exports = redis;
