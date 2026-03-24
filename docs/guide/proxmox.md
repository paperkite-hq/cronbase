# Proxmox

cronbase runs well in a Proxmox LXC container — it's lightweight and doesn't need a full VM. This guide sets up an unprivileged LXC container running cronbase as a systemd service.

## Prerequisites

- Proxmox VE 7 or later
- A Debian or Ubuntu LXC template downloaded to Proxmox

## Create the LXC container

In the Proxmox web UI:

1. Click **Create CT**
2. Set a hostname (e.g., `cronbase`)
3. Choose **Debian 12** or **Ubuntu 22.04** template
4. Disk: **4 GB** minimum (SQLite stays small, but leave room for job output)
5. CPU: **1 core** (sufficient for most workloads)
6. Memory: **256 MB** minimum, **512 MB** recommended
7. Network: assign an IP or use DHCP
8. Leave **Unprivileged container** checked

Or create it via CLI on the Proxmox host:

```bash
pct create 200 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname cronbase \
  --memory 512 \
  --swap 0 \
  --cores 1 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --rootfs local-lvm:4 \
  --unprivileged 1 \
  --start 1
```

Start the container:

```bash
pct start 200
pct exec 200 -- bash
```

## Install cronbase

### Option 1: Docker (simplest)

Install Docker in the container and run cronbase from the official image.

> **Note**: Docker inside an unprivileged LXC requires nesting. In the Proxmox UI, go to the container's **Options → Features** and enable **Nesting**. Or via CLI:
> ```bash
> pct set 200 --features nesting=1
> ```

```bash
# Inside the container
apt-get update && apt-get install -y curl
curl -fsSL https://get.docker.com | sh

docker run -d \
  --name cronbase \
  --restart unless-stopped \
  -p 7433:7433 \
  -v cronbase-data:/data \
  -v /etc/cronbase/cronbase.yaml:/app/cronbase.yaml \
  ghcr.io/paperkite-hq/cronbase start \
    --db /data/cronbase.db \
    --config /app/cronbase.yaml
```

### Option 2: Bun (native, no Docker overhead)

```bash
# Inside the container
apt-get update && apt-get install -y curl git unzip

# Install Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Install cronbase
git clone https://github.com/paperkite-hq/cronbase.git /opt/cronbase
cd /opt/cronbase
bun install
```

## Systemd service

Create a service unit so cronbase starts automatically when the container boots.

```bash
mkdir -p /etc/cronbase /var/lib/cronbase
nano /etc/systemd/system/cronbase.service
```

```ini
[Unit]
Description=cronbase job scheduler
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/cronbase
ExecStart=/root/.bun/bin/bun run src/cli.ts start \
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
systemctl daemon-reload
systemctl enable cronbase
systemctl start cronbase
systemctl status cronbase
```

## Config file

Create `/etc/cronbase/cronbase.yaml`:

```yaml
jobs:
  - name: backup-pve
    schedule: "0 2 * * *"
    command: vzdump 100 --storage local --mode snapshot --compress zstd
    timeout: 3600
    description: Nightly VM backup

  - name: prune-backups
    schedule: "0 3 * * 0"
    command: >
      find /var/lib/vz/dump -name '*.tar.zst' -mtime +14 -delete
    description: Remove backups older than 2 weeks

  - name: apt-upgrade
    schedule: "0 4 * * 0"
    command: apt-get update && apt-get upgrade -y
    timeout: 600
    description: Weekly system updates
```

## Auto-start with Proxmox

To have the container start automatically when Proxmox boots:

In the web UI: **Container → Options → Start at boot** → Enable.

Or via CLI on the Proxmox host:

```bash
pct set 200 --onboot 1
```

## Accessing the dashboard

Find the container's IP:

```bash
pct exec 200 -- hostname -I
```

Then open `http://<container-ip>:7433` from any machine on your network.

**Set an API token** for network-accessible dashboards:

```bash
# In /etc/systemd/system/cronbase.service, add:
Environment=CRONBASE_API_TOKEN=your-secret-token
```

```bash
systemctl daemon-reload
systemctl restart cronbase
```

## Bind mount for shared access

If your jobs need access to files on the Proxmox host or another container, use a bind mount.

On the Proxmox host:

```bash
# Mount host directory /mnt/data into the container at /mnt/data
pct set 200 --mp0 /mnt/data,mp=/mnt/data
```

Jobs in cronbase can then reference `/mnt/data` directly:

```yaml
jobs:
  - name: backup-data
    schedule: "0 1 * * *"
    command: tar -czf /mnt/data/backups/data-$(date +%Y%m%d).tar.gz /mnt/data/files
```

## Viewing logs

```bash
journalctl -u cronbase -f
```

Or filter by time:

```bash
journalctl -u cronbase --since "1 hour ago"
```

## Troubleshooting

**Container won't start Docker (permission denied):**

Enable nesting on the container:

```bash
# On the Proxmox host
pct set 200 --features nesting=1
pct restart 200
```

**Bun install fails (architecture mismatch):**

Confirm the container is running a 64-bit template:

```bash
dpkg --print-architecture   # should be amd64 or arm64
```

**Port not reachable from other hosts:**

Check the container firewall:

```bash
ufw allow 7433/tcp
```

And confirm cronbase is listening on all interfaces (it does by default — verify with `ss -tlnp | grep 7433`).
