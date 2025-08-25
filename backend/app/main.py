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

# Base paths
BASE_DIR = Path(__file__).resolve().parent
SCHEMA_PATH = BASE_DIR / "schema" / "broadcast_json_schema_v1.json"
RULES_PATH = BASE_DIR / "schema" / "broadcast_rules_system_prompt_v1.md"
CATALOG_PATH = BASE_DIR / "device_catalog.json"
TEST_SCRIPT_PATH = Path(__file__).resolve().parents[2] / "Test.py"
# Absolute path to the uploaded adapter (backend/Leonardo)
ADAPTER_PATH = Path(__file__).resolve().parents[2] / "backend" / "Leonardo"

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
    """Return the device catalog."""
    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def parse_json_from_output(raw_output: str) -> Any:
    """Extract the first balanced JSON object from the model output."""
    brace_count = 0
    start_idx = None
    for i, ch in enumerate(raw_output):
        if ch == "{":
            if start_idx is None:
                start_idx = i
            brace_count += 1
        elif ch == "}":
            if brace_count > 0:
                brace_count -= 1
                if brace_count == 0 and start_idx is not None:
                    json_str = raw_output[start_idx:i+1]
                    try:
                        return json.loads(json_str)
                    except Exception:
                        return {"error": "Failed to parse JSON", "json_str": json_str, "output": raw_output}
    return {"error": "No JSON content found in model output", "output": raw_output}

@app.post("/generate")
async def generate(req: GenerateRequest) -> Any:
    """Generate broadcast JSON from a natural language prompt using the LM runner."""
    cmd = [
        "python3",
        str(TEST_SCRIPT_PATH),
        "--instruction",
        req.prompt,
        "--adapter-path",
        str(ADAPTER_PATH),
    ]
    if req.compact:
        cmd.append("--compact")
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True)
        raw_output = proc.stdout.strip()
    except subprocess.CalledProcessError as e:
        return {"error": f"Model invocation failed: {e}"}
    return parse_json_from_output(raw_output)

@app.websocket("/generate_ws")
async def generate_ws(websocket: WebSocket) -> None:
    """WebSocket endpoint for streaming generation."""
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            cmd = [
                "python3",
                str(TEST_SCRIPT_PATH),
                "--instruction",
                data,
                "--adapter-path",
                str(ADAPTER_PATH),
            ]
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True)
                raw_output = proc.stdout.strip()
            except Exception as e:
                await websocket.send_json({"error": f"Model invocation failed: {e}"})
                continue
            result = parse_json_from_output(raw_output)
            await websocket.send_json(result)
    except WebSocketDisconnect:
        return
