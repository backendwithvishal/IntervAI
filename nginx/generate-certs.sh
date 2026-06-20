#!/usr/bin/env bash
# generate-certs.sh — Generate self-signed TLS certs for local dev
# Usage: bash nginx/generate-certs.sh
# In production, use AWS ACM or Let's Encrypt (cert-manager in K8s)

set -e

CERT_DIR="$(dirname "$0")/certs"
mkdir -p "$CERT_DIR"

echo "🔐 Generating self-signed TLS certificates for local development..."

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.crt" \
  -subj "/C=US/ST=Dev/L=Local/O=IntervAI/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "✅ Certificates generated:"
echo "   Cert: $CERT_DIR/server.crt"
echo "   Key:  $CERT_DIR/server.key"
echo ""
echo "⚠️  These are self-signed — for production use AWS ACM or cert-manager."
