# Mycelium sandbox (local)

Interactive mini-agent loop - **no LLM**. Compose tools, preview YAML, compare
the same plan **without** vs **with** Mycelium - in-process or via the real
`mycelium run` CLI (temp `agent_app.py` + YAML).

## Run locally

```bash
cd sandbox
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt

uvicorn app.main:app --reload --port 8765
```

Open http://127.0.0.1:8765

## Docker

```bash
docker build -t mycelium-sandbox .
docker run --rm -p 7860:7860 mycelium-sandbox
```

## Deploy to Azure

Portal-only steps (no Azure CLI): [DEPLOY.md](DEPLOY.md).

After you have the Application Url, set `SANDBOX_URL` in `docs/index.html`
so the handbook shows **Try interactive sandbox**.

## API

- `GET /api/health`
- `POST /api/yaml` - wizard → mycelium.yaml preview
- `POST /api/run` - `{ tools, plan, injector, mode }` → with/without results (in-process)
- `POST /api/run-cli` - same graph via subprocesses:
  `python run_agent.py` vs `mycelium run --config mycelium.yaml -- python run_agent.py`
