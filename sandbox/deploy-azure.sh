#!/usr/bin/env bash
# Deploy Mycelium sandbox to Azure Container Apps.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

RESOURCE_GROUP="${RESOURCE_GROUP:-mycelium-sandbox-rg}"
LOCATION="${LOCATION:-eastus}"
ACR_NAME="${ACR_NAME:-myceliumsandboxacr}"
ENV_NAME="${ENV_NAME:-mycelium-sandbox-env}"
APP_NAME="${APP_NAME:-mycelium-sandbox}"
IMAGE_NAME="mycelium-sandbox:latest"

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI not found. Install: brew install azure-cli && az login" >&2
  exit 1
fi

if ! az account show >/dev/null 2>&1; then
  echo "Not logged in. Run: az login" >&2
  exit 1
fi

echo "==> Subscription: $(az account show --query name -o tsv)"
echo "==> Resource group: $RESOURCE_GROUP ($LOCATION)"

az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o none

echo "==> ACR: $ACR_NAME"
if ! az acr show -n "$ACR_NAME" -g "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az acr create -n "$ACR_NAME" -g "$RESOURCE_GROUP" --sku Basic --admin-enabled true -o none
fi

echo "==> Building image in ACR (no local Docker required)"
az acr build -r "$ACR_NAME" -t "$IMAGE_NAME" -g "$RESOURCE_GROUP" . -o none

az extension add --name containerapp --upgrade -y >/dev/null 2>&1 || true
az provider register --namespace Microsoft.App --wait -o none
az provider register --namespace Microsoft.OperationalInsights --wait -o none

echo "==> Container Apps environment: $ENV_NAME"
if ! az containerapp env show -n "$ENV_NAME" -g "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az containerapp env create -n "$ENV_NAME" -g "$RESOURCE_GROUP" -l "$LOCATION" -o none
fi

ACR_USER=$(az acr credential show -n "$ACR_NAME" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR_NAME" --query passwords[0].value -o tsv)
IMAGE="$ACR_NAME.azurecr.io/$IMAGE_NAME"

if az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "==> Updating Container App: $APP_NAME"
  az containerapp update \
    -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --image "$IMAGE" \
    -o none
else
  echo "==> Creating Container App: $APP_NAME"
  az containerapp create \
    -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --environment "$ENV_NAME" \
    --image "$IMAGE" \
    --registry-server "$ACR_NAME.azurecr.io" \
    --registry-username "$ACR_USER" \
    --registry-password "$ACR_PASS" \
    --target-port 7860 \
    --ingress external \
    --cpu 0.5 --memory 1.0Gi \
    --min-replicas 0 --max-replicas 2 \
    -o none
fi

FQDN=$(az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn -o tsv)

echo
echo "Sandbox live:"
echo "  https://${FQDN}/"
echo
echo "Wire the handbook: set #product-sandbox href in docs/index.html to that URL, then push."
