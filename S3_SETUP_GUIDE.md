# S3 직접 업로드 설정 가이드

프론트엔드에서 AWS S3에 직접 파일을 업로드하고 MongoDB에 메타데이터를 저장하는 기능이 구현되었습니다.

## 1. AWS S3 버킷 생성

1. AWS 콘솔에서 S3 서비스로 이동
2. 새 버킷 생성
3. CORS 설정 추가:

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
        "AllowedOrigins": ["*"],
        "ExposeHeaders": ["ETag"]
    }
]
```

## 2. IAM 사용자 생성 및 권한 설정

1. IAM 콘솔에서 새 사용자 생성
2. 다음 정책 연결:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:PutObjectAcl",
                "s3:GetObject",
                "s3:DeleteObject"
            ],
            "Resource": "arn:aws:s3:::your-bucket-name/*"
        }
    ]
}
```

3. Access Key와 Secret Key 생성 및 저장

## 3. 환경 변수 설정

### 백엔드 (.env)
```bash
# AWS S3 Settings
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=ap-northeast-2
S3_BUCKET_NAME=your_s3_bucket_name
```

### 프론트엔드 (frontend/.env.local)
```bash
# API URL
NEXT_PUBLIC_API_URL=http://localhost:3001

# S3 Upload Settings
NEXT_PUBLIC_USE_S3_UPLOAD=true
NEXT_PUBLIC_AWS_ACCESS_KEY_ID=your_aws_access_key_id
NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
NEXT_PUBLIC_AWS_REGION=ap-northeast-2
NEXT_PUBLIC_S3_BUCKET_NAME=your_s3_bucket_name
```

## 4. 보안 고려사항

⚠️ **중요**: 프론트엔드에 AWS 자격증명을 노출하는 것은 보안상 위험할 수 있습니다.

### 권장 보안 설정:

1. **IAM 권한 최소화**: S3 버킷에 대한 최소한의 권한만 부여
2. **버킷 정책 설정**: 특정 조건에서만 업로드 허용
3. **CORS 정책 제한**: 신뢰할 수 있는 도메인만 허용
4. **파일 크기 제한**: 버킷 정책에서 파일 크기 제한
5. **파일 타입 제한**: 허용되는 Content-Type 제한

### 더 안전한 대안:
- Pre-signed URL 사용 (백엔드에서 생성)
- STS 임시 자격증명 사용
- Cognito Identity Pool 사용

## 5. 사용법

### 기본 사용 (S3 업로드)
```javascript
import fileService from '../services/fileService';

const handleFileUpload = async (file) => {
  const result = await fileService.uploadFile(file, (progress) => {
    console.log(`Upload progress: ${progress}%`);
  });
  
  if (result.success) {
    console.log('Upload successful:', result.data);
  } else {
    console.error('Upload failed:', result.message);
  }
};
```

### 로컬 업로드 강제 사용
```javascript
const result = await fileService.uploadFile(file, onProgress, true); // forceLocal = true
```

### S3 업로드 비활성화
```bash
# frontend/.env.local
NEXT_PUBLIC_USE_S3_UPLOAD=false
```

## 6. 파일 구조

- `frontend/services/s3Service.js`: S3 직접 업로드 서비스
- `frontend/services/fileService.js`: 통합 파일 서비스 (S3/로컬 선택 가능)
- `backend/controllers/fileController.js`: 파일 메타데이터 저장 API
- `backend/models/File.js`: S3 URL 및 저장 타입 필드 추가
- `backend/routes/api/files.js`: 새로운 API 엔드포인트 추가

## 7. API 엔드포인트

### POST /api/files/save-metadata
S3 업로드 후 파일 메타데이터를 MongoDB에 저장

```json
{
  "filename": "1234567890_abcdef.jpg",
  "originalname": "photo.jpg",
  "mimetype": "image/jpeg",
  "size": 1024000,
  "s3Url": "https://bucket.s3.region.amazonaws.com/uploads/userid/filename.jpg",
  "s3Key": "uploads/userid/1234567890_abcdef.jpg"
}
```

## 8. 문제 해결

### S3 업로드 실패시
- 자격증명 확인
- 버킷 권한 확인
- CORS 설정 확인
- 네트워크 연결 확인

### 자동 폴백
S3 업로드가 실패하면 자동으로 로컬 업로드로 폴백됩니다.

### 에러 메시지
- "AWS 자격증명 또는 버킷 이름이 설정되지 않았습니다": 환경변수 확인
- "S3 접근 권한이 없습니다": IAM 권한 확인
- "S3 버킷을 찾을 수 없습니다": 버킷 이름 및 리전 확인 