# IntervAI Operations Runbook

> **Audience**: On-call engineers, SREs  
> **Last Updated**: June 2026  
> **Severity Tiers**: P1 (Critical/Production Down) → P2 (Degraded) → P3 (Minor)

---

## Table of Contents
1. [On-Call Checklist](#on-call-checklist)
2. [Alert Response Playbooks](#alert-response-playbooks)
3. [Service Restart Procedures](#service-restart-procedures)
4. [Database Operations](#database-operations)
5. [Scaling Procedures](#scaling-procedures)
6. [Disaster Recovery](#disaster-recovery)
7. [Deployment Procedures](#deployment-procedures)
8. [Useful Commands](#useful-commands)

---

## On-Call Checklist

When you receive a PagerDuty alert:

- [ ] Acknowledge the alert within **5 minutes** (P1) / **30 minutes** (P2)
- [ ] Open Grafana dashboard: `http://grafana.internal:3001`
- [ ] Check `/health` endpoint: `curl https://api.yourdomain.com/health`
- [ ] Check active Prometheus alerts: `curl http://prometheus:9090/api/v1/alerts`
- [ ] Check recent deployments in GitHub Actions
- [ ] Declare incident in Slack `#incidents` channel
- [ ] Assign incident commander if P1

---

## Alert Response Playbooks

### 🔴 P1 — APIDown
**Trigger**: `up{job="intervai-api"} == 0` for 1 minute

**Steps**:
```bash
# 1. Check pod status
kubectl get pods -n intervai -l app=intervai-api

# 2. Check recent events
kubectl describe pods -n intervai -l app=intervai-api | tail -50

# 3. Check logs
kubectl logs -n intervai -l app=intervai-api --tail=100 --previous

# 4. Force a rollout restart if pods are crash-looping
kubectl rollout restart deployment/intervai-api -n intervai

# 5. Check if DB/Redis are reachable
kubectl exec -n intervai deploy/intervai-api -- node -e "
  const r = require('ioredis');
  const c = new r(process.env.REDIS_HOST);
  c.ping().then(v => { console.log('Redis:', v); process.exit(0); });
"
```

**Escalation**: If not resolved in 15 minutes → page backend lead.

---

### 🔴 P1 — HighErrorRate (> 5% 5xx)
**Trigger**: `rate(intervai_http_requests_total{status_code=~"5.."}[5m]) / rate(...) > 0.05`

**Steps**:
```bash
# 1. Identify failing routes
kubectl logs -n intervai -l app=intervai-api --tail=500 | grep '"statusCode":5'

# 2. Check for recent config/secret changes
kubectl get events -n intervai --sort-by='.lastTimestamp' | tail -20

# 3. Check MongoDB connection pool
kubectl exec -n intervai deploy/intervai-api -- node -e "
  const mongoose = require('mongoose');
  console.log('DB state:', mongoose.connection.readyState);
"

# 4. Roll back if recent deployment caused it
kubectl rollout undo deployment/intervai-api -n intervai
kubectl rollout status deployment/intervai-api -n intervai
```

---

### 🟡 P2 — HighLatency (p95 > 2s)
**Trigger**: p95 response time exceeds 2 seconds

**Steps**:
```bash
# 1. Check current replica count vs HPA
kubectl get hpa -n intervai

# 2. Manually scale up if HPA hasn't triggered
kubectl scale deployment intervai-api --replicas=6 -n intervai

# 3. Check if a specific route is slow (Prometheus query)
# In Grafana: histogram_quantile(0.95, rate(intervai_http_request_duration_seconds_bucket{route="/api/v1/session"}[5m]))

# 4. Check Node.js event loop lag
kubectl exec -n intervai deploy/intervai-api -- node -e "
  let prev = process.hrtime.bigint();
  setImmediate(() => {
    const lag = Number(process.hrtime.bigint() - prev) / 1e6;
    console.log('Event loop lag:', lag.toFixed(2), 'ms');
  });
"
```

---

### 🔴 P1 — MongoDBDown
**Trigger**: MongoDB exporter unreachable for 2 minutes

**Steps**:
```bash
# (Local/Docker Compose)
docker inspect intervai-mongodb | grep -A5 '"Health"'
docker logs intervai-mongodb --tail=50
docker restart intervai-mongodb

# (AWS DocumentDB / Atlas — check AWS console)
aws docdb describe-db-instances --region us-east-1 | jq '.DBInstances[].DBInstanceStatus'
```

---

### 🔴 P1 — RedisDown
**Trigger**: Redis exporter unreachable for 2 minutes

**Steps**:
```bash
# (Local)
docker restart intervai-redis

# (AWS ElastiCache)
aws elasticache describe-replication-groups --replication-group-id intervai-redis-production

# Verify worker reconnects
kubectl rollout restart deployment/intervai-worker -n intervai
```

---

## Service Restart Procedures

### Rolling Restart (Zero Downtime)
```bash
kubectl rollout restart deployment/intervai-api -n intervai
kubectl rollout restart deployment/intervai-worker -n intervai

# Watch progress
kubectl rollout status deployment/intervai-api -n intervai
```

### Emergency Rollback
```bash
# Roll back to previous version
kubectl rollout undo deployment/intervai-api -n intervai

# Roll back to a specific revision
kubectl rollout history deployment/intervai-api -n intervai
kubectl rollout undo deployment/intervai-api --to-revision=3 -n intervai
```

---

## Database Operations

### MongoDB — Manual Backup
```bash
# Via mongodump (in running container)
kubectl exec -n intervai deploy/intervai-api -- \
  mongodump --uri="$MONGO_URI" --archive=/tmp/backup.gz --gzip

kubectl cp intervai/$(kubectl get pod -n intervai -l app=intervai-api -o name | head -1 | cut -d/ -f2):/tmp/backup.gz ./backup-$(date +%Y%m%d).gz
```

### MongoDB — Check Index Health
```bash
kubectl exec -n intervai deploy/intervai-api -- node -e "
  import mongoose from 'mongoose';
  await mongoose.connect(process.env.MONGO_URI);
  const stats = await mongoose.connection.db.stats();
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
"
```

### Redis — Flush Rate Limit Keys (emergency)
```bash
kubectl exec -n intervai deploy/intervai-api -- node -e "
  const Redis = require('ioredis');
  const r = new Redis({ host: process.env.REDIS_HOST, password: process.env.REDIS_PASSWORD });
  r.keys('rl:*').then(keys => {
    if (keys.length) return r.del(...keys);
  }).then(() => { console.log('Rate limit keys cleared'); process.exit(0); });
"
```

---

## Scaling Procedures

### Manual Scale Up
```bash
# API: scale to 8 replicas immediately
kubectl scale deployment intervai-api --replicas=8 -n intervai

# Worker: scale to 4 replicas for high queue load
kubectl scale deployment intervai-worker --replicas=4 -n intervai
```

### Update HPA Limits (temporary)
```bash
kubectl patch hpa intervai-api-hpa -n intervai \
  -p '{"spec":{"maxReplicas":30}}'
```

---

## Deployment Procedures

### Standard Deployment (via CI/CD)
1. Merge PR to `main` → GitHub Actions triggers automatically
2. Monitor pipeline: GitHub → Actions tab
3. Watch Grafana for any spike in error rate after deploy
4. Confirm rollout: `kubectl rollout status deployment/intervai-api -n intervai`

### Hotfix Deployment
```bash
# 1. Create hotfix branch
git checkout -b hotfix/critical-fix main

# 2. Make fix, commit, push
git push origin hotfix/critical-fix

# 3. Create and merge PR directly to main (requires approval)
# 4. CI/CD auto-deploys
```

### Manual Image Deploy
```bash
# Build and push
docker build -t $ECR_URL/intervai-api:hotfix-v1 .
docker push $ECR_URL/intervai-api:hotfix-v1

# Update deployment image
kubectl set image deployment/intervai-api \
  api=$ECR_URL/intervai-api:hotfix-v1 -n intervai

kubectl rollout status deployment/intervai-api -n intervai
```

---

## Useful Commands

```bash
# Get all pods with resource usage
kubectl top pods -n intervai

# Follow API logs
kubectl logs -n intervai -l app=intervai-api -f --tail=100

# Follow worker logs
kubectl logs -n intervai -l app=intervai-worker -f --tail=100

# Get events for debugging
kubectl get events -n intervai --sort-by='.lastTimestamp'

# Describe a specific pod
kubectl describe pod <pod-name> -n intervai

# Get all resources in namespace
kubectl get all -n intervai

# Check ingress
kubectl describe ingress intervai-ingress -n intervai

# Port-forward Grafana locally
kubectl port-forward svc/grafana 3001:3000 -n monitoring

# Check Prometheus targets
curl http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'
```
