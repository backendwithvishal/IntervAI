# IntervAI Disaster Recovery Plan

> **RTO (Recovery Time Objective)**: < 30 minutes  
> **RPO (Recovery Point Objective)**: < 1 hour  
> **Last Reviewed**: June 2026

---

## Disaster Scenarios & Response

---

### Scenario 1: Full Region Failure (AWS us-east-1 down)

**Detection**: Grafana/PagerDuty fires all alerts simultaneously; CloudWatch alarms trigger.

**Response**:

1. **Declare DR Event** — ping `#incidents`, notify stakeholders
2. **Activate standby region** (us-west-2):
   ```bash
   # Switch Terraform workspace to DR region
   cd terraform
   terraform workspace select dr
   terraform apply -var="aws_region=us-west-2" -var="environment=production"
   ```
3. **Point DNS to DR ALB** (pre-configured Route 53 health-check failover):
   ```bash
   aws route53 change-resource-record-sets \
     --hosted-zone-id YOUR_ZONE_ID \
     --change-batch file://dns-failover.json
   ```
4. **Restore latest MongoDB Atlas backup** (Atlas auto-snapshots every hour)
5. **Verify service** — run smoke test suite against DR endpoint
6. **Communicate** — update status page

**RTO Target**: 25 minutes

---

### Scenario 2: Database (MongoDB) Corruption / Data Loss

**Detection**: Application 500 errors referencing MongoDB; data inconsistencies reported.

**Response**:

1. **Stop writes immediately**:
   ```bash
   # Scale API to 0 (stops all writes)
   kubectl scale deployment intervai-api --replicas=0 -n intervai
   ```
2. **Identify last clean backup**:
   ```bash
   # Atlas — list snapshots
   atlas backups snapshots list --clusterName IntervAI-Prod

   # S3 (if mongodump backups configured)
   aws s3 ls s3://intervai-backups/mongodb/ --recursive | sort | tail -10
   ```
3. **Restore snapshot**:
   ```bash
   # Atlas point-in-time restore
   atlas backups restores start automated \
     --clusterName IntervAI-Prod \
     --snapshotId <SNAPSHOT_ID> \
     --targetClusterName IntervAI-Restore

   # Mongorestore from S3 dump
   aws s3 cp s3://intervai-backups/mongodb/latest.gz /tmp/
   mongorestore --uri="$MONGO_URI_RESTORE" --archive=/tmp/latest.gz --gzip
   ```
4. **Validate data integrity**:
   ```bash
   node -e "
     import mongoose from 'mongoose';
     await mongoose.connect(process.env.MONGO_URI);
     const count = await mongoose.connection.db.collection('users').countDocuments();
     console.log('Users:', count);
     process.exit(0);
   "
   ```
5. **Resume service**:
   ```bash
   kubectl scale deployment intervai-api --replicas=3 -n intervai
   ```

---

### Scenario 3: Security Breach / Compromised Secrets

**Detection**: Unusual API activity; anomalous auth patterns; security scan alert.

**Response** (execute within 10 minutes):

1. **Immediately rotate ALL secrets**:
   ```bash
   # Generate new JWT secret
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

   # Update AWS Secrets Manager
   aws secretsmanager put-secret-value \
     --secret-id intervai/production \
     --secret-string '{"JWT_SECRET":"<NEW_SECRET>","GROQ_API_KEY":"<ROTATED>"}'
   ```
2. **Invalidate all active sessions** (flush Redis JWT blocklist):
   ```bash
   kubectl exec -n intervai deploy/intervai-api -- node -e "
     const Redis = require('ioredis');
     const r = new Redis({ host: process.env.REDIS_HOST, password: process.env.REDIS_PASSWORD });
     r.keys('session:*').then(keys => r.del(...keys))
       .then(() => { console.log('All sessions invalidated'); process.exit(0); });
   "
   ```
3. **Rotate K8s secrets**:
   ```bash
   kubectl delete secret intervai-secrets -n intervai
   kubectl apply -f k8s/ingress-secrets.yml
   kubectl rollout restart deployment/intervai-api -n intervai
   kubectl rollout restart deployment/intervai-worker -n intervai
   ```
4. **Enable maintenance mode** (Nginx 503 page)
5. **Audit access logs** — export and analyze last 24h of CloudTrail / ALB access logs
6. **Notify affected users** if PII may have been exposed (legal/compliance obligation)

---

### Scenario 4: Worker Queue Backlog / Stuck Jobs

**Detection**: Redis queue length spike; AI feedback not being delivered.

**Response**:
```bash
# 1. Check queue depth
kubectl exec -n intervai deploy/intervai-worker -- node -e "
  const Queue = require('bull');
  const q = new Queue('interview-feedback', { redis: { host: process.env.REDIS_HOST } });
  q.getJobCounts().then(c => { console.log(JSON.stringify(c, null, 2)); process.exit(0); });
"

# 2. Scale workers up
kubectl scale deployment intervai-worker --replicas=6 -n intervai

# 3. If jobs are permanently stuck (failed), clean them
kubectl exec -n intervai deploy/intervai-worker -- node -e "
  const Queue = require('bull');
  const q = new Queue('interview-feedback', { redis: { host: process.env.REDIS_HOST } });
  q.clean(0, 'failed').then(() => { console.log('Failed jobs cleaned'); process.exit(0); });
"

# 4. Monitor drain
watch -n 5 'kubectl exec -n intervai deploy/intervai-worker -- node -e "
  const Queue = require(\"bull\");
  const q = new Queue(\"interview-feedback\", { redis: { host: process.env.REDIS_HOST } });
  q.getJobCounts().then(c => console.log(JSON.stringify(c)));
"'
```

---

## Communication Templates

### Incident Declaration (Slack `#incidents`)
```
🚨 INCIDENT DECLARED — P1
Service: IntervAI API
Impact: [describe]
Status: Investigating
IC: @your-name
Bridge: [zoom link]
```

### Status Update (every 15 min during P1)
```
📊 INCIDENT UPDATE — [HH:MM]
Status: [Investigating / Mitigating / Resolved]
Impact: [current user impact]
Next update: [HH:MM]
```

### Resolution
```
✅ INCIDENT RESOLVED — [HH:MM]
Duration: [X minutes]
Root Cause: [brief description]
Fix: [what was done]
Follow-up: [link to post-mortem ticket]
```

---

## Post-Mortem Template

File post-mortems within 48 hours of P1 incidents:

```markdown
# Post-Mortem: [Title] — [Date]

## Summary
[1-2 sentence summary]

## Timeline
- HH:MM — [event]
- HH:MM — [event]

## Root Cause
[Technical root cause]

## Impact
- Duration: X minutes
- Users affected: N
- Revenue impact: $X

## What Went Well
- [item]

## What Went Poorly
- [item]

## Action Items
| Item | Owner | Due Date |
|------|-------|----------|
| [fix] | @person | [date] |
```
