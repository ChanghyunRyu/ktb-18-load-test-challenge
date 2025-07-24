const Message = require('../models/Message');
const Room = require('../models/Room');
const User = require('../models/User');
const File = require('../models/File');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/keys');
const redisClient = require('../utils/redisClient');
const SessionService = require('../services/sessionService');
const aiService = require('../services/aiService');

module.exports = function(io) {
  // Redis 기반 상태 관리 (분산 시스템용)
  const redisStateClient = require('../utils/redisClient');
  
  // 누락된 변수들 추가
  const messageQueues = new Map();
  const streamingSessions = new Map();
  const userRooms = new Map();
  
  // Redis 상태 관리 클래스 (타임아웃 추가)
  class RedisStateManager {
    // Redis 호출에 타임아웃 적용
    static withTimeout(promise, timeoutMs = 2000) {
      return Promise.race([
        promise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Redis timeout after ${timeoutMs}ms`)), timeoutMs)
        )
      ]);
    }
    
    static async setConnectedUser(userId, socketId) {
      try {
        await this.withTimeout(
          redisStateClient.hset('socket:connected_users', userId, socketId)
        );
      } catch (error) {
        console.error('Redis setConnectedUser error:', error);
      }
    }
    
    static async getConnectedUser(userId) {
      try {
        return await this.withTimeout(
          redisStateClient.hget('socket:connected_users', userId)
        );
      } catch (error) {
        console.error('Redis getConnectedUser error:', error);
        return null;
      }
    }
    
    static async removeConnectedUser(userId) {
      try {
        await this.withTimeout(
          redisStateClient.hdel('socket:connected_users', userId)
        );
      } catch (error) {
        console.error('Redis removeConnectedUser error:', error);
      }
    }
    
    static async setUserRoom(socketId, roomId) {
      try {
        await this.withTimeout(
          redisStateClient.hset('socket:user_rooms', socketId, roomId)
        );
      } catch (error) {
        console.error('Redis setUserRoom error:', error);
      }
    }
    
    static async getUserRoom(socketId) {
      try {
        return await this.withTimeout(
          redisStateClient.hget('socket:user_rooms', socketId)
        );
      } catch (error) {
        console.error('Redis getUserRoom error:', error);
        return null;
      }
    }
    
    static async removeUserRoom(socketId) {
      try {
        await this.withTimeout(
          redisStateClient.hdel('socket:user_rooms', socketId)
        );
      } catch (error) {
        console.error('Redis removeUserRoom error:', error);
      }
    }
  }

  // 로컬 캐시용 (성능 최적화)
  const messageLoadRetries = new Map();
  const BATCH_SIZE = 30;  // 한 번에 로드할 메시지 수
  const LOAD_DELAY = 100; // 메시지 로드 딜레이 (ms) - 300→100으로 단축
  const MAX_RETRIES = 2;  // 최대 재시도 횟수 - 3→2로 단축
  const MESSAGE_LOAD_TIMEOUT = 5000; // 메시지 로드 타임아웃 (5초) - 10초→5초로 단축
  const RETRY_DELAY = 1000; // 재시도 간격 (1초) - 2초→1초로 단축
  const DUPLICATE_LOGIN_TIMEOUT = 5000; // 중복 로그인 타임아웃 (5초) - 10초→5초로 단축

  // 로깅 유틸리티 함수
  const logDebug = (action, data) => {
    console.debug(`[Socket.IO] ${action}:`, {
      ...data,
      timestamp: new Date().toISOString()
    });
  };

  // 메시지 일괄 로드 함수 (고속 최적화)
  const loadMessages = async (socket, roomId, before, limit = BATCH_SIZE) => {
    try {
      // 쿼리 구성
      const query = { room: roomId };
      if (before) {
        query.timestamp = { $lt: new Date(before) };
      }

      // 메시지 로드 (최적화 - 단일 populate)
      const messages = await Message.find(query)
        .populate('sender', 'name profileImage') // 최소 필드만
        .populate('file', 'filename mimetype size') // 최소 필드만
        .sort({ timestamp: -1 })
        .limit(limit + 1)
        .lean();

      // 결과 처리 (빠른 처리)
      const hasMore = messages.length > limit;
      const resultMessages = hasMore ? messages.slice(0, limit) : messages;
      
      // 정렬 (이미 -1로 정렬되어 있으므로 reverse만)
      const sortedMessages = resultMessages.reverse();

      // 읽음 상태 업데이트 (비동기 - 결과를 기다리지 않음)
      if (sortedMessages.length > 0 && socket.user) {
        setImmediate(() => {
          const messageIds = sortedMessages.map(msg => msg._id);
          Message.updateMany(
            {
              _id: { $in: messageIds },
              'readers.userId': { $ne: socket.user.id }
            },
            {
              $push: {
                readers: {
                  userId: socket.user.id,
                  readAt: new Date()
                }
              }
            }
          ).exec().catch(error => {
            console.error('Read status update error:', error);
          });
        });
      }

      return {
        messages: sortedMessages,
        hasMore,
        oldestTimestamp: sortedMessages[0]?.timestamp || null
      };
    } catch (error) {
      console.error('Load messages error:', {
        error: error.message,
        stack: error.stack,
        roomId,
        before,
        limit
      });
      throw error;
    }
  };

  // 재시도 로직을 포함한 메시지 로드 함수
  const loadMessagesWithRetry = async (socket, roomId, before, retryCount = 0) => {
    const retryKey = `${roomId}:${socket.user.id}`;
    
    try {
      if (messageLoadRetries.get(retryKey) >= MAX_RETRIES) {
        throw new Error('최대 재시도 횟수를 초과했습니다.');
      }

      const result = await loadMessages(socket, roomId, before);
      messageLoadRetries.delete(retryKey);
      return result;

    } catch (error) {
      const currentRetries = messageLoadRetries.get(retryKey) || 0;
      
      if (currentRetries < MAX_RETRIES) {
        messageLoadRetries.set(retryKey, currentRetries + 1);
        const delay = Math.min(RETRY_DELAY * Math.pow(2, currentRetries), 10000);
        
        logDebug('retrying message load', {
          roomId,
          retryCount: currentRetries + 1,
          delay
        });

        await new Promise(resolve => setTimeout(resolve, delay));
        return loadMessagesWithRetry(socket, roomId, before, currentRetries + 1);
      }

      messageLoadRetries.delete(retryKey);
      throw error;
    }
  };

  // 중복 로그인 처리 함수
  const handleDuplicateLogin = async (existingSocket, newSocket) => {
    try {
      // 기존 연결에 중복 로그인 알림
      existingSocket.emit('duplicate_login', {
        type: 'new_login_attempt',
        deviceInfo: newSocket.handshake.headers['user-agent'],
        ipAddress: newSocket.handshake.address,
        timestamp: Date.now()
      });

      // 타임아웃 설정
      return new Promise((resolve) => {
        setTimeout(async () => {
          try {
            // 기존 세션 종료
            existingSocket.emit('session_ended', {
              reason: 'duplicate_login',
              message: '다른 기기에서 로그인하여 현재 세션이 종료되었습니다.'
            });

            // 기존 연결 종료
            existingSocket.disconnect(true);
            resolve();
          } catch (error) {
            console.error('Error during session termination:', error);
            resolve();
          }
        }, DUPLICATE_LOGIN_TIMEOUT);
      });
    } catch (error) {
      console.error('Duplicate login handling error:', error);
      throw error;
    }
  };

  // 미들웨어: 소켓 연결 시 인증 처리
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      const sessionId = socket.handshake.auth.sessionId;

      if (!token || !sessionId) {
        console.log('Missing auth data:', { token: !!token, sessionId: !!sessionId });
        return next(new Error('NO_AUTH_DATA'));
      }

      let decoded;
      try {
        decoded = jwt.verify(token, jwtSecret);
      } catch (jwtError) {
        console.error('JWT verification failed:', jwtError.message);
        if (jwtError.name === 'TokenExpiredError') {
          return next(new Error('TOKEN_EXPIRED'));
        }
        return next(new Error('INVALID_TOKEN'));
      }

      if (!decoded?.user?.id) {
        console.error('Invalid token payload:', decoded);
        return next(new Error('INVALID_TOKEN_PAYLOAD'));
      }

      // 세션 검증
      try {
        const validationResult = await SessionService.validateSession(decoded.user.id, sessionId);
        if (!validationResult.isValid) {
          console.error('Session validation failed:', validationResult);
          return next(new Error(validationResult.message || 'INVALID_SESSION'));
        }
      } catch (sessionError) {
        console.error('Session service error:', sessionError);
        return next(new Error('SESSION_SERVICE_ERROR'));
      }

      // 사용자 조회
      let user;
      try {
        user = await User.findById(decoded.user.id);
        if (!user) {
          console.error('User not found:', decoded.user.id);
          return next(new Error('USER_NOT_FOUND'));
        }
      } catch (userError) {
        console.error('User lookup error:', userError);
        return next(new Error('USER_LOOKUP_ERROR'));
      }

      // 중복 로그인 확인 (Redis 사용)
      try {
        const existingSocketId = await RedisStateManager.getConnectedUser(decoded.user.id);
        if (existingSocketId && existingSocketId !== socket.id) {
          const existingSocket = io.sockets.sockets.get(existingSocketId);
          if (existingSocket && existingSocket.connected) {
            console.log('Duplicate login detected, handling existing connection:', existingSocketId);
            // 기존 연결에 알림 후 종료
            existingSocket.emit('duplicate_login', {
              type: 'new_login_attempt',
              deviceInfo: socket.handshake.headers['user-agent'],
              ipAddress: socket.handshake.address,
              timestamp: Date.now()
            });
            
            // 짧은 지연 후 기존 연결 종료
            setTimeout(() => {
              if (existingSocket.connected) {
                existingSocket.emit('session_ended', {
                  reason: 'duplicate_login',
                  message: '다른 기기에서 로그인하여 현재 세션이 종료되었습니다.'
                });
                existingSocket.disconnect(true);
              }
            }, 1000);
          }
        }
      } catch (redisError) {
        console.error('Redis connection check error:', redisError);
        // Redis 오류는 무시하고 진행
      }

      // 소켓에 사용자 정보 설정
      socket.user = {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        sessionId: sessionId,
        profileImage: user.profileImage
      };

      // 세션 활동 시간 업데이트
      try {
        await SessionService.updateLastActivity(decoded.user.id);
      } catch (activityError) {
        console.error('Activity update error:', activityError);
        // 비중요한 오류이므로 무시하고 진행
      }

      console.log('Socket authentication successful:', {
        userId: user._id.toString(),
        socketId: socket.id
      });

      next();

    } catch (error) {
      console.error('Socket authentication error:', error);
      return next(new Error('AUTHENTICATION_FAILED'));
    }
  });
  
  io.on('connection', async (socket) => {
    logDebug('socket connected', {
      socketId: socket.id,
      userId: socket.user?.id,
      userName: socket.user?.name
    });

    if (socket.user) {
      try {
        // 이전 연결이 있는지 확인 (Redis 사용)
        const previousSocketId = await RedisStateManager.getConnectedUser(socket.user.id);
      if (previousSocketId && previousSocketId !== socket.id) {
        const previousSocket = io.sockets.sockets.get(previousSocketId);
        if (previousSocket) {
          // 이전 연결에 중복 로그인 알림
          previousSocket.emit('duplicate_login', {
            type: 'new_login_attempt',
            deviceInfo: socket.handshake.headers['user-agent'],
            ipAddress: socket.handshake.address,
            timestamp: Date.now()
          });

          // 이전 연결 종료 처리
          setTimeout(() => {
            previousSocket.emit('session_ended', {
              reason: 'duplicate_login',
              message: '다른 기기에서 로그인하여 현재 세션이 종료되었습니다.'
            });
            previousSocket.disconnect(true);
          }, DUPLICATE_LOGIN_TIMEOUT);
        }
      }
      
        // 새로운 연결 정보 저장 (Redis 사용)
        await RedisStateManager.setConnectedUser(socket.user.id, socket.id);
      } catch (error) {
        console.error('Socket connection setup error:', error);
      }
    }

    // 이전 메시지 로딩 처리 개선
    socket.on('fetchPreviousMessages', async ({ roomId, before }) => {
      const queueKey = `${roomId}:${socket.user.id}`;

      try {
        if (!socket.user) {
          throw new Error('Unauthorized');
        }

        // 권한 체크
        const room = await Room.findOne({
          _id: roomId,
          participants: socket.user.id
        });

        if (!room) {
          throw new Error('채팅방 접근 권한이 없습니다.');
        }

        if (messageQueues.get(queueKey)) {
          logDebug('message load skipped - already loading', {
            roomId,
            userId: socket.user.id
          });
          return;
        }

        messageQueues.set(queueKey, true);
        
        // 강제 타임아웃 (10초 후 큐 해제)
        setTimeout(() => {
          messageQueues.delete(queueKey);
        }, 10000);
        
        socket.emit('messageLoadStart');

        const result = await loadMessagesWithRetry(socket, roomId, before);
        
        logDebug('previous messages loaded', {
          roomId,
          messageCount: result.messages.length,
          hasMore: result.hasMore,
          oldestTimestamp: result.oldestTimestamp
        });

        socket.emit('previousMessagesLoaded', result);

      } catch (error) {
        console.error('Fetch previous messages error:', error);
        socket.emit('error', {
          type: 'LOAD_ERROR',
          message: error.message || '이전 메시지를 불러오는 중 오류가 발생했습니다.'
        });
      } finally {
        // 즉시 큐 해제 (타임아웃도 유지)
        messageQueues.delete(queueKey);
        messageLoadRetries.delete(queueKey);
      }
    });
    
    // 채팅방 입장 처리 개선
    socket.on('joinRoom', async (roomId) => {
      try {
        if (!socket.user) {
          throw new Error('Unauthorized');
        }

        // 이미 해당 방에 참여 중인지 확인 (Redis 사용)
        const currentRoom = await RedisStateManager.getUserRoom(socket.id);
        if (currentRoom === roomId) {
          logDebug('already in room', {
            userId: socket.user.id,
            roomId
          });
          socket.emit('joinRoomSuccess', { roomId });
          return;
        }

        // 기존 방에서 나가기 (빠른 처리)
        if (currentRoom) {
          logDebug('leaving current room', { 
            userId: socket.user.id, 
            roomId: currentRoom 
          });
          socket.leave(currentRoom);
          // Redis 업데이트는 비동기로 처리 (기다리지 않음)
          RedisStateManager.removeUserRoom(socket.id).catch(err => 
            console.error('Redis removeUserRoom error:', err)
          );
          
          socket.to(currentRoom).emit('userLeft', {
            userId: socket.user.id,
            name: socket.user.name
          });
        }

        // 채팅방 참가 with profileImage
        const room = await Room.findByIdAndUpdate(
          roomId,
          { $addToSet: { participants: socket.user.id } },
          { 
            new: true,
            runValidators: true 
          }
        ).populate('participants', 'name email profileImage');

        if (!room) {
          throw new Error('채팅방을 찾을 수 없습니다.');
        }

        socket.join(roomId);
        
        // Redis 업데이트와 메시지 로딩을 병렬 처리
        const [messageLoadResult] = await Promise.all([
          loadMessages(socket, roomId),
          // Redis 업데이트는 별도로 처리 (실패해도 괜찮음)
          RedisStateManager.setUserRoom(socket.id, roomId).catch(err => 
            console.error('Redis setUserRoom error:', err)
          )
        ]);

        const { messages, hasMore, oldestTimestamp } = messageLoadResult;

        // 입장 메시지 생성 (비동기로 처리)
        const joinMessage = new Message({
          room: roomId,
          content: `${socket.user.name}님이 입장하였습니다.`,
          type: 'system',
          timestamp: new Date()
        });
        
        // 저장은 비동기로 처리 (기다리지 않음)
        joinMessage.save().catch(err => 
          console.error('Join message save error:', err)
        );

        // 활성 스트리밍 메시지 조회
        const activeStreams = Array.from(streamingSessions.values())
          .filter(session => session.room === roomId)
          .map(session => ({
            _id: session.messageId,
            type: 'ai',
            aiType: session.aiType,
            content: session.content,
            timestamp: session.timestamp,
            isStreaming: true
          }));

        // 이벤트 발송
        socket.emit('joinRoomSuccess', {
          roomId,
          participants: room.participants,
          messages,
          hasMore,
          oldestTimestamp: messageLoadResult.oldestTimestamp,
          activeStreams
        });

        io.to(roomId).emit('message', joinMessage);
        io.to(roomId).emit('participantsUpdate', room.participants);

        logDebug('user joined room', {
          userId: socket.user.id,
          roomId,
          messageCount: messages.length,
          hasMore
        });

      } catch (error) {
        console.error('Join room error:', error);
        socket.emit('joinRoomError', {
          message: error.message || '채팅방 입장에 실패했습니다.'
        });
      }
    });
    
    // 메시지 전송 처리
    socket.on('chatMessage', async (messageData) => {
      try {
        if (!socket.user) {
          throw new Error('Unauthorized');
        }

        if (!messageData) {
          throw new Error('메시지 데이터가 없습니다.');
        }

        const { room, type, content, fileData } = messageData;

        if (!room) {
          throw new Error('채팅방 정보가 없습니다.');
        }

        // 채팅방 권한 확인
        const chatRoom = await Room.findOne({
          _id: room,
          participants: socket.user.id
        });

        if (!chatRoom) {
          throw new Error('채팅방 접근 권한이 없습니다.');
        }

        // 세션 유효성 재확인
        const sessionValidation = await SessionService.validateSession(
          socket.user.id, 
          socket.user.sessionId
        );
        
        if (!sessionValidation.isValid) {
          throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
        }

        // AI 멘션 확인
        const aiMentions = extractAIMentions(content);
        let message;

        logDebug('message received', {
          type,
          room,
          userId: socket.user.id,
          hasFileData: !!fileData,
          hasAIMentions: aiMentions.length
        });

        // 메시지 타입별 처리
        switch (type) {
          case 'file':
            if (!fileData || !fileData._id) {
              throw new Error('파일 데이터가 올바르지 않습니다.');
            }

            const file = await File.findOne({
              _id: fileData._id,
              user: socket.user.id
            });

            if (!file) {
              throw new Error('파일을 찾을 수 없거나 접근 권한이 없습니다.');
            }

            message = new Message({
              room,
              sender: socket.user.id,
              type: 'file',
              file: file._id,
              content: content || '',
              timestamp: new Date(),
              reactions: {},
              metadata: {
                fileType: file.mimetype,
                fileSize: file.size,
                originalName: file.originalname
              }
            });
            break;

          case 'text':
            const messageContent = content?.trim() || messageData.msg?.trim();
            if (!messageContent) {
              return;
            }

            message = new Message({
              room,
              sender: socket.user.id,
              content: messageContent,
              type: 'text',
              timestamp: new Date(),
              reactions: {}
            });
            break;

          default:
            throw new Error('지원하지 않는 메시지 타입입니다.');
        }

        await message.save();
        await message.populate([
          { path: 'sender', select: 'name email profileImage' },
          { path: 'file', select: 'filename originalname mimetype size' }
        ]);

        io.to(room).emit('message', message);

        // AI 멘션이 있는 경우 AI 응답 생성
        if (aiMentions.length > 0) {
          for (const ai of aiMentions) {
            const query = content.replace(new RegExp(`@${ai}\\b`, 'g'), '').trim();
            await handleAIResponse(io, room, ai, query);
          }
        }

        await SessionService.updateLastActivity(socket.user.id);

        logDebug('message processed', {
          messageId: message._id,
          type: message.type,
          room
        });

      } catch (error) {
        console.error('Message handling error:', error);
        socket.emit('error', {
          code: error.code || 'MESSAGE_ERROR',
          message: error.message || '메시지 전송 중 오류가 발생했습니다.'
        });
      }
    });

    // 채팅방 퇴장 처리
    socket.on('leaveRoom', async (roomId) => {
      try {
        if (!socket.user) {
          throw new Error('Unauthorized');
        }

        // 실제로 해당 방에 참여 중인지 먼저 확인
        const currentRoom = userRooms?.get(socket.user.id);
        if (!currentRoom || currentRoom !== roomId) {
          console.log(`User ${socket.user.id} is not in room ${roomId}`);
          return;
        }

        // 권한 확인
        const room = await Room.findOne({
          _id: roomId,
          participants: socket.user.id
        }).select('participants').lean();

        if (!room) {
          console.log(`Room ${roomId} not found or user has no access`);
          return;
        }

        socket.leave(roomId);
        userRooms.delete(socket.user.id);

        // 퇴장 메시지 생성 및 저장
        const leaveMessage = await Message.create({
          room: roomId,
          content: `${socket.user.name}님이 퇴장하였습니다.`,
          type: 'system',
          timestamp: new Date()
        });

        // 참가자 목록 업데이트 - profileImage 포함
        const updatedRoom = await Room.findByIdAndUpdate(
          roomId,
          { $pull: { participants: socket.user.id } },
          { 
            new: true,
            runValidators: true
          }
        ).populate('participants', 'name email profileImage');

        if (!updatedRoom) {
          console.log(`Room ${roomId} not found during update`);
          return;
        }

        // 스트리밍 세션 정리
        for (const [messageId, session] of streamingSessions.entries()) {
          if (session.room === roomId && session.userId === socket.user.id) {
            streamingSessions.delete(messageId);
          }
        }

        // 메시지 큐 정리
        const queueKey = `${roomId}:${socket.user.id}`;
        messageQueues.delete(queueKey);
        messageLoadRetries.delete(queueKey);

        // 이벤트 발송
        io.to(roomId).emit('message', leaveMessage);
        io.to(roomId).emit('participantsUpdate', updatedRoom.participants);

        console.log(`User ${socket.user.id} left room ${roomId} successfully`);

      } catch (error) {
        console.error('Leave room error:', error);
        socket.emit('error', {
          message: error.message || '채팅방 퇴장 중 오류가 발생했습니다.'
        });
      }
    });
    
    // 연결 해제 처리
    socket.on('disconnect', async (reason) => {
      if (!socket.user) return;

      try {
        // 해당 사용자의 현재 활성 연결인 경우에만 정리 (Redis 사용)
        const currentSocketId = await RedisStateManager.getConnectedUser(socket.user.id);
        if (currentSocketId === socket.id) {
          await RedisStateManager.removeConnectedUser(socket.user.id);
        }

        const roomId = await RedisStateManager.getUserRoom(socket.id);
        await RedisStateManager.removeUserRoom(socket.id);

        // 메시지 큐 정리
        const userQueues = Array.from(messageQueues.keys())
          .filter(key => key.endsWith(`:${socket.user.id}`));
        userQueues.forEach(key => {
          messageQueues.delete(key);
          messageLoadRetries.delete(key);
        });
        
        // 스트리밍 세션 정리
        for (const [messageId, session] of streamingSessions.entries()) {
          if (session.userId === socket.user.id) {
            streamingSessions.delete(messageId);
          }
        }

        // 현재 방에서 자동 퇴장 처리
        if (roomId) {
          // 다른 디바이스로 인한 연결 종료가 아닌 경우에만 처리
          if (reason !== 'client namespace disconnect' && reason !== 'duplicate_login') {
            const leaveMessage = await Message.create({
              room: roomId,
              content: `${socket.user.name}님이 연결이 끊어졌습니다.`,
              type: 'system',
              timestamp: new Date()
            });

            const updatedRoom = await Room.findByIdAndUpdate(
              roomId,
              { $pull: { participants: socket.user.id } },
              { 
                new: true,
                runValidators: true 
              }
            ).populate('participants', 'name email profileImage');

            if (updatedRoom) {
              io.to(roomId).emit('message', leaveMessage);
              io.to(roomId).emit('participantsUpdate', updatedRoom.participants);
            }
          }
        }

        logDebug('user disconnected', {
          reason,
          userId: socket.user.id,
          socketId: socket.id,
          lastRoom: roomId
        });

      } catch (error) {
        console.error('Disconnect handling error:', error);
      }
    });

    // 세션 종료 또는 로그아웃 처리
    socket.on('force_login', async ({ token }) => {
      try {
        if (!socket.user) return;

        // 강제 로그아웃을 요청한 클라이언트의 세션 정보 확인
        const decoded = jwt.verify(token, jwtSecret);
        if (!decoded?.user?.id || decoded.user.id !== socket.user.id) {
          throw new Error('Invalid token');
        }

        // 세션 종료 처리
        socket.emit('session_ended', {
          reason: 'force_logout',
          message: '다른 기기에서 로그인하여 현재 세션이 종료되었습니다.'
        });

        // 연결 종료
        socket.disconnect(true);

      } catch (error) {
        console.error('Force login error:', error);
        socket.emit('error', {
          message: '세션 종료 중 오류가 발생했습니다.'
        });
      }
    });

    // 메시지 읽음 상태 처리
    socket.on('markMessagesAsRead', async ({ roomId, messageIds }) => {
      try {
        if (!socket.user) {
          throw new Error('Unauthorized');
        }

        if (!Array.isArray(messageIds) || messageIds.length === 0) {
          return;
        }

        // 읽음 상태 업데이트
        await Message.updateMany(
          {
            _id: { $in: messageIds },
            room: roomId,
            'readers.userId': { $ne: socket.user.id }
          },
          {
            $push: {
              readers: {
                userId: socket.user.id,
                readAt: new Date()
              }
            }
          }
        );

        socket.to(roomId).emit('messagesRead', {
          userId: socket.user.id,
          messageIds
        });

      } catch (error) {
        console.error('Mark messages as read error:', error);
        socket.emit('error', {
          message: '읽음 상태 업데이트 중 오류가 발생했습니다.'
        });
      }
    });

    // 리액션 처리
    socket.on('messageReaction', async ({ messageId, reaction, type }) => {
      try {
        if (!socket.user) {
          throw new Error('Unauthorized');
        }

        const message = await Message.findById(messageId);
        if (!message) {
          throw new Error('메시지를 찾을 수 없습니다.');
        }

        // 리액션 추가/제거
        if (type === 'add') {
          await message.addReaction(reaction, socket.user.id);
        } else if (type === 'remove') {
          await message.removeReaction(reaction, socket.user.id);
        }

        // 업데이트된 리액션 정보 브로드캐스트
        io.to(message.room).emit('messageReactionUpdate', {
          messageId,
          reactions: message.reactions
        });

      } catch (error) {
        console.error('Message reaction error:', error);
        socket.emit('error', {
          message: error.message || '리액션 처리 중 오류가 발생했습니다.'
        });
      }
    });
  });

  // AI 멘션 추출 함수
  function extractAIMentions(content) {
    if (!content) return [];
    
    const aiTypes = ['wayneAI', 'consultingAI'];
    const mentions = new Set();
    const mentionRegex = /@(wayneAI|consultingAI)\b/g;
    let match;
    
    while ((match = mentionRegex.exec(content)) !== null) {
      if (aiTypes.includes(match[1])) {
        mentions.add(match[1]);
      }
    }
    
    return Array.from(mentions);
  }

  // AI 응답 처리 함수 개선
  async function handleAIResponse(io, room, aiName, query) {
    const messageId = `${aiName}-${Date.now()}`;
    let accumulatedContent = '';
    const timestamp = new Date();

    // 스트리밍 세션 초기화
    streamingSessions.set(messageId, {
      room,
      aiType: aiName,
      content: '',
      messageId,
      timestamp,
      lastUpdate: Date.now(),
      reactions: {}
    });
    
    logDebug('AI response started', {
      messageId,
      aiType: aiName,
      room,
      query
    });

    // 초기 상태 전송
    io.to(room).emit('aiMessageStart', {
      messageId,
      aiType: aiName,
      timestamp
    });

    try {
      // AI 응답 생성 및 스트리밍
      await aiService.generateResponse(query, aiName, {
        onStart: () => {
          logDebug('AI generation started', {
            messageId,
            aiType: aiName
          });
        },
        onChunk: async (chunk) => {
          accumulatedContent += chunk.currentChunk || '';
          
          const session = streamingSessions.get(messageId);
          if (session) {
            session.content = accumulatedContent;
            session.lastUpdate = Date.now();
          }

          io.to(room).emit('aiMessageChunk', {
            messageId,
            currentChunk: chunk.currentChunk,
            fullContent: accumulatedContent,
            isCodeBlock: chunk.isCodeBlock,
            timestamp: new Date(),
            aiType: aiName,
            isComplete: false
          });
        },
        onComplete: async (finalContent) => {
          // 스트리밍 세션 정리
          streamingSessions.delete(messageId);

          // AI 메시지 저장
          const aiMessage = await Message.create({
            room,
            content: finalContent.content,
            type: 'ai',
            aiType: aiName,
            timestamp: new Date(),
            reactions: {},
            metadata: {
              query,
              generationTime: Date.now() - timestamp,
              completionTokens: finalContent.completionTokens,
              totalTokens: finalContent.totalTokens
            }
          });

          // 완료 메시지 전송
          io.to(room).emit('aiMessageComplete', {
            messageId,
            _id: aiMessage._id,
            content: finalContent.content,
            aiType: aiName,
            timestamp: new Date(),
            isComplete: true,
            query,
            reactions: {}
          });

          logDebug('AI response completed', {
            messageId,
            aiType: aiName,
            contentLength: finalContent.content.length,
            generationTime: Date.now() - timestamp
          });
        },
        onError: (error) => {
          streamingSessions.delete(messageId);
          console.error('AI response error:', error);
          
          io.to(room).emit('aiMessageError', {
            messageId,
            error: error.message || 'AI 응답 생성 중 오류가 발생했습니다.',
            aiType: aiName
          });

          logDebug('AI response error', {
            messageId,
            aiType: aiName,
            error: error.message
          });
        }
      });
    } catch (error) {
      streamingSessions.delete(messageId);
      console.error('AI service error:', error);
      
      io.to(room).emit('aiMessageError', {
        messageId,
        error: error.message || 'AI 서비스 오류가 발생했습니다.',
        aiType: aiName
      });

      logDebug('AI service error', {
        messageId,
        aiType: aiName,
        error: error.message
      });
    }
  }

  return io;
};