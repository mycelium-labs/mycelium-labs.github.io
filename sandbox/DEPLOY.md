# Deploy sandbox to Azure (Portal, no CLI)

GitHub Pages stays static. This container is the full sandbox (UI + `/api/*`).
The handbook links out to the Azure URL.

Local image (optional check before Portal):

```bash
cd sandbox
docker build -t mycelium-sandbox .
docker run --rm -p 7860:7860 mycelium-sandbox
# open http://127.0.0.1:7860
```

---

## 1. Resource group

1. [Azure Portal](https://portal.azure.com) → **Resource groups** → **Create**
2. Name: `mycelium-sandbox-rg` (any name is fine)
3. Region: pick one close to you (e.g. East US)
4. **Review + create**

## 2. Azure Container Registry (ACR)

1. **Create a resource** → search **Container Registry** → **Create**
2. Resource group: the one above
3. Registry name: globally unique, e.g. `myceliumsandboxacr`
4. SKU: **Basic**
5. **Review + create** → open the registry when done
6. **Settings → Access keys** → enable **Admin user** (needed for a simple Portal push)
7. Copy **Login server**, **Username**, **password**

## 3. Push the image

On your Mac (Docker Desktop running):

```bash
cd /Users/nandanadileep/projects/mycellium/mycelium-labs.github.io/sandbox

# IMPORTANT: build linux/amd64 (Apple Silicon default arm64 fails on Azure)
docker build --platform linux/amd64 \
  -t myceliumsandboxacr.azurecr.io/mycelium-sandbox:latest .

docker login myceliumsandboxacr.azurecr.io
# username + password from Access keys

docker push myceliumsandboxacr.azurecr.io/mycelium-sandbox:latest
```

Replace `myceliumsandboxacr` with your real registry name.

**Live app (CLI-created):**  
https://myceliumsbx.mangobay-2157ee12.southindia.azurecontainerapps.io/

## 4. Container Apps environment

1. **Create a resource** → **Container Apps** → **Create**
2. Subscription + resource group as above
3. Container app name: `mycelium-sandbox`
4. Region: same as the RG
5. **Create new** Container Apps environment (accept defaults)
6. **Next: Container**
   - Image source: **Azure Container Registry**
   - Registry: your ACR
   - Image: `mycelium-sandbox`
   - Image tag: `latest`
7. **Next: Ingress**
   - Ingress: **Enabled**
   - Ingress traffic: **Accepting traffic from anywhere**
   - Ingress type: **HTTP**
   - Target port: **7860**
8. **Review + create** → **Create**

Optional under **Scale**: min replicas **0**, max **2** (cheap when idle).

## 5. Get the public URL

1. Open the Container App → **Overview**
2. Copy **Application Url**  
   Example: `https://mycelium-sandbox.xxxxx.eastus.azurecontainerapps.io`

Open that URL — you should see the sandbox UI. Health check: `/api/health` → `{"status":"ok"}`.

## 6. Wire into github.io

In `docs/index.html`, set:

```js
const SANDBOX_URL = "https://YOUR-APP.azurecontainerapps.io/";
```

Push to `main` on `mycelium-labs.github.io`. The hero shows **Try interactive sandbox**.

---

## Later updates

Rebuild + push the same tag, then in the Container App → **Containers** → edit revision → pull latest (or create a new revision with tag `latest`).

```bash
docker build -t myceliumsandboxacr.azurecr.io/mycelium-sandbox:latest .
docker push myceliumsandboxacr.azurecr.io/mycelium-sandbox:latest
```

## Optional: GitHub Actions

`.github/workflows/deploy-sandbox.yml` exists but stays off until you set
`AZURE_SANDBOX_ENABLED=true` and the Azure OIDC secrets. Skip if you prefer Portal only.
