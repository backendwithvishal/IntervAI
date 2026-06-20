terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.13"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "s3" {
    bucket         = "intervai-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "intervai-terraform-lock"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "IntervAI"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Owner       = "DevOps"
    }
  }
}

# ─── Variables ────────────────────────────────────────────────────────────────
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "environment must be dev, staging, or production."
  }
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "intervai-eks"
}

variable "node_instance_type" {
  description = "EC2 instance type for EKS nodes"
  type        = string
  default     = "t3.medium"
}

variable "min_nodes" {
  description = "Minimum EKS node count"
  type        = number
  default     = 2
}

variable "max_nodes" {
  description = "Maximum EKS node count"
  type        = number
  default     = 10
}

variable "desired_nodes" {
  description = "Desired EKS node count"
  type        = number
  default     = 3
}

# ─── Data Sources ─────────────────────────────────────────────────────────────
data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

# ─── VPC ──────────────────────────────────────────────────────────────────────
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "intervai-vpc-${var.environment}" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "intervai-igw-${var.environment}" }
}

resource "aws_subnet" "public" {
  count                   = 3
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet("10.0.0.0/16", 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = {
    Name                                          = "intervai-public-${count.index}-${var.environment}"
    "kubernetes.io/cluster/${var.cluster_name}"   = "shared"
    "kubernetes.io/role/elb"                      = "1"
  }
}

resource "aws_subnet" "private" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet("10.0.0.0/16", 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags = {
    Name                                          = "intervai-private-${count.index}-${var.environment}"
    "kubernetes.io/cluster/${var.cluster_name}"   = "shared"
    "kubernetes.io/role/internal-elb"             = "1"
  }
}

resource "aws_eip" "nat" {
  count  = 1
  domain = "vpc"
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "intervai-nat-${var.environment}" }
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "intervai-public-rt-${var.environment}" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
  tags = { Name = "intervai-private-rt-${var.environment}" }
}

resource "aws_route_table_association" "public" {
  count          = 3
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = 3
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# ─── EKS Cluster ──────────────────────────────────────────────────────────────
resource "aws_iam_role" "eks_cluster" {
  name = "intervai-eks-cluster-role-${var.environment}"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "eks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.eks_cluster.name
}

resource "aws_eks_cluster" "main" {
  name     = "${var.cluster_name}-${var.environment}"
  role_arn = aws_iam_role.eks_cluster.arn
  version  = "1.30"

  vpc_config {
    subnet_ids              = concat(aws_subnet.public[*].id, aws_subnet.private[*].id)
    endpoint_private_access = true
    endpoint_public_access  = true
    public_access_cidrs     = ["0.0.0.0/0"]
  }

  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]

  encryption_config {
    resources = ["secrets"]
    provider {
      key_arn = aws_kms_key.eks.arn
    }
  }

  depends_on = [aws_iam_role_policy_attachment.eks_cluster_policy]
  tags       = { Name = "${var.cluster_name}-${var.environment}" }
}

resource "aws_kms_key" "eks" {
  description             = "EKS secret encryption key"
  deletion_window_in_days = 10
  enable_key_rotation     = true
  tags                    = { Name = "intervai-eks-kms-${var.environment}" }
}

# ─── EKS Node Group ───────────────────────────────────────────────────────────
resource "aws_iam_role" "eks_nodes" {
  name = "intervai-eks-node-role-${var.environment}"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_worker_node_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.eks_nodes.name
}

resource "aws_iam_role_policy_attachment" "eks_cni_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.eks_nodes.name
}

resource "aws_iam_role_policy_attachment" "ecr_read_only" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.eks_nodes.name
}

resource "aws_eks_node_group" "main" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "intervai-nodes-${var.environment}"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = aws_subnet.private[*].id

  instance_types = [var.node_instance_type]
  ami_type       = "AL2_x86_64"
  disk_size      = 50

  scaling_config {
    min_size     = var.min_nodes
    max_size     = var.max_nodes
    desired_size = var.desired_nodes
  }

  update_config {
    max_unavailable = 1
  }

  labels = {
    role        = "worker"
    environment = var.environment
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_worker_node_policy,
    aws_iam_role_policy_attachment.eks_cni_policy,
    aws_iam_role_policy_attachment.ecr_read_only,
  ]
}

# ─── ElastiCache (Redis) ──────────────────────────────────────────────────────
resource "aws_elasticache_subnet_group" "main" {
  name       = "intervai-redis-subnets-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
}

resource "random_password" "redis" {
  length  = 32
  special = false
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "intervai-redis-${var.environment}"
  description                = "IntervAI Redis cluster for ${var.environment}"
  node_type                  = "cache.t3.micro"
  num_cache_clusters         = 2
  port                       = 6379
  parameter_group_name       = "default.redis7"
  engine_version             = "7.1"
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  auth_token                 = random_password.redis.result
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  automatic_failover_enabled = true
  multi_az_enabled           = true
  snapshot_retention_limit   = 7
  snapshot_window            = "02:00-03:00"

  tags = { Name = "intervai-redis-${var.environment}" }
}

# ─── Security Groups ──────────────────────────────────────────────────────────
resource "aws_security_group" "redis" {
  name        = "intervai-redis-sg-${var.environment}"
  description = "Security group for ElastiCache Redis"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
    description = "Redis access from VPC"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "intervai-redis-sg-${var.environment}" }
}

# ─── ECR Repositories ─────────────────────────────────────────────────────────
resource "aws_ecr_repository" "api" {
  name                 = "intervai-api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.eks.arn
  }

  tags = { Name = "intervai-api" }
}

resource "aws_ecr_repository" "worker" {
  name                 = "intervai-worker"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.eks.arn
  }

  tags = { Name = "intervai-worker" }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection    = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# ─── Outputs ──────────────────────────────────────────────────────────────────
output "eks_cluster_endpoint" {
  description = "EKS cluster endpoint"
  value       = aws_eks_cluster.main.endpoint
  sensitive   = false
}

output "ecr_api_url" {
  description = "ECR URL for the API image"
  value       = aws_ecr_repository.api.repository_url
}

output "ecr_worker_url" {
  description = "ECR URL for the worker image"
  value       = aws_ecr_repository.worker.repository_url
}

output "redis_endpoint" {
  description = "ElastiCache Redis primary endpoint"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
  sensitive   = true
}
