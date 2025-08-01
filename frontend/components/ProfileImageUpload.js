import React, { useState, useRef, useEffect } from 'react';
import { CameraIcon, CloseOutlineIcon } from '@vapor-ui/icons';
import { Button, Text, Callout, IconButton } from '@vapor-ui/core';
import authService from '../services/authService';
import s3Service from '../services/s3Service';
import PersistentAvatar from './common/PersistentAvatar';

const ProfileImageUpload = ({ currentImage, onImageChange }) => {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);

  // URL 정리 함수 - 잘못된 형식 수정
  const cleanUrl = (url) => {
    if (!url) return url;
    
    // https// -> https:// 수정
    if (url.startsWith('https//')) {
      return url.replace('https//', 'https://');
    }
    
    // 중복된 도메인 제거 - https// 패턴도 포함
    const domainPattern = /https:\/\/[^\/]+https:?\/?\/\//;
    if (domainPattern.test(url)) {
      // 첫 번째 도메인 부분을 제거하고 두 번째 https 부분부터 반환
      const match = url.match(/https:\/\/[^\/]+(https:?\/?\/\/.+)/);
      if (match && match[1]) {
        // https// -> https:// 로 수정
        return match[1].replace(/^https:?\/?\/\//, 'https://');
      }
    }
    
    return url;
  };

  // 프로필 이미지 URL 생성
  const getProfileImageUrl = (imagePath) => {
    console.log('getProfileImageUrl input:', imagePath);
    
    if (!imagePath) return null;
    
    // URL 정리
    const cleanedPath = cleanUrl(imagePath);
    console.log('Cleaned URL:', cleanedPath);
    
    // S3 URL인 경우 그대로 반환
    if (cleanedPath.includes('s3.amazonaws.com') || cleanedPath.startsWith('https://')) {
      console.log('Detected S3 URL, returning as-is:', cleanedPath);
      return cleanedPath;
    }
    
    // 로컬 파일인 경우 API URL 추가
    const result = cleanedPath.startsWith('/') ? 
      `${process.env.NEXT_PUBLIC_API_URL}${cleanedPath}` : 
      `${process.env.NEXT_PUBLIC_API_URL}/${cleanedPath}`;
    
    console.log('Generated local URL:', result);
    return result;
  };

  // 컴포넌트 마운트 시 이미지 설정
  useEffect(() => {
    const imageUrl = getProfileImageUrl(currentImage);
    setPreviewUrl(imageUrl);
  }, [currentImage]);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // 이미지 파일 검증
      if (!file.type.startsWith('image/')) {
        throw new Error('이미지 파일만 업로드할 수 있습니다.');
      }

      // 파일 크기 제한 (5MB)
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('파일 크기는 5MB를 초과할 수 없습니다.');
      }

      setUploading(true);
      setError('');
      setUploadProgress(0);

      // 파일 미리보기 생성
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);

      // S3에 파일 업로드
      const uploadResult = await s3Service.uploadProfileImage(file, (progress) => {
        setUploadProgress(Math.floor(progress * 0.9)); // 90%까지는 S3 업로드
      });

      if (!uploadResult.success) {
        throw new Error(uploadResult.message || 'S3 업로드에 실패했습니다.');
      }

      setUploadProgress(90);

      // 백엔드에 메타데이터 저장
      const user = authService.getCurrentUser();
      if (!user?.token || !user?.sessionId) {
        throw new Error('인증 정보가 없습니다.');
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/profile-image-s3`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': user.token,
          'x-session-id': user.sessionId
        },
        body: JSON.stringify({
          s3Url: uploadResult.data.s3Url,
          s3Key: uploadResult.data.s3Key
        })
      });

      console.log('=== 백엔드로 보내는 데이터 ===');
      console.log('s3Url:', uploadResult.data.s3Url);
      console.log('s3Key:', uploadResult.data.s3Key);
      console.log('============================');

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '프로필 이미지 저장에 실패했습니다.');
      }

      const data = await response.json();
      setUploadProgress(100);

      console.log('=== 백엔드 응답 데이터 ===');
      console.log('전체 응답:', data);
      console.log('imageUrl:', data.imageUrl);
      console.log('imageUrl 타입:', typeof data.imageUrl);
      console.log('URL 시작 체크:', data.imageUrl?.substring(0, 30));
      console.log('========================');

      // 로컬 스토리지의 사용자 정보 업데이트
      const updatedUser = {
        ...user,
        profileImage: data.imageUrl
      };
      
      console.log('=== localStorage 업데이트 ===');
      console.log('기존 user.profileImage:', user.profileImage);
      console.log('새로운 profileImage:', data.imageUrl);
      console.log('업데이트된 사용자 객체:', updatedUser);
      console.log('===========================');
      
      localStorage.setItem('user', JSON.stringify(updatedUser));

      // 부모 컴포넌트에 변경 알림
      onImageChange(data.imageUrl);

      // 전역 이벤트 발생
      window.dispatchEvent(new Event('userProfileUpdate'));

      console.log('=== 이벤트 발생 완료 ===');
      console.log('onImageChange 호출됨:', data.imageUrl);
      console.log('userProfileUpdate 이벤트 발생됨');
      console.log('======================');

      // 미리보기 URL을 S3 URL로 업데이트
      if (objectUrl && objectUrl.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
      }
      console.log('Setting preview URL to:', data.imageUrl);
      setPreviewUrl(cleanUrl(data.imageUrl));

    } catch (error) {
      console.error('Image upload error:', error);
      setError(error.message);
      setPreviewUrl(getProfileImageUrl(currentImage));
      
      // 기존 objectUrl 정리
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveImage = async () => {
    try {
      setUploading(true);
      setError('');

      const user = authService.getCurrentUser();
      if (!user?.token) {
        throw new Error('인증 정보가 없습니다.');
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/profile-image`, {
        method: 'DELETE',
        headers: {
          'x-auth-token': user.token,
          'x-session-id': user.sessionId
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '이미지 삭제에 실패했습니다.');
      }

      // 로컬 스토리지의 사용자 정보 업데이트
      const updatedUser = {
        ...user,
        profileImage: ''
      };
      localStorage.setItem('user', JSON.stringify(updatedUser));

      // 기존 objectUrl 정리
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }

      setPreviewUrl(null);
      onImageChange('');

      // 전역 이벤트 발생
      window.dispatchEvent(new Event('userProfileUpdate'));

    } catch (error) {
      console.error('Image removal error:', error);
      setError(error.message);
    } finally {
      setUploading(false);
    }
  };

  // 컴포넌트 언마운트 시 cleanup
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // 현재 사용자 정보
  const currentUser = authService.getCurrentUser();

  return (
    <div>
      <div>
        <PersistentAvatar
          user={currentUser}
          size="xl"
          className="mx-auto mb-2"
          showInitials={true}
        />
        
        <div className="mt-2">
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            size="sm"
          >
            <CameraIcon size={16} />
            <span style={{ marginLeft: '8px' }}>이미지 변경</span>
          </Button>

          {previewUrl && (
            <IconButton
              variant="outline"
              color="danger"
              onClick={handleRemoveImage}
              disabled={uploading}
              style={{ marginLeft: '8px' }}
            >
              <CloseOutlineIcon size={16} />
            </IconButton>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/*"
        onChange={handleFileSelect}
      />

      {error && (
        <div className="w-full max-w-sm mx-auto">
          <Callout color="danger" className="mt-2">
            {error}
          </Callout>
        </div>
      )}

      {uploading && (
        <div className="w-full max-w-sm mx-auto mt-2">
          <Text typography="body3" color="neutral-weak" className="text-center">
            이미지 업로드 중... {uploadProgress > 0 && `${uploadProgress}%`}
          </Text>
          {uploadProgress > 0 && (
            <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProfileImageUpload;