#!/bin/bash
# Builds a signed App Store archive and exports an .ipa ready to upload.
#
#   APPLE_TEAM_ID=ABCDE12345 npm run ios:archive
#
# Needs a *paid* Apple Developer team signed in to Xcode (Settings → Accounts);
# a free Personal Team can't sign App Store builds. Signing is automatic: Xcode
# creates the distribution certificate/profile on first run. Nothing is
# uploaded — see docs/IOS_RELEASE.md for uploading the result.
set -euo pipefail

TEAM_ID="${APPLE_TEAM_ID:?Set APPLE_TEAM_ID to the paid team ID from developer.apple.com → Membership}"
# Must increase with every upload to App Store Connect.
BUILD_NUMBER="${BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/ios"
ARCHIVE="$OUT/LuddoHouse.xcarchive"

# Xcode's IPA packaging runs Apple's /usr/bin/rsync with an Apple-only
# option (--extended-attributes) and launches its peer rsync from PATH; a
# Homebrew rsync earlier on PATH rejects that option and the export fails
# with a bare "Copy failed". Keep the system tools first for Xcode.
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$ROOT"
echo "→ Building the web bundle and syncing it into the iOS project"
npm run cap:sync

rm -rf "$ARCHIVE" "$OUT/export"
echo "→ Archiving build $BUILD_NUMBER for team $TEAM_ID"
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  archive

EXPORT_OPTIONS="$OUT/ExportOptions.plist"
cat > "$EXPORT_OPTIONS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

echo "→ Exporting the .ipa"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -exportPath "$OUT/export" \
  -allowProvisioningUpdates

echo
echo "✓ Build $BUILD_NUMBER ready:"
echo "  Archive: $ARCHIVE   (open in Xcode → Window → Organizer to upload)"
echo "  IPA:     $(ls "$OUT"/export/*.ipa)"
