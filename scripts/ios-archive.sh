#!/bin/bash
# Builds a signed App Store archive and exports an .ipa ready to upload.
#
#   APPLE_TEAM_ID=ABCDE12345 npm run ios:archive              # build + .ipa
#   APPLE_TEAM_ID=ABCDE12345 npm run ios:archive -- --upload  # …and upload
#
# Needs a *paid* Apple Developer team signed in to Xcode (Settings → Accounts);
# a free Personal Team can't sign App Store builds. Signing is automatic: Xcode
# creates the distribution certificate/profile on first run. Without
# --upload nothing leaves this Mac; with it, the build is sent to App Store
# Connect using the Apple account signed in to Xcode (it then appears under
# TestFlight after Apple finishes processing, usually 15-30 minutes).
set -euo pipefail

UPLOAD=false
for arg in "$@"; do
  case "$arg" in
    --upload) UPLOAD=true ;;
    *) echo "Unknown option: $arg (supported: --upload)" >&2; exit 2 ;;
  esac
done

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

rm -rf "$ARCHIVE" "$OUT/export" "$OUT/upload"
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

# One ExportOptions.plist per destination: "export" writes an .ipa here,
# "upload" sends the same signed build to App Store Connect.
export_options() {
  cat > "$OUT/ExportOptions-$1.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$1</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST
  echo "$OUT/ExportOptions-$1.plist"
}

echo "→ Exporting the .ipa"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$(export_options export)" \
  -exportPath "$OUT/export" \
  -allowProvisioningUpdates

if [ "$UPLOAD" = true ]; then
  echo "→ Uploading build $BUILD_NUMBER to App Store Connect"
  xcodebuild \
    -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportOptionsPlist "$(export_options upload)" \
    -exportPath "$OUT/upload" \
    -allowProvisioningUpdates
fi

echo
echo "✓ Build $BUILD_NUMBER ready:"
echo "  Archive: $ARCHIVE   (open in Xcode → Window → Organizer to upload)"
echo "  IPA:     $(ls "$OUT"/export/*.ipa)"
if [ "$UPLOAD" = true ]; then
  echo "  Uploaded to App Store Connect — it appears under TestFlight once Apple finishes processing."
else
  echo "  Not uploaded. Run with --upload, or drag the .ipa into Transporter."
fi
