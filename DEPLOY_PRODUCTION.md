# Lutic Production Deployment Guide (Oracle Cloud Free Tier + Cloudflare Free Tier + Clerk)

> [!IMPORTANT]
> This architecture exposes **ZERO public inbound web/database ports** on your Oracle Cloud VM. All client traffic enters through **Cloudflare Edge + WAF + Rate Limiting**, traverses an **outbound-only encrypted Cloudflare Tunnel (`cloudflared`)**, presents a verified **`x-lutic-origin-secret`** header, and reaches PostgreSQL/background workers only over an isolated **`internal: true` Docker network**.

---

## 1. Security Architecture Overview

1. **Network Perimeter (Zero Inbound Ports)**:
   - Oracle Cloud VCN + host UFW block **all** inbound traffic except your administrative SSH IP (or disable SSH ingress once Oracle Bastion / Cloudflare Access is active). Ports `80`, `443`, `3000`, `4000`, and `5432` are **never** exposed to the public internet.
2. **Edge Layer (Cloudflare Free Tier)**:
   - Cloudflare handles TLS 1.3 (`Full (Strict)`), Always Use HTTPS, Automatic HTTPS Rewrites, HSTS, Bot Fight Mode, Managed WAF rules, and Free-tier Rate Limiting rules on `/api/*`.
   - Cloudflare Transform Rule injects a secret header `x-lutic-origin-secret: <LUTIC_ORIGIN_LOCK_SECRET>` on every proxied request.
3. **Origin Lock Middleware (`apps/web/src/middleware.ts`)**:
   - Even if someone attempts direct access bypassing Cloudflare, `verifyOriginLock()` rejects requests lacking a constant-time match for `LUTIC_ORIGIN_LOCK_SECRET` with HTTP `403 Forbidden` (leaving only `/api/health/live` open for container healthchecks).
4. **Authentication (`LUTIC_CLERK_ONLY=true`)**:
   - Production uses **Clerk** (Email/Password + Google + Microsoft OAuth + Turnstile) with local `/api/auth/login` and `/api/auth/signup` disabled (`LUTIC_CLERK_ONLY=true`) so attackers cannot brute-force local password endpoints.
5. **Internal Docker Isolation (`docker-compose.yml`)**:
   - `postgres` sits strictly on `lutic_backend` (`internal: true`) — no internet egress and no public interface binding (`127.0.0.1:5432` only).
   - `lutic-paas` and `lutic-worker` drop all Linux capabilities (`cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`).
6. **Tenant & Plan Quotas (`packages/core/src/plan-limits.ts`)**:
   - New self-serve SaaS accounts start on the **Free** plan with server-enforced caps across DB transactions, API routes, and AI agents:
     - **Services**: max **3** enabled services (with a guided 0-service first-run walkthrough)
     - **AI Agents**: max **3** active service agents (plus workspace Overview Assistant)
     - **Connectors**: max **5** external integrations
     - **API Rate Limits**: `30 req/min` & `500 req/day` (returns HTTP `429` + `Retry-After`)
     - **AI Prompt / A2UI Limits**: `10 req/min` & `60 req/day`
     - **Agent Tool Calls**: `12 calls/min` & `100 calls/day`

---

## 2. Oracle Cloud Free Tier Setup (`VM.Standard.A1.Flex`)

1. Sign in to **Oracle Cloud Console** -> **Compute** -> **Instances** -> **Create Instance**:
   - Shape: `VM.Standard.A1.Flex` (Always Free Eligible ARM64)
   - OCPUs: `4`, Memory: `24 GB` (recommended Always Free ceiling), Boot Volume: `100 GB`
   - Image: **Ubuntu 24.04 Minimal ARM64** (or 22.04 ARM64)
   - Upload your SSH public key and reserve a static or ephemeral public IP (used only for initial SSH setup).
2. **Lock down the VCN Security List**:
   - Navigate to **Networking -> Virtual Cloud Networks -> Subnets -> Security Lists**.
   - Keep **only** TCP port `22` restricted to your static admin IP (or remove port `22` after setup).
   - Confirm **NO** ingress rules exist for `80`, `443`, `3000`, `4000`, or `5432`.
3. **Install Docker Engine, Compose v2, and Host Firewall (UFW)** over SSH:

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl openssl ufw git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"

# Default-deny all unsolicited incoming traffic; allow only SSH from your IP
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow proto tcp from <YOUR_ADMIN_IP>/32 to any port 22
sudo ufw --force enable
sudo ufw status verbose
```

Log out and back in so Docker group membership takes effect.

---

## 3. Clerk Production Setup

1. Create a **Production** instance in Clerk Dashboard for your domain (e.g. `lutic.app`).
2. Under **Domains / DNS**, add the CNAME records Clerk requires into Cloudflare DNS as **DNS Only (grey cloud)**:
   - `clerk.<your-domain>`
   - `accounts.<your-domain>`
   - DKIM/SPF TXT/CNAME records for transactional emails.
3. Under **User & Authentication -> Social Connections**, enable **Google** and **Microsoft** (Free tier supports both).
4. Copy your **Live Keys** from **API Keys**:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...`
   - `CLERK_SECRET_KEY=sk_live_...`

---

## 4. Cloudflare Free Tier Setup (Tunnel, Origin Lock & WAF)

1. **Add your domain** (`lutic.app`) to Cloudflare Free Tier and verify `SSL/TLS` -> **Overview** is set to **Full (Strict)**.
2. **Create a Zero Trust Tunnel (`cloudflared`)**:
   - Go to **Zero Trust -> Networks -> Tunnels -> Create a tunnel -> Cloudflared**.
   - Name it `lutic-oracle-prod` and copy the **Tunnel Token** (`CLOUDFLARE_TUNNEL_TOKEN`).
   - Add a **Public Hostname**:
     - Domain: `<your-domain>` (e.g. `app.lutic.app` or apex `lutic.app`)
     - Service Type: `HTTP`
     - URL: `lutic-paas:3000`
3. **Create the Origin Lock Transform Rule** (after generating `.env.production` in Step 5 to obtain `LUTIC_ORIGIN_LOCK_SECRET`):
   - Go to **Rules -> Transform Rules -> Modify Request Header -> Create rule**.
   - Name: `Inject Lutic Origin Secret`
   - Filter: **All incoming requests**
   - Header Modification -> **Set static**:
     - Header name: `x-lutic-origin-secret`
     - Value: exact value of `LUTIC_ORIGIN_LOCK_SECRET` from `.env.production`
4. **Harden Cloudflare Free Security Settings**:
   - **SSL/TLS -> Edge Certificates**: Enable **Always Use HTTPS**, **Minimum TLS 1.2**, and **HTTP Strict Transport Security (HSTS)** (`max-age=63072000`, `Include subdomains`).
   - **Security -> Bots**: Enable **Bot Fight Mode**.
   - **Security -> WAF -> Rate limiting rules -> Create rule** (Free tier allows 1 rule):
     - If URI Path starts with `/api/` -> threshold `60 requests per 10 seconds` -> Action: **Block** (protects your VM CPU before requests even enter the tunnel).

---

## 5. Deploy Lutic on the Oracle VM

1. **Clone the repository and generate cryptographic secrets**:

```bash
git clone https://github.com/AyanShah17/Lutic.git /opt/lutic
cd /opt/lutic
bash deploy/lutic.sh prepare
chmod 600 .env.production
grep LUTIC_ORIGIN_LOCK_SECRET .env.production
```

2. **Copy that `LUTIC_ORIGIN_LOCK_SECRET` value into your Cloudflare Request Header Transform Rule (Step 4.3).**
3. **Edit `.env.production`** to fill in your production Clerk, Cloudflare Tunnel, and AI Gateway keys:

```dotenv
# Clerk Production Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
NEXT_PUBLIC_CLERK_OAUTH_PROVIDERS=google,microsoft
LUTIC_DEPLOYMENT_PLAN=free
LUTIC_CLERK_ONLY=true

# Cloudflare Tunnel & Origin Lock
CLOUDFLARE_TUNNEL_TOKEN=<your-tunnel-token>
LUTIC_TRUST_CLOUDFLARE_PROXY=true
# LUTIC_ORIGIN_LOCK_SECRET is already auto-generated above

# LLM & Dense Embeddings (configure LiteLLM / Anthropic / OpenAI)
LLM_PROVIDER=lutic
LLM_MODEL=lutic-claude
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
EMBEDDING_PROVIDER=openai

# Licensing & CORS
LICENSE_ENFORCE=false
COOKIE_SECURE=true
CORS_ORIGINS=https://lutic.app,https://app.lutic.app
```

4. **Build and bootstrap PostgreSQL schema + owner tenant (runs once)**:

```bash
docker compose --env-file .env.production build lutic-paas lutic-worker
LUTIC_TENANT_NAME="Lutic Root Workspace" \
LUTIC_PLANT_NAME="Primary Region" \
LUTIC_ADMIN_EMAIL="owner@yourdomain.com" \
LUTIC_ADMIN_PASSWORD="<strong-32-char-password>" \
  bash deploy/lutic.sh bootstrap
```

5. **Start the full isolated stack including `cloudflared` tunnel**:

```bash
docker compose --env-file .env.production --profile cloudflare up -d
docker compose --env-file .env.production --profile cloudflare ps
```

---

## 6. Post-Deployment Security & Health Verification Checklist

Run every check below before opening traffic to clients:

1. **Public IP Scan (Must Fail Externally)**:
   - From a separate machine, verify `curl -I --max-time 5 http://<ORACLE_PUBLIC_IP>:3000` and `nc -zv <ORACLE_PUBLIC_IP> 5432` **time out / fail** (zero open public web/DB ports).
2. **Origin Lock Check (On VM via SSH)**:
   - Direct request without header must return `403`:
     ```bash
     curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/connectors
     # Expected: 403
     ```
   - Request with secret must pass origin lock (returning `401` Unauthorized until signed in):
     ```bash
     SECRET="$(grep '^LUTIC_ORIGIN_LOCK_SECRET=' .env.production | cut -d= -f2)"
     curl -s -o /dev/null -w "%{http_code}\n" -H "x-lutic-origin-secret: $SECRET" http://127.0.0.1:3000/api/connectors
     # Expected: 401
     ```
   - Health liveness check returns `200`:
     ```bash
     curl -fsS http://127.0.0.1:3000/api/health/live
     ```
3. **End-to-End HTTPS Walkthrough**:
   - Open `https://<your-domain>` in a browser -> sign up with Clerk -> confirm the **0-service First-Run Walkthrough** appears, lets you choose up to **3 services** (4th blocked on Free plan), launches your custom dashboard + **A2UI** prompt-built view, and enforces the **5-connector** cap in `/connectors`.
4. **Automated Encrypted Backups**:
   - Schedule daily encrypted backups using `deploy/backup-restore.sh`:
     ```bash
     bash deploy/backup-restore.sh backup --output /opt/lutic-backups/lutic-$(date +%F).dump --encrypt
     ```
