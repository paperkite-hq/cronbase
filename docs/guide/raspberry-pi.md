# Raspberry Pi

cronbase runs well on a Raspberry Pi — it's a natural fit for a home server or homelab cron scheduler. This guide covers a headless setup with systemd for automatic startup.

## Requirements

- Raspberry Pi 2 or later (armv7 / arm64)
- Raspberry Pi OS (Bookworm or Bullseye), 64-bit recommended
- Internet access for installation

## Installation

### Option 1: Docker (recommended)

Docker is the easiest path and handles all architecture concerns automatically.

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Run cronbase
docker run -d \
  --name cronbase \
  --restart unless-stopped \
  -p 7433:7433 \
  -v cronbase-data:/data \
  ghcr.io/paperkite-hq/cronbase
```

The dashboard is available at `http://<pi-ip>:7433`.

### Option 2: Bun (native)

Bun supports ARM64 natively on 64-bit Raspberry Pi OS:

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

Then install cronbase:

```bash
git clone https://github.com/paperkite-hq/cronbase.git
cd cronbase
bun install
bun run build
```

Create a symlink so `cronbase` is available on `$PATH`:

```bash
sudo ln -s /home/pi/cronbase/node_modules/.bin/cronbase /usr/local/bin/cronbase
```

> **32-bit OS**: Bun requires 64-bit. If you're on 32-bit Raspberry Pi OS, use the Docker option instead.

## Systemd service

Create a systemd unit to start cronbase automatically on boot.

### With Docker

```bash
sudo nano /etc/systemd/system/cronbase.service
```

```ini
[Unit]
Description=cronbase job scheduler
Requires=docker.service
After=docker.service

[Service]
Restart=always
ExecStart=/usr/bin/docker start -a cronbase
ExecStop=/usr/bin/docker stop cronbase

[Install]
WantedBy=multi-user.target
```

### With Bun (native)

```bash
sudo nano /etc/systemd/system/cronbase.service
```

```ini
[Unit]
Description=cronbase job scheduler
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/cronbase
ExecStart=/home/pi/.bun/bin/bun run src/cli.ts start \
  --db /var/lib/cronbase/cronbase.db \
  --config /etc/cronbase/cronbase.yaml
Restart=on-failure
RestartSec=5
Environment=CRONBASE_LOG_LEVEL=warn
Environment=CRONBASE_LOG_FORMAT=json

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo mkdir -p /var/lib/cronbase /etc/cronbase
sudo chown pi:pi /var/lib/cronbase
sudo systemctl daemon-reload
sudo systemctl enable cronbase
sudo systemctl start cronbase
```

Check status:

```bash
sudo systemctl status cronbase
journalctl -u cronbase -f
```

## Storage considerations

Raspberry Pi uses an SD card by default. SQLite generates frequent small writes, which can wear out SD cards over months.

**Mount the database on a USB drive or SSD:**

```bash
# Format and mount a USB drive
sudo mkfs.ext4 /dev/sda1
sudo mkdir /mnt/usb
echo '/dev/sda1 /mnt/usb ext4 defaults,noatime 0 2' | sudo tee -a /etc/fstab
sudo mount -a
sudo mkdir /mnt/usb/cronbase
sudo chown pi:pi /mnt/usb/cronbase
```

Then point cronbase at the external path:

```bash
cronbase start --db /mnt/usb/cronbase/cronbase.db
```

Or with Docker:

```bash
docker run -d \
  --name cronbase \
  --restart unless-stopped \
  -p 7433:7433 \
  -v /mnt/usb/cronbase:/data \
  ghcr.io/paperkite-hq/cronbase
```

**Enable `noatime`** on the SD card partition to reduce unnecessary writes to the filesystem metadata:

```
# In /etc/fstab, add noatime to the root partition options
PARTUUID=xxxx  /  ext4  defaults,noatime  0  1
```

## Accessing the dashboard remotely

The dashboard listens on all interfaces by default. Access it from another machine on the same network:

```
http://192.168.1.xxx:7433
```

**Secure it with an API token** when the Pi is accessible on your home network:

```bash
# Set on the Pi
export CRONBASE_API_TOKEN=your-secret-token
cronbase start
```

Then include the token when making API requests:

```bash
curl -H "Authorization: Bearer your-secret-token" http://192.168.1.xxx:7433/api/jobs
```

For remote access over the internet, use a reverse proxy with TLS (nginx, Caddy) or keep it behind a VPN.

## Config file

Place your job definitions in `/etc/cronbase/cronbase.yaml`:

```yaml
jobs:
  - name: backup-home
    schedule: "0 3 * * *"
    command: tar -czf /mnt/usb/backups/home-$(date +%Y%m%d).tar.gz /home/pi
    timeout: 600
    description: Nightly home directory backup

  - name: update-system
    schedule: "0 4 * * 0"
    command: apt-get update && apt-get upgrade -y
    timeout: 1800
    description: Weekly system updates
```

## Troubleshooting

**Bun not found after install:**

```bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

**Dashboard not reachable from other devices:**

Check the Pi's firewall isn't blocking port 7433:

```bash
sudo ufw allow 7433/tcp
```

**Out of memory:**

Raspberry Pi models with 512 MB RAM may struggle under heavy job loads. Reduce log verbosity:

```bash
CRONBASE_LOG_LEVEL=error cronbase start
```
