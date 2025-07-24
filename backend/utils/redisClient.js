// backend/utils/redisClient.js
const Redis = require('ioredis');

// 환경변수에서 클러스터 노드 정보(JSON 배열 문자열)를 읽어옴
// 예시: REDIS_CLUSTER_NODES='[{"host":"<IP>","port":6379},{"host":"<IP>","port":6379}]'
let clusterNodes;
try {
  clusterNodes = JSON.parse(process.env.REDIS_CLUSTER_NODES);
  if (!Array.isArray(clusterNodes) || clusterNodes.length === 0) {
    throw new Error('REDIS_CLUSTER_NODES is empty or not an array');
  }
} catch (e) {
  console.error('Invalid REDIS_CLUSTER_NODES environment variable:', e);
  clusterNodes = [];
}

// 비밀번호가 필요한 경우 환경변수에서 읽어옴
const redisPassword = process.env.REDIS_PASSWORD;

const redis = new Redis.Cluster(clusterNodes, {
  redisOptions: redisPassword ? { password: redisPassword } : {},
});

module.exports = redis;