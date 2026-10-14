#!/usr/bin/env bash
# Install what the Browser app needs when it's missing (a new or restored machine): agent-browser
# and a Chromium for it. Run before browser.service starts; quick when everything's there.
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"
if ! command -v agent-browser >/dev/null; then
  echo "Installing agent-browser"
  npm i -g agent-browser >/dev/null 2>&1 || echo "agent-browser install failed"
fi
if ! ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome >/dev/null 2>&1; then
  echo "Installing Chromium"
  npx -y playwright install chromium >/dev/null 2>&1 || agent-browser install >/dev/null 2>&1 || echo "Chromium install failed"
fi
exit 0
