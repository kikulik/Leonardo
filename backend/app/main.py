from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import subprocess
import json
from pathlib import Path
from typing import Any, Dict

app = FastAPI()

# Allow CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
SCHEMA_PATH = BASE_DIR / "schema" / "broadcast_json_schema_v1.json"
RULES_PATH = BASE_DIR / "schema" / "broadcast_rules_system_prompt_v1.md"
CATALOG_PATH = BASE_DIR / "device_catalog.json"
TEST_SCRIPT_PATH = Path(__file__).resolve().parents[2] / "Test.py"


class GenerateRequest(BaseModel):
    prompt: str
    compact: bool = True


@app.get("/schema/json")
def get_schema_json() -> Dict[str, Any]:
    """Return the JSON schema used to validate AI output."""
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@app.get("/schema/rules")
def get_rules() -> Dict[str, str]:
    """Return the system prompt / rules document."""
    with open(RULES_PATH, "r", encoding="utf-8") as f:
        return {"rules": f.read()}


@app.get("/catalog")
def list_catalog() -> Any:
    """Return the device catalog. Useful for populating the structured chatbox."""
    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@app.post("/generate")
async def generate(req: GenerateRequest) -> Any:
    """Generate broadcast JSON from a natural language prompt using the LLM runner."""
    cmd = ["python3", str(TEST_SCRIPT_PATH), "--instruction", req.prompt]
    if req.compact:
        cmd.append("--compact")
    # Execute the model runner as a subprocess
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
        raw_output = proc.stdout.strip()
    except subprocess.CalledProcessError as exc:
        return {"error": f"Model invocation failed: {exc.stderr}"}

    # Try to parse output as JSON directly
    try:
        return json.loads(raw_output)
    except Exception:
        # Fallback: extract longest balanced JSON object
        from Test import longest_balanced_json  # type: ignore
        balanced = longest_balanced_json(raw_output)
        try:
            return json.loads(balanced)
        except Exception:
            return {"error": "Failed to parse model output", "raw": raw_output}


@app.websocket("/ws/generate")
async def generate_ws(websocket: WebSocket) -> None:
    """WebSocket endpoint for interactive generation. Accepts a prompt and streams back the result."""
    await websocket.accept()
    try:
        data = await websocket.receive_json()
        prompt = data.get("prompt")
        compact = data.get("compact", True)
        result = await generate(GenerateRequest(prompt=prompt, compact=compact))
        await websocket.send_json(result)
    except WebSocketDisconnect:
        pass
    finally:
        await websocket.close()
