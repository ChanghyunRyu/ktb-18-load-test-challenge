const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/keys');
const SessionService = require('../services/sessionService');

const authController = {
  async register(req, res) {
    try {
      console.log('Register request received:', req.body);
      
      const { name, email, password } = req.body;

      // Input validation
      if (!name || !email || !password) {
        return res.status(400).json({
          success: false,
          message: '모든 필드를 입력해주세요.'
        });
      }

      if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        return res.status(400).json({
          success: false,
          message: '올바른 이메일 형식이 아닙니다.'
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: '비밀번호는 6자 이상이어야 합니다.'
        });
      }
      
      // Check existing user
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: '이미 등록된 이메일입니다.'
        });
      }
      
      // Create user
      const user = new User({
        name,
        email,
        password
      });

      await user.save();
      console.log('User created:', user._id);

      // Create session with metadata
      const sessionInfo = await SessionService.createSession(user._id, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        createdAt: Date.now()
      });
      
      if (!sessionInfo || !sessionInfo.sessionId) {
        throw new Error('Session creation failed');
      }

      // Generate token with additional claims
      const token = jwt.sign(
        { 
          user: { id: user._id },
          sessionId: sessionInfo.sessionId,
          iat: Math.floor(Date.now() / 1000)
        },
        jwtSecret,
        { 
          expiresIn: '24h',
          algorithm: 'HS256'
        }
      );

      res.status(201).json({
        success: true,
        message: '회원가입이 완료되었습니다.',
        token,
        sessionId: sessionInfo.sessionId,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email
        }
      });

    } catch (error) {
      console.error('Register error:', error);
      
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          message: '입력값이 올바르지 않습니다.',
          errors: Object.values(error.errors).map(err => err.message)
        });
      }
      
      res.status(500).json({
        success: false,
        message: '회원가입 처리 중 오류가 발생했습니다.'
      });
    }
  },

  async login(req, res) {
    try {
      const { email, password } = req.body;

      // Input validation
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: '이메일과 비밀번호를 입력해주세요.'
        });
      }

      // 사용자 조회
      const user = await User.findOne({ email }).select('+password');
      if (!user) {
        return res.status(401).json({
          success: false,
          message: '이메일 또는 비밀번호가 올바르지 않습니다.'
        });
      }

      // 비밀번호 확인
      const isMatch = await user.matchPassword(password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: '이메일 또는 비밀번호가 올바르지 않습니다.'
        });
      }

      // 기존 세션 확인 및 처리 (간소화)
      try {
        const existingSession = await SessionService.getActiveSession(user._id);
        
        if (existingSession) {
          console.log('Existing session found for user:', user._id);
          
          const io = req.app.get('io');
          if (io && existingSession.socketId) {
            // 기존 연결에 중복 로그인 알림
            io.to(existingSession.socketId).emit('duplicate_login', {
              type: 'new_login_attempt',
              deviceInfo: req.headers['user-agent'],
              ipAddress: req.ip,
              timestamp: Date.now(),
              message: '다른 기기에서 로그인했습니다.'
            });

            // 짧은 지연 후 기존 세션 종료
            setTimeout(() => {
              io.to(existingSession.socketId).emit('session_ended', {
                reason: 'duplicate_login',
                message: '다른 기기에서 로그인하여 현재 세션이 종료되었습니다.'
              });
            }, 2000);
          }

          // 기존 세션 제거
          await SessionService.removeSession(user._id, existingSession.sessionId);
          console.log('Removed existing session for user:', user._id);
        }
      } catch (sessionError) {
        console.error('Session management error:', sessionError);
        // 세션 오류는 로그만 남기고 진행
      }

      // 새 세션 생성
      const sessionInfo = await SessionService.createSession(user._id, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        loginAt: Date.now(),
        browser: req.headers['user-agent'],
        platform: req.headers['sec-ch-ua-platform'],
        location: req.headers['x-forwarded-for'] || req.connection.remoteAddress
      });

      if (!sessionInfo || !sessionInfo.sessionId) {
        throw new Error('Session creation failed');
      }

      // JWT 토큰 생성
      const token = jwt.sign(
        { 
          user: { id: user._id },
          sessionId: sessionInfo.sessionId,
          iat: Math.floor(Date.now() / 1000)
        },
        jwtSecret,
        { 
          expiresIn: '24h',
          algorithm: 'HS256'
        }
      );

      // 응답 헤더 설정
      res.set({
        'Authorization': `Bearer ${token}`,
        'x-session-id': sessionInfo.sessionId
      });

      res.json({
        success: true,
        token,
        sessionId: sessionInfo.sessionId,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          profileImage: user.profileImage
        }
      });

    } catch (error) {
      console.error('Login error:', error);
      
      // 구체적인 오류 처리
      if (error.message === 'INVALID_TOKEN') {
        return res.status(401).json({
          success: false,
          message: '인증 토큰이 유효하지 않습니다.'
        });
      }
      
      if (error.message === 'DUPLICATE_LOGIN_TIMEOUT') {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_LOGIN_TIMEOUT',
          message: '중복 로그인 처리 중 시간 초과가 발생했습니다.'
        });
      }

      // 세션 생성 실패 처리
      if (error.message === 'Session creation failed') {
        return res.status(500).json({
          success: false,
          code: 'SESSION_ERROR',
          message: '세션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.'
        });
      }
      
      res.status(500).json({
        success: false,
        message: '로그인 처리 중 오류가 발생했습니다.',
        code: error.code || 'LOGIN_ERROR'
      });
    }
  },

  async logout(req, res) {
    try {
      const sessionId = req.header('x-session-id');
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: '세션 정보가 없습니다.'
        });
      }

      await SessionService.removeSession(req.user.id, sessionId);

      // Socket.IO 클라이언트에 로그아웃 알림
      const io = req.app.get('io');
      if (io) {
        const socketId = await SessionService.getSocketId(req.user.id, sessionId);
        if (socketId) {
          io.to(socketId).emit('session_ended', {
            reason: 'logout',
            message: '로그아웃되었습니다.'
          });
        }
      }
      
      // 쿠키 및 헤더 정리
      res.clearCookie('token');
      res.clearCookie('sessionId');
      
      res.json({
        success: true,
        message: '로그아웃되었습니다.'
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: '로그아웃 처리 중 오류가 발생했습니다.'
      });
    }
  },

  async verifyToken(req, res) {
    try {
      const token = req.header('x-auth-token');
      const sessionId = req.header('x-session-id');

      if (!token || !sessionId) {
        console.log('Missing token or sessionId:', { token: !!token, sessionId: !!sessionId });
        return res.status(401).json({
          success: false,
          message: '인증 정보가 제공되지 않았습니다.',
          code: 'MISSING_AUTH_DATA'
        });
      }

      // JWT 토큰 검증
      let decoded;
      try {
        decoded = jwt.verify(token, jwtSecret);
      } catch (jwtError) {
        console.error('JWT verification failed:', jwtError.message);
        
        if (jwtError.name === 'TokenExpiredError') {
          return res.status(401).json({
            success: false,
            message: '토큰이 만료되었습니다.',
            code: 'TOKEN_EXPIRED'
          });
        }
        
        return res.status(401).json({
          success: false,
          message: '유효하지 않은 토큰입니다.',
          code: 'INVALID_TOKEN'
        });
      }
      
      if (!decoded?.user?.id || !decoded?.sessionId) {
        return res.status(401).json({
          success: false,
          message: '토큰 payload가 유효하지 않습니다.',
          code: 'INVALID_TOKEN_PAYLOAD'
        });
      }

      // 토큰의 sessionId와 헤더의 sessionId 일치 여부 확인
      if (decoded.sessionId !== sessionId) {
        return res.status(401).json({
          success: false,
          message: '세션 정보가 일치하지 않습니다.',
          code: 'SESSION_MISMATCH'
        });
      }

      // 사용자 정보 조회
      let user;
      try {
        user = await User.findById(decoded.user.id);
        if (!user) {
          return res.status(404).json({
            success: false,
            message: '사용자를 찾을 수 없습니다.',
            code: 'USER_NOT_FOUND'
          });
        }
      } catch (userError) {
        console.error('User lookup error:', userError);
        return res.status(500).json({
          success: false,
          message: '사용자 조회 중 오류가 발생했습니다.',
          code: 'USER_LOOKUP_ERROR'
        });
      }

      // 세션 검증
      let validationResult;
      try {
        validationResult = await SessionService.validateSession(user._id, sessionId);
        if (!validationResult.isValid) {
          console.log('Session validation failed:', validationResult);
          return res.status(401).json({
            success: false,
            code: validationResult.error || 'INVALID_SESSION',
            message: validationResult.message || '세션이 유효하지 않습니다.'
          });
        }
      } catch (sessionError) {
        console.error('Session validation error:', sessionError);
        return res.status(500).json({
          success: false,
          message: '세션 검증 중 오류가 발생했습니다.',
          code: 'SESSION_VALIDATION_ERROR'
        });
      }

      // 세션 갱신 (비동기로 처리 - 결과를 기다리지 않음)
      SessionService.refreshSession(user._id, sessionId).catch(refreshError => {
        console.error('Session refresh error (non-blocking):', refreshError);
      });

      console.log('Token verification successful for user:', user._id);

      // 응답 헤더 설정
      if (validationResult.needsProfileRefresh) {
        res.set('X-Profile-Update-Required', 'true');
      }

      res.json({
        success: true,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          profileImage: user.profileImage
        }
      });

    } catch (error) {
      console.error('Token verification error:', error);

      res.status(500).json({
        success: false,
        message: '토큰 검증 중 예상치 못한 오류가 발생했습니다.',
        code: 'VERIFICATION_ERROR'
      });
    }
  },

  async refreshToken(req, res) {
    try {
      const oldSessionId = req.header('x-session-id');
      if (!oldSessionId) {
        return res.status(400).json({
          success: false,
          message: '세션 정보가 없습니다.'
        });
      }

      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: '사용자를 찾을 수 없습니다.'
        });
      }

      // 이전 세션 제거
      await SessionService.removeSession(user._id, oldSessionId);

      // 새 세션 생성
      const sessionInfo = await SessionService.createSession(user._id, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        refreshedAt: Date.now()
      });

      if (!sessionInfo || !sessionInfo.sessionId) {
        throw new Error('Failed to create new session');
      }

      // 새로운 JWT 토큰 생성
      const token = jwt.sign(
        { 
          user: { id: user._id },
          sessionId: sessionInfo.sessionId,
          iat: Math.floor(Date.now() / 1000)
        },
        jwtSecret,
        { 
          expiresIn: '24h',
          algorithm: 'HS256'
        }
      );

      res.json({
        success: true,
        message: '토큰이 갱신되었습니다.',
        token,
        sessionId: sessionInfo.sessionId,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          profileImage: user.profileImage
        }
      });

    } catch (error) {
      console.error('Token refresh error:', error);
      res.status(500).json({
        success: false,
        message: '토큰 갱신 중 오류가 발생했습니다.'
      });
    }
  }
};

module.exports = authController;