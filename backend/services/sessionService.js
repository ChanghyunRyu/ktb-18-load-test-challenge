const redisClient = require('../utils/redisClient');
const crypto = require('crypto');

class SessionService {
  static SESSION_TTL = 24 * 60 * 60; // 24 hours
  static SESSION_PREFIX = 'session:';
  static SESSION_ID_PREFIX = 'sessionId:';
  static USER_SESSIONS_PREFIX = 'user_sessions:';
  static ACTIVE_SESSION_PREFIX = 'active_session:';

  // 안전한 JSON 직렬화
  static safeStringify(data) {
    try {
      if (typeof data === 'string') return data;
      return JSON.stringify(data);
    } catch (error) {
      console.error('JSON stringify error:', error);
      return '';
    }
  }

  // 안전한 JSON 파싱
  static safeParse(value) {
    try {
      if (!value) return null;
      if (typeof value === 'object') return value;
      return JSON.parse(value);
    } catch (error) {
      console.error('JSON parse error:', error);
      return null;
    }
  }

  // 세션 키 생성 함수들
  static getSessionKey(userId) {
    return `${this.SESSION_PREFIX}${userId}`;
  }

  static getSessionIdKey(sessionId) {
    return `${this.SESSION_ID_PREFIX}${sessionId}`;
  }

  static getUserSessionsKey(userId) {
    return `${this.USER_SESSIONS_PREFIX}${userId}`;
  }

  static getActiveSessionKey(userId) {
    return `${this.ACTIVE_SESSION_PREFIX}${userId}`;
  }

  // Redis에 데이터 저장 전 JSON 문자열로 변환
  static async setJson(key, value, ttl) {
    try {
      const jsonString = this.safeStringify(value);
      if (!jsonString) {
        console.error('Failed to stringify value:', value);
        return false;
      }

      if (ttl) {
        await redisClient.setEx(key, ttl, jsonString);
      } else {
        await redisClient.set(key, jsonString);
      }
      return true;
    } catch (error) {
      console.error('Redis setJson error:', error);
      // Redis 실패 시 에러를 던지지 않고 false 반환
      return false;
    }
  }

  // Redis에서 데이터를 가져와서 JSON으로 파싱
  static async getJson(key) {
    try {
      const value = await redisClient.get(key);
      return this.safeParse(value);
    } catch (error) {
      console.error('Redis getJson error:', error);
      // Redis 실패 시 에러를 던지지 않고 null 반환
      return null;
    }
  }

  static generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
  }

  static async createSession(userId, metadata = {}) {
    try {
      // 기존 세션들 모두 제거 (에러 무시)
      try {
        await this.removeAllUserSessions(userId);
      } catch (removeError) {
        console.error('Failed to remove existing sessions (ignored):', removeError);
      }

      const sessionId = this.generateSessionId();
      const sessionData = {
        userId,
        sessionId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        metadata: {
          userAgent: metadata.userAgent || '',
          ipAddress: metadata.ipAddress || '',
          deviceInfo: metadata.deviceInfo || '',
          ...metadata
        }
      };

      const sessionKey = this.getSessionKey(userId);
      const sessionIdKey = this.getSessionIdKey(sessionId);
      const userSessionsKey = this.getUserSessionsKey(userId);
      const activeSessionKey = this.getActiveSessionKey(userId);

      // 세션 데이터 저장 (에러 시에도 계속 진행)
      const saved = await this.setJson(sessionKey, sessionData, this.SESSION_TTL);
      if (!saved) {
        console.warn('Failed to save session data to Redis, but continuing...');
      }

      // 세션 ID 매핑 저장 (에러 무시)
      try {
        await redisClient.setEx(sessionIdKey, this.SESSION_TTL, userId.toString());
        await redisClient.setEx(userSessionsKey, this.SESSION_TTL, sessionId);
        await redisClient.setEx(activeSessionKey, this.SESSION_TTL, sessionId);
      } catch (redisError) {
        console.error('Redis mapping storage failed (ignored):', redisError);
      }

      // 세션은 항상 성공으로 반환 (Redis 실패해도)
      return {
        sessionId,
        expiresIn: this.SESSION_TTL,
        sessionData
      };

    } catch (error) {
      console.error('Session creation error:', error);
      
      // 최후의 수단: 기본 세션 반환
      const fallbackSessionId = this.generateSessionId();
      console.warn('Creating fallback session due to Redis issues');
      
      return {
        sessionId: fallbackSessionId,
        expiresIn: this.SESSION_TTL,
        sessionData: {
          userId,
          sessionId: fallbackSessionId,
          createdAt: Date.now(),
          lastActivity: Date.now(),
          metadata
        }
      };
    }
  }

  static async validateSession(userId, sessionId) {
    try {
      if (!userId || !sessionId) {
        return {
          isValid: false,
          error: 'INVALID_PARAMETERS',
          message: '유효하지 않은 세션 파라미터'
        };
      }

      // 활성 세션 확인 (Redis 실패 시 세션을 유효한 것으로 간주)
      let activeSessionId = null;
      try {
        const activeSessionKey = this.getActiveSessionKey(userId);
        activeSessionId = await redisClient.get(activeSessionKey);
      } catch (redisError) {
        console.error('Redis activeSession check failed, allowing session:', redisError);
        // Redis 실패 시 세션을 유효한 것으로 간주
        return {
          isValid: true,
          session: {
            userId,
            sessionId,
            lastActivity: Date.now(),
            isRedisDown: true
          }
        };
      }

      // Redis가 정상이지만 activeSessionId가 다른 경우에만 실패 처리
      if (activeSessionId !== null && activeSessionId !== sessionId) {
        console.log('Session validation failed:', {
          userId,
          sessionId,
          activeSessionId
        });
        return {
          isValid: false,
          error: 'INVALID_SESSION',
          message: '다른 기기에서 로그인되어 현재 세션이 만료되었습니다.'
        };
      }

      // 세션 데이터 검증 (Redis 실패 시 기본 세션 데이터 반환)
      let sessionData = null;
      try {
        const sessionKey = this.getSessionKey(userId);
        sessionData = await this.getJson(sessionKey);
      } catch (redisError) {
        console.error('Redis sessionData check failed, creating fallback:', redisError);
        // Redis 실패 시 기본 세션 데이터 생성
        sessionData = {
          userId,
          sessionId,
          createdAt: Date.now() - (60 * 60 * 1000), // 1시간 전 생성으로 가정
          lastActivity: Date.now(),
          isRedisDown: true
        };
      }

      if (!sessionData) {
        // Redis가 정상인데 세션 데이터가 없는 경우
        return {
          isValid: false,
          error: 'SESSION_NOT_FOUND',
          message: '세션을 찾을 수 없습니다.'
        };
      }

      // 세션 만료 시간 검증
      const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24시간
      if (Date.now() - sessionData.lastActivity > SESSION_TIMEOUT) {
        try {
          await this.removeSession(userId);
        } catch (removeError) {
          console.error('Failed to remove expired session (ignored):', removeError);
        }
        return {
          isValid: false,
          error: 'SESSION_EXPIRED',
          message: '세션이 만료되었습니다.'
        };
      }

      // 세션 데이터 갱신 (Redis 실패해도 무시)
      sessionData.lastActivity = Date.now();
      
      try {
        const sessionKey = this.getSessionKey(userId);
        await this.setJson(sessionKey, sessionData, this.SESSION_TTL);

        // 관련 키들의 만료 시간 갱신
        const activeSessionKey = this.getActiveSessionKey(userId);
        await Promise.all([
          redisClient.expire(activeSessionKey, this.SESSION_TTL),
          redisClient.expire(this.getUserSessionsKey(userId), this.SESSION_TTL),
          redisClient.expire(this.getSessionIdKey(sessionId), this.SESSION_TTL)
        ]);
      } catch (updateError) {
        console.error('Failed to update session data (ignored):', updateError);
        // 업데이트 실패해도 세션은 유효한 것으로 처리
      }

      return {
        isValid: true,
        session: sessionData
      };

    } catch (error) {
      console.error('Session validation error:', error);
      
      // 최후의 수단: 세션을 유효한 것으로 간주
      console.warn('Session validation failed, but allowing access due to Redis issues');
      return {
        isValid: true,
        session: {
          userId,
          sessionId,
          lastActivity: Date.now(),
          isRedisDown: true,
          fallback: true
        }
      };
    }
  }

  static async removeSession(userId, sessionId = null) {
    try {
      const userSessionsKey = this.getUserSessionsKey(userId);
      const activeSessionKey = this.getActiveSessionKey(userId);

      if (sessionId) {
        const currentSessionId = await redisClient.get(userSessionsKey);
        if (currentSessionId === sessionId) {
          await Promise.all([
            redisClient.del(this.getSessionKey(userId)),
            redisClient.del(this.getSessionIdKey(sessionId)),
            redisClient.del(userSessionsKey),
            redisClient.del(activeSessionKey)
          ]);
        }
      } else {
        const storedSessionId = await redisClient.get(userSessionsKey);
        if (storedSessionId) {
          await Promise.all([
            redisClient.del(this.getSessionKey(userId)),
            redisClient.del(this.getSessionIdKey(storedSessionId)),
            redisClient.del(userSessionsKey),
            redisClient.del(activeSessionKey)
          ]);
        }
      }
    } catch (error) {
      console.error('Session removal error:', error);
      throw error;
    }
  }

  static async removeAllUserSessions(userId) {
    try {
      const activeSessionKey = this.getActiveSessionKey(userId);
      const userSessionsKey = this.getUserSessionsKey(userId);
      const sessionId = await redisClient.get(userSessionsKey);

      const deletePromises = [
        redisClient.del(activeSessionKey),
        redisClient.del(userSessionsKey)
      ];

      if (sessionId) {
        deletePromises.push(
          redisClient.del(this.getSessionKey(userId)),
          redisClient.del(this.getSessionIdKey(sessionId))
        );
      }

      await Promise.all(deletePromises);
      return true;
    } catch (error) {
      console.error('Remove all user sessions error:', error);
      return false;
    }
  }

  static async updateLastActivity(userId) {
    try {
      if (!userId) {
        console.error('updateLastActivity: userId is required');
        return false;
      }

      const sessionKey = this.getSessionKey(userId);
      const sessionData = await this.getJson(sessionKey);

      if (!sessionData) {
        console.error('updateLastActivity: No session found for user', userId);
        return false;
      }

      // 세션 데이터 갱신
      sessionData.lastActivity = Date.now();
      
      // 갱신된 세션 데이터 저장
      const updated = await this.setJson(sessionKey, sessionData, this.SESSION_TTL);
      if (!updated) {
        console.error('updateLastActivity: Failed to update session data');
        return false;
      }

      // 관련 키들의 만료 시간도 함께 갱신
      const activeSessionKey = this.getActiveSessionKey(userId);
      const userSessionsKey = this.getUserSessionsKey(userId);
      if (sessionData.sessionId) {
        const sessionIdKey = this.getSessionIdKey(sessionData.sessionId);
        await Promise.all([
          redisClient.expire(activeSessionKey, this.SESSION_TTL),
          redisClient.expire(userSessionsKey, this.SESSION_TTL),
          redisClient.expire(sessionIdKey, this.SESSION_TTL)
        ]);
      }

      return true;

    } catch (error) {
      console.error('Update last activity error:', error);
      return false;
    }
  }  
  
  static async getActiveSession(userId) {
    try {
      if (!userId) {
        console.error('getActiveSession: userId is required');
        return null;
      }

      const activeSessionKey = this.getActiveSessionKey(userId);
      const sessionId = await redisClient.get(activeSessionKey);

      if (!sessionId) {
        return null;
      }

      const sessionKey = this.getSessionKey(userId);
      const sessionData = await this.getJson(sessionKey);

      if (!sessionData) {
        await redisClient.del(activeSessionKey);
        return null;
      }

      return {
        ...sessionData,
        userId,
        sessionId
      };
    } catch (error) {
      console.error('Get active session error:', error);
      return null;
    }
  }

  // refreshSession 메서드 추가
  static async refreshSession(userId, sessionId) {
    try {
      if (!userId || !sessionId) {
        console.error('refreshSession: userId and sessionId are required');
        return false;
      }

      // 세션 활동 시간만 업데이트
      return await this.updateLastActivity(userId);
    } catch (error) {
      console.error('Session refresh error:', error);
      return false;
    }
  }
}

module.exports = SessionService;