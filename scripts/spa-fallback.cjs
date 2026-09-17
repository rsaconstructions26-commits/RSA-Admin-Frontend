/**
 * SPA fallback for static hosting.
 *
 * The app is a single-page app: React Router owns /billing, /labour, /voucher
 * and the rest. A static host knows nothing about those paths - it looks for a
 * file called "billing", does not find one, and returns its own bare
 * "Not Found" page. That is why opening a deep link, refreshing, or coming
 * back to a bookmarked URL died instead of landing on the login screen.
 *
 * The real fix is a rewrite rule on the host (see DEPLOY notes). This copies
 * index.html to 404.html as well, which several static hosts serve for unknown
 * paths - so the app boots, React Router reads the URL, and the auth guard
 * sends an unauthenticated visitor to the login page as it should.
 */
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const index = path.join(dist, 'index.html');

if (!fs.existsSync(index)) {
  console.error('spa-fallback: dist/index.html not found - did the build run?');
  process.exit(1);
}

for (const name of ['404.html', '200.html']) {
  fs.copyFileSync(index, path.join(dist, name));
  console.log(`spa-fallback: wrote dist/${name}`);
}
