#!/bin/zsh
# Double-click in Finder to keep the personal connection running in Terminal.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print 'Node.js 24 이상을 설치한 뒤 다시 실행해 주세요.'
  read '?Enter를 누르면 닫힙니다. '
  exit 1
fi
if ! command -v codex >/dev/null 2>&1; then
  print 'Codex CLI를 설치하고 codex login으로 ChatGPT에 로그인해 주세요.'
  read '?Enter를 누르면 닫힙니다. '
  exit 1
fi
node bridge/server.mjs
read '?Enter를 누르면 닫힙니다. '
