# Chat browser checks

Run `npm ci`, `npx playwright install chromium webkit`, then `npm test` here.
The fixture serves Springroll's real chat renderer and styles with a simulated
backend. It does not start agents or access account data.

Checks run in Chromium, WebKit, and a phone-sized WebKit viewport. Screenshots
are written to `test-results/` for light/dark page and panel layouts. A Chromium
test also exercises native touch scrolling via the browser input protocol.
