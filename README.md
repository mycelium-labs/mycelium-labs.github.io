# mycelium-labs.github.io

Public site for [Mycelium](https://github.com/mycelium-labs/mycelium) (PyPI: `mycelium-runtime`): product homepage, try-in-5-minutes page, interactive sandbox.

The SDK package lives in **[mycelium-labs/mycelium](https://github.com/mycelium-labs/mycelium)**.

## Layout

| Path | What |
|------|------|
| `docs/` | Static site. Deploys to [GitHub Pages](https://mycelium-labs.github.io/) on push to `main`. |
| `docs/index.html` | Product homepage |
| `docs/try.html` | **Try it in 5 minutes**: install → demo → init → run |
| `sandbox/` | Interactive no-LLM demo (FastAPI). Run locally or via Docker. |

## Static site

Edit `docs/index.html`, `docs/try.html`, and companions. Push to `main` → Pages workflow uploads `docs/`.

## Sandbox (local)

```bash
cd sandbox
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8765
```

Open http://127.0.0.1:8765

Docker:

```bash
cd sandbox
docker build -t mycelium-sandbox .
docker run --rm -p 7860:7860 mycelium-sandbox
```

## Links

- SDK / PyPI package: https://github.com/mycelium-labs/mycelium
- Homepage: https://mycelium-labs.github.io/
- Try in 5 minutes: https://mycelium-labs.github.io/try.html
- PyPI: https://pypi.org/project/mycelium-runtime/
