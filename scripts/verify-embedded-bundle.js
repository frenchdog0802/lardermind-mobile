/**
 * Verify the debug APK embeds a JS bundle (Path A sanity check).
 * Usage: node scripts/verify-embedded-bundle.js [path-to-apk]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const apkPath =
  process.env.E2E_APK_PATH ||
  process.argv[2] ||
  (() => {
    const release = path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
    const debug = path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
    return fs.existsSync(release) ? release : debug;
  })();

if (!fs.existsSync(apkPath)) {
  console.error(`[e2e] APK not found: ${apkPath}`);
  console.error('Run: npm run android:e2e');
  process.exit(1);
}

const extractDir = path.join(require('os').tmpdir(), 'lardermind-apk-check');
fs.mkdirSync(extractDir, { recursive: true });
const bundlePath = path.join(extractDir, 'assets', 'index.android.bundle');

try {
  execSync(`tar -xf "${apkPath}" -C "${extractDir}" assets/index.android.bundle`, {
    stdio: 'pipe',
    shell: true,
  });
} catch (err) {
  console.error('[e2e] Failed to extract assets/index.android.bundle from APK');
  process.exit(1);
}

if (!fs.existsSync(bundlePath)) {
  console.error('[e2e] APK has no assets/index.android.bundle — debuggableVariants=[] may not be applied');
  process.exit(1);
}

const bytes = fs.readFileSync(bundlePath);
const markers = ['shoppingList', 'itemsToBuy', 'home-screen'];
const found = markers.filter((m) => {
  const needle = Buffer.from(m, 'utf8');
  return bytes.includes(needle);
});

console.log(`[e2e] Embedded bundle: ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`[e2e] Markers found: ${found.join(', ') || '(none)'}`);

if (found.length < 2) {
  console.error('[e2e] Embedded bundle looks stale or empty — rebuild with npm run android:e2e');
  process.exit(1);
}

console.log('[e2e] Embedded bundle OK');
