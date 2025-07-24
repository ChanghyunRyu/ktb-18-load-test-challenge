#!/bin/bash

# 사용법 및 스크립트 설명
# 이 스크립트는 지정된 YAML 파일에서 flowFunction, duration, arrivalRate, target 값을 원하는 값으로 변경합니다.
# 사용법: ./update_scenario.sh <새로운 flowFunction 값> <duration 값> <arrivalRate 값> <새로운 target 값>
# 사용 가능한 시나리오 function:
# - registerUser
# - loginUser
# - createNewChat
# - scrollChat
# - sendMessageToChat
# - reactToMessage
# - uploadFileToChat
# - updateProfileImage
# - generateChatAiResponse

NEW_FLOW_FUNCTION="$1"
DURATION=$2
ARRIVALRATE=$3
NEW_TARGET="$4"
TARGET_FILE="playwright-artillery.yml"
TARGET_APP_FILE="stresstest/app.js"

if [ -z "$NEW_FLOW_FUNCTION" ] || [ -z "$DURATION" ] || [ -z "$ARRIVALRATE" ] || [ -z "$NEW_TARGET" ]; then
  echo "사용법: $0 <새로운 flowFunction 값> <duration 값> <arrivalRate 값> <새로운 target 값>"
  echo "예시: $0 loginUser 5 10 https://new-domain.example.com"
  exit 1
fi

if [ ! -f "$TARGET_FILE" ]; then
  echo "파일이 존재하지 않습니다: $TARGET_FILE"
  echo "대상 파일 경로를 확인하세요."
  exit 1
fi

# flowFunction 값 변경
sed -i.bak "s/flowFunction: \"[^\"]*\"/flowFunction: \"$NEW_FLOW_FUNCTION\"/" "$TARGET_FILE"

# duration 값 변경
sed -i.bak -E "s/^[[:space:]]*-[[:space:]]*duration: [0-9]+/  - duration: $DURATION/" "$TARGET_FILE"

# arrivalRate 값 변경
sed -i.bak -E "s/^[[:space:]]*arrivalRate: [0-9]+/    arrivalRate: $ARRIVALRATE/" "$TARGET_FILE"

# target 값 변경 (target 문자열 기반)
sed -i.bak "s|target: .*|target: $NEW_TARGET|" "$TARGET_FILE"

sed -i.bak "s|const site = .*|const site = \"$NEW_TARGET\";|" "$TARGET_APP_FILE"

echo "flowFunction 값이 \"$NEW_FLOW_FUNCTION\"로, duration이 \"$DURATION\"으로, arrivalRate가 \"$ARRIVALRATE\"로, target이 \"$NEW_TARGET\"로 성공적으로 변경되었습니다!"
echo "대상 파일: $TARGET_FILE"

# 실행
artillery run "$TARGET_FILE" --output stress-test.json
artillery report stress-test.json