import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import crypto from 'crypto-js';
import authService from './authService';
import { Toast } from '../components/Toast';

class S3Service {
  constructor() {
    this.s3Client = null;
    this.bucketName = process.env.NEXT_PUBLIC_S3_BUCKET_NAME;
    this.region = process.env.NEXT_PUBLIC_AWS_REGION || 'ap-northeast-2';
    
    // AWS 자격증명 (주의: 프로덕션에서는 보안에 주의)
    this.accessKeyId = process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID;
    this.secretAccessKey = process.env.NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY;
    
    this.uploadLimit = 50 * 1024 * 1024; // 50MB
    
    this.allowedTypes = {
      image: {
        extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
        mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        maxSize: 10 * 1024 * 1024,
        name: '이미지'
      },
      video: {
        extensions: ['.mp4', '.webm', '.mov'],
        mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
        maxSize: 50 * 1024 * 1024,
        name: '동영상'
      },
      audio: {
        extensions: ['.mp3', '.wav', '.ogg'],
        mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg'],
        maxSize: 20 * 1024 * 1024,
        name: '오디오'
      },
      document: {
        extensions: ['.pdf', '.doc', '.docx', '.txt'],
        mimeTypes: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain'
        ],
        maxSize: 20 * 1024 * 1024,
        name: '문서'
      },
      archive: {
        extensions: ['.zip', '.rar', '.7z'],
        mimeTypes: [
          'application/zip',
          'application/x-rar-compressed',
          'application/x-7z-compressed'
        ],
        maxSize: 50 * 1024 * 1024,
        name: '압축파일'
      }
    };
  }

  initializeS3Client() {
    if (!this.s3Client) {
      if (!this.accessKeyId || !this.secretAccessKey || !this.bucketName) {
        throw new Error('AWS 자격증명 또는 버킷 이름이 설정되지 않았습니다.');
      }

      this.s3Client = new S3Client({
        region: this.region,
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        },
      });
    }
    return this.s3Client;
  }

  generateSafeFilename(originalFilename) {
    const ext = this.getFileExtension(originalFilename);
    const timestamp = Date.now();
    const randomBytes = crypto.lib.WordArray.random(8).toString();
    return `${timestamp}_${randomBytes}${ext}`;
  }

  generateS3Key(filename, userId) {
    return `uploads/${userId}/${filename}`;
  }

  async validateFile(file) {
    if (!file) {
      const message = '파일이 선택되지 않았습니다.';
      Toast.error(message);
      return { success: false, message };
    }

    if (file.size > this.uploadLimit) {
      const message = `파일 크기는 ${this.formatFileSize(this.uploadLimit)}를 초과할 수 없습니다.`;
      Toast.error(message);
      return { success: false, message };
    }

    let isAllowedType = false;
    let maxTypeSize = 0;
    let typeConfig = null;

    for (const config of Object.values(this.allowedTypes)) {
      if (config.mimeTypes.includes(file.type)) {
        isAllowedType = true;
        maxTypeSize = config.maxSize;
        typeConfig = config;
        break;
      }
    }

    if (!isAllowedType) {
      const message = '지원하지 않는 파일 형식입니다.';
      Toast.error(message);
      return { success: false, message };
    }

    if (file.size > maxTypeSize) {
      const message = `${typeConfig.name} 파일은 ${this.formatFileSize(maxTypeSize)}를 초과할 수 없습니다.`;
      Toast.error(message);
      return { success: false, message };
    }

    const ext = this.getFileExtension(file.name);
    if (!typeConfig.extensions.includes(ext.toLowerCase())) {
      const message = '파일 확장자가 올바르지 않습니다.';
      Toast.error(message);
      return { success: false, message };
    }

    return { success: true };
  }

  async uploadToS3(file, onProgress) {
    try {
      const validationResult = await this.validateFile(file);
      if (!validationResult.success) {
        return validationResult;
      }

      const user = authService.getCurrentUser();
      if (!user?.id) {
        return { 
          success: false, 
          message: '사용자 정보가 없습니다.' 
        };
      }

      const s3Client = this.initializeS3Client();
      const safeFilename = this.generateSafeFilename(file.name);
      const s3Key = this.generateS3Key(safeFilename, user.id);

      if (onProgress) {
        onProgress(0);
      }

      // Upload 클래스를 사용하여 안정적인 업로드와 진행률 추적
      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: this.bucketName,
          Key: s3Key,
          Body: file,
          ContentType: file.type,
          ACL: 'public-read', // 퍼블릭 읽기 권한 부여
        },
      });

      // 진행률 추적
      upload.on('httpUploadProgress', (progress) => {
        if (onProgress && progress.total) {
          const percentCompleted = Math.round((progress.loaded * 100) / progress.total);
          onProgress(percentCompleted);
        }
      });

      const result = await upload.done();

      const s3Url = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${s3Key}`;

      return {
        success: true,
        data: {
          filename: safeFilename,
          originalname: file.name,
          mimetype: file.type,
          size: file.size,
          s3Url: s3Url,
          s3Key: s3Key,
          etag: result.ETag
        }
      };

    } catch (error) {
      console.error('S3 upload error:', error);
      return this.handleUploadError(error);
    }
  }

  async saveFileMetadata(fileData) {
    try {
      const user = authService.getCurrentUser();
      if (!user?.token || !user?.sessionId) {
        return { 
          success: false, 
          message: '인증 정보가 없습니다.' 
        };
      }

      const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const response = await fetch(`${baseUrl}/api/files/save-metadata`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': user.token,
          'x-session-id': user.sessionId
        },
        credentials: 'include',
        body: JSON.stringify(fileData)
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        return {
          success: false,
          message: result.message || '파일 메타데이터 저장에 실패했습니다.'
        };
      }

      return {
        success: true,
        data: result.file
      };

    } catch (error) {
      console.error('Metadata save error:', error);
      return {
        success: false,
        message: '파일 메타데이터 저장 중 오류가 발생했습니다.'
      };
    }
  }

  async uploadFile(file, onProgress) {
    try {
      // 1. S3에 파일 업로드
      const uploadResult = await this.uploadToS3(file, (progress) => {
        if (onProgress) {
          // S3 업로드는 전체의 90%로 계산
          onProgress(Math.floor(progress * 0.9));
        }
      });

      if (!uploadResult.success) {
        return uploadResult;
      }

      if (onProgress) {
        onProgress(90);
      }

      // 2. 백엔드에 메타데이터 저장
      const metadataResult = await this.saveFileMetadata(uploadResult.data);

      if (!metadataResult.success) {
        // TODO: S3에서 업로드된 파일 삭제 로직 추가
        return metadataResult;
      }

      if (onProgress) {
        onProgress(100);
      }

      // 로컬 업로드와 동일한 응답 구조로 맞춤
      const finalResult = {
        success: true,
        message: '파일 업로드 성공',
        data: {
          file: {
            _id: metadataResult.data._id,
            filename: metadataResult.data.filename,
            originalname: metadataResult.data.originalname,
            mimetype: metadataResult.data.mimetype,
            size: metadataResult.data.size,
            s3Url: metadataResult.data.s3Url,
            s3Key: metadataResult.data.s3Key,
            storageType: metadataResult.data.storageType,
            uploadDate: metadataResult.data.uploadDate,
            url: uploadResult.data.s3Url
          }
        }
      };

      console.log('S3 upload complete result:', finalResult);
      return finalResult;

    } catch (error) {
      console.error('Upload error:', error);
      return this.handleUploadError(error);
    }
  }

  getFileExtension(filename) {
    if (!filename) return '';
    const parts = filename.split('.');
    return parts.length > 1 ? `.${parts.pop().toLowerCase()}` : '';
  }

  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${units[i]}`;
  }

  getFileType(filename) {
    if (!filename) return 'unknown';
    const ext = this.getFileExtension(filename).toLowerCase();
    for (const [type, config] of Object.entries(this.allowedTypes)) {
      if (config.extensions.includes(ext)) {
        return type;
      }
    }
    return 'unknown';
  }

  handleUploadError(error) {
    console.error('Upload error:', error);

    if (error.name === 'NoSuchBucket') {
      return {
        success: false,
        message: 'S3 버킷을 찾을 수 없습니다.'
      };
    }

    if (error.name === 'AccessDenied') {
      return {
        success: false,
        message: 'S3 접근 권한이 없습니다.'
      };
    }

    if (error.name === 'InvalidAccessKeyId') {
      return {
        success: false,
        message: 'AWS 액세스 키가 올바르지 않습니다.'
      };
    }

    if (error.name === 'SignatureDoesNotMatch') {
      return {
        success: false,
        message: 'AWS 시크릿 키가 올바르지 않습니다.'
      };
    }

    if (error.message && error.message.includes('getReader')) {
      return {
        success: false,
        message: '파일 읽기 중 오류가 발생했습니다. 브라우저를 새로고침하고 다시 시도해주세요.'
      };
    }

    return {
      success: false,
      message: error.message || '파일 업로드 중 오류가 발생했습니다.'
    };
  }
}

export default new S3Service(); 