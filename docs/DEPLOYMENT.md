# IntervAI — Deployment Guide

> Complete guide for setting up and deploying IntervAI to production on AWS EKS.

---

## Prerequisites

| Tool       | Minimum Version | Install |
|------------|-----------------|---------|
| Node.js    | 20.x            | https://nodejs.org |
| Docker     | 24.x            | https://docs.docker.com/get-docker |
| kubectl    | 1.29+           | https://kubernetes.io/docs/tasks/tools |
| Terraform  | 1.7+            | https://developer.hashicorp.com/terraform/install |
| AWS CLI    | 2.x             | https://aws.amazon.com/cli |
| Helm       | 3.14+           | https://helm.sh/docs/intro/install |

---

## Local Development

```bash
# 1. Clone and install dependencies
git clone https://github.com/your-org/IntervAI.git
cd IntervAI
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your values

# 3. Start local stack (API + MongoDB + Redis)
docker-compose up -d mongodb redis

# 4. Start API in dev mode
npm run dev

# 5. (Optional) Start full stack with monitoring
docker-compose up -d
```

**Service URLs (local)**:
- API: http://localhost:5000
- Health: http://localhost:5000/health
- Metrics: http://localhost:5000/metrics
- Grafana: http://localhost:3001 (admin/admin123)
- Prometheus: http://localhost:9090

---

## CI/CD Pipeline (GitHub Actions)

The pipeline is defined in `.github/workflows/ci-cd.yml`.

### Triggers
| Branch / Event | Action |
|----------------|--------|
| `pull_request` → `main` | Lint + Test + Security scan |
| Push to `develop` | Deploy to Dev environment |
| Push to `staging` | Deploy to Staging environment |
| Push to `main` | Deploy to Production environment |

### Required GitHub Secrets

Go to **Settings → Secrets and Variables → Actions** and add:

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM access key with EKS/ECR permissions |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key |
| `AWS_REGION` | e.g. `us-east-1` |
| `ECR_REGISTRY` | ECR registry URL |
| `EKS_CLUSTER_NAME` | EKS cluster name |
| `MONGO_URI` | Production MongoDB URI |
| `JWT_SECRET` | JWT signing secret (min 32 chars) |
| `GROQ_API_KEY` | Groq API key |
| `REDIS_PASSWORD` | ElastiCache password |
| `EMAIL_USER` | SMTP email address |
| `EMAIL_PASS` | SMTP password |
| `IMAGEKIT_PRIVATE_KEY` | ImageKit private API key |
| `IMAGEKIT_PUBLIC_KEY` | ImageKit public API key |
| `IMAGEKIT_URL_ENDPOINT` | ImageKit URL endpoint |
| `CLIENT_URL` | Frontend URL (CORS origin) |
| `SLACK_WEBHOOK_URL` | Slack notification webhook |
| `SNYK_TOKEN` | Snyk security scanner token |

---

## Infrastructure Setup (First Time)

### 1. Bootstrap Terraform State

```bash
# Create S3 bucket for state (one-time)
aws s3 mb s3://intervai-terraform-state --region us-east-1
aws s3api put-bucket-versioning \
  --bucket intervai-terraform-state \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption \
  --bucket intervai-terraform-state \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# Create DynamoDB lock table
aws dynamodb create-table \
  --table-name intervai-terraform-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 2. Apply Infrastructure

```bash
cd terraform
terraform init
terraform plan -var-file="terraform.tfvars"
terraform apply -var-file="terraform.tfvars"
```

### 3. Configure kubectl

```bash
aws eks update-kubeconfig \
  --name intervai-eks-production \
  --region us-east-1
kubectl get nodes   # Verify cluster access
```

### 4. Install Cluster Add-ons

```bash
# AWS Load Balancer Controller
helm repo add eks https://aws.github.io/eks-charts
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=intervai-eks-production \
  --set serviceAccount.create=true

# EFS CSI Driver (for shared exports PVC)
helm repo add aws-efs-csi-driver https://kubernetes-sigs.github.io/aws-efs-csi-driver
helm install aws-efs-csi-driver aws-efs-csi-driver/aws-efs-csi-driver \
  -n kube-system

# Prometheus + Grafana (via kube-prometheus-stack)
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install kube-prometheus prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  --set grafana.adminPassword=ChangeMeInProd
```

### 5. Deploy Application

```bash
# Apply namespace + configs + secrets
kubectl apply -f k8s/ingress-secrets.yml
kubectl apply -f k8s/deployment.yml
kubectl apply -f k8s/hpa-pdb.yml

# Verify
kubectl get all -n intervai
kubectl rollout status deployment/intervai-api -n intervai
```

---

## Environment Variables Reference

See `.env.example` for the full list of all environment variables with descriptions.

---

## Health Verification

```bash
# API health check
curl https://api.yourdomain.com/health | jq

# Check all pods running
kubectl get pods -n intervai

# Check HPA status
kubectl get hpa -n intervai

# Check ingress
kubectl describe ingress intervai-ingress -n intervai
```
