const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const RoomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  hasPassword: {
    type: Boolean,
    default: false
  },
  password: {
    type: String,
    select: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
});

// 비밀번호 해싱 미들웨어
RoomSchema.pre('save', async function(next) {
  if (this.isModified('password') && this.password) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    this.hasPassword = true;
  }
  if (!this.password) {
    this.hasPassword = false;
  }
  next();
});

// 비밀번호 확인 메서드
RoomSchema.methods.checkPassword = async function(password) {
  if (!this.hasPassword) return true;
  const room = await this.constructor.findById(this._id).select('+password');
  return await bcrypt.compare(password, room.password);
};

// 성능 최적화를 위한 인덱스 설정
// 1. 가장 중요: 목록 조회 시 createdAt 정렬용
RoomSchema.index({ createdAt: -1 });

// 2. 검색 최적화: name 필드 정규표현식 검색용
RoomSchema.index({ name: 1 });

// 3. populate 최적화: creator 조회용
RoomSchema.index({ creator: 1 });

// 4. 권한 체크 최적화: participants 배열 검색용 (multikey index)
RoomSchema.index({ participants: 1 });

module.exports = mongoose.model('Room', RoomSchema);