# Kubernetes

cronbase can run in Kubernetes as a standalone deployment or as a sidecar. This guide covers both patterns with example manifests.

## Deployment patterns

### Standalone deployment (recommended for most setups)

Run cronbase as its own `Deployment` with a `PersistentVolumeClaim` for the SQLite database. This is the simplest approach when your jobs are shell commands on the node or calls to external services.

### Sidecar pattern

Run cronbase as a sidecar container alongside your application pod. Use this when your jobs need direct access to the application's filesystem, Unix sockets, or localhost network.

---

## Standalone deployment

### Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: cronbase
```

### ConfigMap

Store your job definitions in a `ConfigMap`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: cronbase-config
  namespace: cronbase
data:
  cronbase.yaml: |
    jobs:
      - name: healthcheck
        schedule: "*/5 * * * *"
        command: curl -sf https://myapp.example.com/health
        timeout: 30
        on_failure: https://hooks.slack.com/services/T.../B.../xxx

      - name: cleanup
        schedule: "0 2 * * *"
        command: find /tmp -mtime +7 -delete
        description: Remove old temp files
```

### PersistentVolumeClaim

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: cronbase-data
  namespace: cronbase
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
```

### Secret (optional)

Protect the dashboard with an API token:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: cronbase-secret
  namespace: cronbase
type: Opaque
stringData:
  api-token: "change-me-to-a-strong-random-value"
```

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cronbase
  namespace: cronbase
  labels:
    app: cronbase
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cronbase
  template:
    metadata:
      labels:
        app: cronbase
    spec:
      containers:
        - name: cronbase
          image: ghcr.io/paperkite-hq/cronbase:latest
          command: ["bun", "run", "src/cli.ts", "start",
                    "--db", "/data/cronbase.db",
                    "--config", "/config/cronbase.yaml"]
          ports:
            - containerPort: 7433
          env:
            - name: CRONBASE_LOG_FORMAT
              value: json
            - name: CRONBASE_LOG_LEVEL
              value: warn
            - name: CRONBASE_API_TOKEN
              valueFrom:
                secretKeyRef:
                  name: cronbase-secret
                  key: api-token
          volumeMounts:
            - name: data
              mountPath: /data
            - name: config
              mountPath: /config
          livenessProbe:
            httpGet:
              path: /health
              port: 7433
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /health
              port: 7433
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 500m
              memory: 256Mi
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: cronbase-data
        - name: config
          configMap:
            name: cronbase-config
```

> **Replicas**: Keep `replicas: 1`. Running multiple cronbase instances against the same SQLite database is not supported — each instance would run jobs independently, causing duplicate executions.

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: cronbase
  namespace: cronbase
spec:
  selector:
    app: cronbase
  ports:
    - port: 7433
      targetPort: 7433
```

### Apply everything

```bash
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
kubectl apply -f pvc.yaml
kubectl apply -f secret.yaml
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
```

Check status:

```bash
kubectl get pods -n cronbase
kubectl logs -n cronbase -l app=cronbase -f
```

Access the dashboard:

```bash
kubectl port-forward -n cronbase svc/cronbase 7433:7433
```

Then open `http://localhost:7433`.

---

## Sidecar pattern

Use the sidecar pattern when jobs need to share filesystem access with the application container — for example, running database dumps on a local SQLite file, processing files in a shared directory, or hitting localhost endpoints.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: myapp
          image: myapp:latest
          ports:
            - containerPort: 8080
          volumeMounts:
            - name: shared-data
              mountPath: /app/data

        - name: cronbase
          image: ghcr.io/paperkite-hq/cronbase:latest
          command: ["bun", "run", "src/cli.ts", "start",
                    "--db", "/cronbase/cronbase.db",
                    "--config", "/cronbase/cronbase.yaml",
                    "--port", "7433"]
          env:
            - name: CRONBASE_LOG_FORMAT
              value: json
          volumeMounts:
            - name: shared-data
              mountPath: /app/data     # same path as main container
            - name: cronbase-storage
              mountPath: /cronbase
            - name: cronbase-config
              mountPath: /cronbase/cronbase.yaml
              subPath: cronbase.yaml
          resources:
            requests:
              cpu: 25m
              memory: 32Mi
            limits:
              cpu: 200m
              memory: 128Mi

      volumes:
        - name: shared-data
          emptyDir: {}
        - name: cronbase-storage
          emptyDir: {}
        - name: cronbase-config
          configMap:
            name: myapp-cronbase-config
```

The sidecar's jobs can now access `/app/data` alongside the main container and call `http://localhost:8080` directly.

---

## Updating jobs

To change job definitions, edit the `ConfigMap` and restart the pod:

```bash
kubectl edit configmap cronbase-config -n cronbase
kubectl rollout restart deployment/cronbase -n cronbase
```

cronbase reloads the config file on startup and syncs jobs automatically.

---

## Ingress (optional)

Expose the dashboard externally via an `Ingress`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: cronbase
  namespace: cronbase
  annotations:
    nginx.ingress.kubernetes.io/auth-type: basic
    nginx.ingress.kubernetes.io/auth-secret: cronbase-basic-auth
spec:
  rules:
    - host: cronbase.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: cronbase
                port:
                  number: 7433
```

Alternatively, use the `CRONBASE_API_TOKEN` environment variable and rely on token auth instead of basic auth.
