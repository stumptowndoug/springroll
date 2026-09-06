#!/bin/zsh
set -eu
cd "${0:A:h}/.."
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
bun run dev:mac
