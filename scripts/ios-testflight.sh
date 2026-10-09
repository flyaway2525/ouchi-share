#!/bin/bash
# iPhone アプリ版を Archive して、App Store Connect（TestFlight）にアップロードする。Mac で実行する。
# 使い方：APPLE_TEAM_ID=<チーム ID> scripts/ios-testflight.sh
# - Team は project.pbxproj に書かず、ここで渡す（DEVELOPMENT_TEAM はコミットしない決まり）
# - ビルド番号は Web の版（js/version.js の APP_VERSION）と同じにする。先に bump-version.mjs で版を上げておく
# - アップロードのあと、App Store Connect の処理に 10〜30 分ほどかかる。内部グループ「自分」には自動で配られる
set -euo pipefail
cd "$(dirname "$0")/.."

: "${APPLE_TEAM_ID:?APPLE_TEAM_ID=<チーム ID> を付けて実行してください}"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
BUILD=$(sed -n 's/.*APP_VERSION = \([0-9]*\).*/\1/p' js/version.js)
ARCHIVE="$HOME/Library/Developer/Xcode/Archives/ouchi-share/v$BUILD.xcarchive"
WORK=$(mktemp -d)

npm run ios:sync

xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CURRENT_PROJECT_VERSION="$BUILD" \
  -allowProvisioningUpdates archive

cat > "$WORK/export.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$APPLE_TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
EOF

xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$WORK/export.plist" \
  -exportPath "$WORK/export" -allowProvisioningUpdates
rm -rf "$WORK"
echo "ビルド $BUILD をアップロードしました"
