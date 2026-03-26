#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Túnel SSH para PostgreSQL (desenvolvimento local)
#
# Uso:
#   npm run tunnel          → abre o túnel em background
#   npm run tunnel:close    → fecha o túnel
#   npm run tunnel:status   → verifica se está ativo
#
# Pré-requisito: configurar SSH_USER e SSH_PORT abaixo (ou via env vars)
# ──────────────────────────────────────────────────────────────────────────────

SSH_HOST="${TUNNEL_SSH_HOST:-your.server.ip}"
SSH_PORT="${TUNNEL_SSH_PORT:-22}"        # ← ajuste se a porta SSH for diferente
SSH_USER="${TUNNEL_SSH_USER:-cesar}"     # ← ajuste para seu usuário SSH
SSH_KEY="${TUNNEL_SSH_KEY:-$HOME/.ssh/id_ed25519}"

PG_REMOTE_HOST="192.168.x.x"
PG_REMOTE_PORT="5432"
LOCAL_PORT="5433"   # porta local (evita conflito com PG local)

PID_FILE="/tmp/jarvis-pg-tunnel.pid"

CMD=$1

# ── status ────────────────────────────────────────────────────────────────────
check_status() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      echo "✓ Túnel ativo (PID $PID) → localhost:$LOCAL_PORT → $PG_REMOTE_HOST:$PG_REMOTE_PORT"
      return 0
    else
      echo "✗ PID file existe mas processo morreu — limpando"
      rm -f "$PID_FILE"
    fi
  else
    echo "✗ Túnel não está ativo"
  fi
  return 1
}

# ── open ──────────────────────────────────────────────────────────────────────
open_tunnel() {
  if check_status 2>/dev/null | grep -q "✓"; then
    echo "Túnel já está ativo."
    exit 0
  fi

  echo "Abrindo túnel SSH..."
  echo "  $SSH_USER@$SSH_HOST:$SSH_PORT → $PG_REMOTE_HOST:$PG_REMOTE_PORT"
  echo "  Local: localhost:$LOCAL_PORT"
  echo ""

  ssh -f -N \
    -p "$SSH_PORT" \
    -i "$SSH_KEY" \
    -L "$LOCAL_PORT:$PG_REMOTE_HOST:$PG_REMOTE_PORT" \
    -o StrictHostKeyChecking=no \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    "$SSH_USER@$SSH_HOST"

  if [ $? -eq 0 ]; then
    # Captura o PID do processo ssh que acabou de subir
    PID=$(pgrep -n -f "ssh.*$LOCAL_PORT:$PG_REMOTE_HOST:$PG_REMOTE_PORT")
    echo "$PID" > "$PID_FILE"
    echo "✓ Túnel aberto (PID $PID)"
    echo ""
    echo "Agora atualize .env.local:"
    echo "  PG_HOST=localhost"
    echo "  PG_PORT=$LOCAL_PORT"
  else
    echo "✗ Falha ao abrir o túnel"
    echo ""
    echo "Verifique SSH_USER e SSH_PORT no script scripts/tunnel-pg.sh"
    exit 1
  fi
}

# ── close ─────────────────────────────────────────────────────────────────────
close_tunnel() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill "$PID" 2>/dev/null; then
      echo "✓ Túnel fechado (PID $PID)"
    else
      echo "Processo $PID já não existia"
    fi
    rm -f "$PID_FILE"
  else
    # Tenta matar qualquer túnel com esse padrão
    PID=$(pgrep -f "ssh.*$LOCAL_PORT:$PG_REMOTE_HOST:$PG_REMOTE_PORT")
    if [ -n "$PID" ]; then
      kill "$PID" && echo "✓ Túnel fechado (PID $PID)"
    else
      echo "Nenhum túnel ativo encontrado"
    fi
  fi
}

# ── dispatch ──────────────────────────────────────────────────────────────────
case "$CMD" in
  close)  close_tunnel ;;
  status) check_status ;;
  *)      open_tunnel  ;;
esac
