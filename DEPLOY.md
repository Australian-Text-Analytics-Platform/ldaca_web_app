# Deployment Guide

This document covers how to deploy and maintain the LDaCA Text Analytics Web Application in production.

---

## Architecture Overview

```
Internet → Nginx (80/443) → FastAPI app (localhost:8001)
```

- **Nginx** handles HTTPS termination and reverse proxies to the app
- **Let's Encrypt** (via Certbot) provides the TLS certificate
- **systemd** manages the app process (auto-start on boot, auto-restart on failure)

---

## Server Requirements

- Ubuntu 22.04+
- `nginx`
- `certbot` with `python3-certbot-nginx`
- `uv` (installed at `/home/ubuntu/.local/bin/uv`)
- DNS A record pointing the domain to the server's public IP

---

## Initial Deployment

### 1. Clone / update the app

```bash
cd /home/ubuntu/src/ldaca_web_app
git pull
```

### 2. Configure Nginx

Create `/etc/nginx/sites-available/analytics.ldaca.edu.au`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name analytics.ldaca.edu.au;

    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

Enable the site and reload Nginx:

```bash
sudo ln -sf /etc/nginx/sites-available/analytics.ldaca.edu.au /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 3. Obtain TLS Certificate

> **Prerequisite:** Ports 80 and 443 must be open inbound on the cloud firewall / security group.

```bash
sudo certbot --nginx -d analytics.ldaca.edu.au --non-interactive --agree-tos \
  -m admin@ldaca.edu.au --redirect
```

Certbot will automatically update the Nginx config to serve HTTPS and redirect HTTP → HTTPS.
Certificates are renewed automatically via a systemd timer — no manual renewal needed.

### 4. Install the systemd Service

The service file is located at `/etc/systemd/system/ldaca-web-app.service`.
To install it from scratch:

```bash
sudo cp /home/ubuntu/ldaca-web-app.service /etc/systemd/system/ldaca-web-app.service
sudo systemctl daemon-reload
sudo systemctl enable ldaca-web-app
sudo systemctl start ldaca-web-app
```

The service file content:

```ini
[Unit]
Description=LDaCA Text Analytics Web Application
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/src/ldaca_web_app
Environment="GOOGLE_CLIENT_ID=460163662698-lof601jcnsk9ugjjr3dpjqn31bv6krem.apps.googleusercontent.com"
ExecStart=/home/ubuntu/.local/bin/uv run ldaca-web-app --multi-user --port 8001
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 5. Google OAuth Setup

The app uses Google OAuth for login. For each new domain, you must register it in the
[Google Cloud Console](https://console.cloud.google.com/) under
**APIs & Services → Credentials → OAuth 2.0 Client ID**:

| Section                       | Value to add                                              |
| ----------------------------- | --------------------------------------------------------- |
| Authorized JavaScript origins | `https://analytics.ldaca.edu.au`                          |
| Authorized redirect URIs      | `https://analytics.ldaca.edu.au/api/auth/google/callback` |

> Both entries are required. The redirect URI is what Google calls back to after the user authenticates.

---

## Common Admin Commands

### App Service

```bash
# Check status
sudo systemctl status ldaca-web-app

# Start / stop / restart
sudo systemctl start ldaca-web-app
sudo systemctl stop ldaca-web-app
sudo systemctl restart ldaca-web-app

# View live logs
sudo journalctl -u ldaca-web-app -f

# View recent logs (last 100 lines)
sudo journalctl -u ldaca-web-app -n 100 --no-pager
```

### Nginx

```bash
# Test config before applying
sudo nginx -t

# Reload config (no downtime)
sudo systemctl reload nginx

# Full restart
sudo systemctl restart nginx

# Check status
sudo systemctl status nginx
```

### TLS Certificate

```bash
# Check certificate expiry
sudo certbot certificates

# Manually trigger renewal (normally automatic)
sudo certbot renew --dry-run
```

---

## Updating the App

```bash
cd /home/ubuntu/src/ldaca_web_app
git pull
sudo systemctl restart ldaca-web-app
```

---

## Changing Configuration

If you need to update environment variables (e.g. `GOOGLE_CLIENT_ID`) or startup flags:

1. Edit the service file:

   ```bash
   sudo nano /etc/systemd/system/ldaca-web-app.service
   ```

2. Reload systemd and restart the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ldaca-web-app
   ```

---

## Troubleshooting

| Symptom                        | Check                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| App not responding             | `sudo systemctl status ldaca-web-app` and `sudo journalctl -u ldaca-web-app -n 50` |
| 502 Bad Gateway from Nginx     | App may be down — restart with `sudo systemctl restart ldaca-web-app`              |
| Certificate expired            | `sudo certbot renew`                                                               |
| Port 8001 already in use       | `sudo fuser -k 8001/tcp` then start the service                                    |
| Google OAuth redirect mismatch | Ensure redirect URI is registered in Google Cloud Console (see OAuth Setup above)  |
