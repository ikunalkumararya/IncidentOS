# Deploy IncidentOS to AWS: ECR + EC2 + Docker

This guide uses the deployment files included in this repo. ECR stores two application images;
one EC2 instance runs the website, API/background investigator, and Caddy HTTPS proxy.
Your existing Neon PostgreSQL database stays on Neon. This is a single-server team deployment,
not a highly available cluster. No AWS resources have been created by adding these files.

## 1. What you need

- AWS account, AWS CLI v2 configured on your laptop, and Docker Desktop running.
- Permission to create ECR repositories and push images, and to create EC2, security groups,
  an Elastic IP, and an instance IAM role. Use your normal IAM/SSO identity, not root credentials.
- A domain/subdomain you control, such as `incidents.example.com`.
- Neon connection string, Anthropic API key, and an available Claude model ID.
- The repo on your laptop, including `Dockerfile`, `.dockerignore`, and `deploy/`.

All example domains/account IDs must be replaced. Never put credentials in Docker build arguments
or commit `.env` files. Rotate the credentials previously shared in chat before public deployment.

## 2. Architecture and repo files

```text
Browser -> https://incidents.example.com -> EC2: Caddy
                                           |-- web:3000 (Next.js)
                                           |-- api:4000 (Express + worker)
                                                      |-- Neon
                                                      |-- Anthropic API
```

| File | Purpose |
|---|---|
| `Dockerfile` | Separate `api` and `web` build targets |
| `.dockerignore` | Keeps credentials and local dependencies out of image builds |
| `deploy/compose.yml` | Runs the two ECR images and Caddy |
| `deploy/Caddyfile` | HTTPS and request routing |

Only ports 80 and 443 are published. `/api/report` and `/api/logs` stay with Next.js;
other `/api/*` paths go to Express. Everything uses the same public origin so session cookies
work for the dashboard and middleware. No Next.js rewrite change is needed with this proxy.
Caddy supports automatic certificates and HTTP-to-HTTPS redirects when the domain and ports are
configured correctly. [Caddy HTTPS documentation](https://caddyserver.com/docs/automatic-https)

## 3. Create ECR repositories — on your laptop

Run from the repository root. Choose your AWS region; this example uses Ohio, near the existing
Neon region. Use the same region throughout.

```bash
export AWS_REGION=us-east-2
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
export APP_DOMAIN=incidents.example.com
export IMAGE_TAG=v1

aws ecr create-repository --region "$AWS_REGION" --repository-name incidentos-api --image-scanning-configuration scanOnPush=true
aws ecr create-repository --region "$AWS_REGION" --repository-name incidentos-web --image-scanning-configuration scanOnPush=true
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
```

Create repositories once. For later releases, skip their creation. The registry login uses the AWS
CLI token rather than a stored AWS password. [AWS ECR instructions](https://docs.aws.amazon.com/AmazonECR/latest/userguide/getting-started-cli.html)

## 4. Build and push — on your laptop

Use `linux/amd64` for the x86 EC2 instance below, including when building on an Apple Silicon Mac.
The frontend API origin is compiled into the browser bundle, so supply the final HTTPS domain.

```bash
docker buildx build --platform linux/amd64 --target api -t "$ECR_REGISTRY/incidentos-api:$IMAGE_TAG" --push .
docker buildx build --platform linux/amd64 --target web --build-arg PUBLIC_ORIGIN="https://$APP_DOMAIN" -t "$ECR_REGISTRY/incidentos-web:$IMAGE_TAG" --push .
```

Both images retain the monorepo and development dependencies intentionally: the server currently
runs with `tsx`, and the optional demo investigator executes TypeScript tests in a sandbox.
Secrets are injected only at runtime. A failed build must be fixed before proceeding.

## 5. Launch EC2 — AWS console

1. Open EC2 in the selected region and choose **Launch instance**.
2. Name: `incidentos`. Image: **Ubuntu Server 24.04 LTS**, architecture **64-bit x86**.
3. Start with `t3.medium` (2 vCPU / 4 GiB) and a 30 GiB encrypted gp3 root volume. This is a
   starting size; watch memory if running the repository's test/memory demo.
4. Create/select an SSH key pair and save the `.pem` file privately.
5. Use a public subnet with an internet-gateway route and public IPv4 access.
6. Security group inbound rules:

| Port | Source | Purpose |
|---|---|---|
| TCP 22 | Your current public IP `/32` | SSH |
| TCP 80 | `0.0.0.0/0` | HTTP redirect/certificate validation |
| TCP 443 | `0.0.0.0/0` | HTTPS website and webhooks |

Do not open 3000, 4000, or 5432. Retain outbound access for ECR, package downloads, Neon, and
Anthropic. [AWS security groups](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/creating-security-group.html)

7. Attach an EC2 IAM instance role with `AmazonEC2ContainerRegistryReadOnly` so the server can pull
   images without personal AWS access keys. For stricter access, scope a custom pull policy to
   these two repository ARNs, with `ecr:GetAuthorizationToken` on `*`.
8. Allocate an Elastic IP and associate it with this instance.
9. At your DNS provider, create an **A record** for `incidents.example.com` pointing to that IP.
   Route 53 is optional; an existing DNS provider works. Wait until DNS resolves correctly.
   [AWS EC2 DNS routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-ec2-instance.html)

EC2, storage, public IPv4, ECR storage, and data transfer can incur charges. Set an AWS budget alert;
Neon and Anthropic billing remain separate.

## 6. Install Docker and AWS CLI — on EC2

Connect from your laptop:

```bash
chmod 400 ~/Downloads/incidentos.pem
ssh -i ~/Downloads/incidentos.pem ubuntu@YOUR_ELASTIC_IP
```

On EC2:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl unzip
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

Create `/etc/apt/sources.list.d/docker.sources` using `sudo nano` with:

```text
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
```

Then run:

```bash
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp/incidentos-awscli
sudo /tmp/incidentos-awscli/aws/install
aws sts get-caller-identity
sudo docker compose version
mkdir -p ~/incidentos/deploy
```

The identity check should show the attached EC2 role. Do not run `aws configure` with personal keys
on the instance. [Docker Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/),
[AWS CLI installation](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).

## 7. Copy deployment files and configure secrets

From your laptop, in the repo root:

```bash
scp -i ~/Downloads/incidentos.pem deploy/compose.yml deploy/Caddyfile ubuntu@YOUR_ELASTIC_IP:~/incidentos/deploy/
```

On EC2:

```bash
cd ~/incidentos/deploy
umask 077
nano .env
```

Write these non-secret deployment settings to `.env`:

```dotenv
ECR_REGISTRY=123456789012.dkr.ecr.us-east-2.amazonaws.com
IMAGE_TAG=v1
APP_DOMAIN=incidents.example.com
```

Create `api.env` with `nano api.env`:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@YOUR-NEON-POOLER/neondb?sslmode=require&channel_binding=require
DATABASE_CONNECT_TIMEOUT_MS=15000
PERSIST=1
ANTHROPIC_API_KEY=REPLACE_WITH_NEW_KEY
CLAUDE_MODEL=REPLACE_WITH_AVAILABLE_MODEL_ID
JWT_SECRET=REPLACE_WITH_RANDOM_SECRET
INCIDENT_WEBHOOK_SECRET=REPLACE_WITH_ANOTHER_RANDOM_SECRET
WEB_ORIGIN=https://incidents.example.com
SEED_DEMO_USER=0
DEMO_MODE=0
INVESTIGATION_TIMEOUT_MS=90000
```

Generate each secret separately with `openssl rand -hex 32`. Keep values stable across restarts.
Use the exact Neon URL from its Connect dialog, preserving SSL settings.

Create `web.env` with `nano web.env`:

```dotenv
NEXT_PUBLIC_API_BASE=https://incidents.example.com
INCIDENT_WEBHOOK_SECRET=SAME_WEBHOOK_SECRET_AS_API
```

```bash
chmod 600 .env api.env web.env
```

The Compose file sets internal API addresses automatically. The website does not need the Neon
password, JWT signing key, or Anthropic key. Changing its public domain requires rebuilding the
web image, not just changing `web.env`.

## 8. Pull images, initialize Neon, and start

On EC2, still in `~/incidentos/deploy`:

```bash
export AWS_REGION=us-east-2
export ECR_REGISTRY=123456789012.dkr.ecr.us-east-2.amazonaws.com
aws ecr get-login-password --region "$AWS_REGION" | sudo docker login --username AWS --password-stdin "$ECR_REGISTRY"
sudo docker compose pull
sudo docker compose run --rm api pnpm db:check
sudo docker compose run --rm api pnpm db:setup
sudo docker compose up -d
sudo docker compose ps
sudo docker compose logs --tail=100 api web proxy
```

Stop if either database command fails. Schema setup is additive and does not copy your local Docker
database or create a demo account. Existing Neon accounts remain available.

Caddy obtains the certificate after DNS points here and ports 80/443 are reachable. Then open:

```text
https://incidents.example.com
```

The Docker daemon starts at boot; `restart: unless-stopped` restarts these services after an EC2
reboot. The Caddy volumes preserve certificates. There is no need to run `pnpm dev` on the server.

## 9. Verify before sharing

1. Visit `/api/health`; confirm `persistence: true` (not merely `ok: true`).
2. Create a personal account at `/signup`, or sign in with an existing Neon account.
3. Verify signed-in visits to `/`, `/signin`, and `/signup` redirect to the dashboard.
4. Submit a small test incident. Confirm queued → investigating → needs review, or a visible failure
   if the AI configuration is wrong. This test consumes API credits.
5. Open `/report` and test a website report.
6. Send a signed log batch from the actual collector. See the README intake format; the included
   `/shop` and `/api/logs` flow is demo-generated telemetry, not an external monitoring connector.
7. Confirm profile, sign-out, and deletion work. Delete only the test incident.

This repository currently has open registration and a shared workspace: signed-in users can see
and delete shared incidents. `SEED_DEMO_USER=0` does not remove an existing demo account from Neon.
For a restricted team deployment, restrict registration and remove/disable public demo access
before publishing sensitive incidents. Public reporting can trigger paid investigations.

## 10. Updates and rollback

On your laptop, build and push a new immutable tag (for example `v2`) using step 4. On EC2, change
`IMAGE_TAG` in the deployment `.env`, then:

```bash
sudo docker compose pull
sudo docker compose stop api
sudo docker compose run --rm api pnpm db:setup
sudo docker compose up -d
sudo docker compose logs --tail=100 api web
```

Run setup successfully before starting the new version. Deploy during a quiet period: this
single-host setup has a short interruption. An active intake investigation can resume after its
lease expires; the demo's in-memory live stream cannot survive a restart.

To roll back app code, set `IMAGE_TAG` to the previous retained tag and run `pull` then `up -d`.
This does not roll back database schema or data; check compatibility first. Configure Neon backup
and recovery for your plan before relying on the deployment for important data.

Keep prior working tags in ECR. Do not run `docker compose down -v` during routine updates because
it deletes Caddy certificate volumes. Do not use the repo-root `docker-compose.yml` here: that file
is the local PostgreSQL setup, not the deployment stack.

## 11. Troubleshooting

| Symptom | Check |
|---|---|
| ECR access denied | EC2 role, region/account, repository names; repeat registry login |
| `exec format error` | Rebuild with `--platform linux/amd64` for the x86 instance |
| HTTPS unavailable | A record, security group 80/443, Caddy logs; remove incorrect AAAA records |
| Login loops / browser calls localhost | Rebuild web with the correct `PUBLIC_ORIGIN`; use HTTPS |
| Public report fails | Same webhook secret in both services; `/api/report` routed to Next |
| Investigation fails | API logs, valid model ID, API credentials, billing/quota, network access |
| Incidents stay queued | API container running, database available; inspect API logs |
| Demo falls back or fails | Fixture/recording availability and API configuration; intake never uses demo fallback |
| EC2 reboot loses demo recordings | They live in the container; Neon incidents remain persisted |

For ongoing operation, monitor EC2 disk/memory and container logs, install host security updates,
and periodically rebuild patched base images. The provided log limits prevent unbounded Docker
log growth. For high availability later, move the images to ECS services with an ALB and separate
worker lifecycle; that is outside this first-deployment guide.

## Validation status

These instructions and files are tailored to this repository. An actual AWS deployment, DNS,
certificate issuance, and live end-to-end verification must be performed in your account.
