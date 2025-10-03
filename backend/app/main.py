# backend/app/main.py
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List

app = FastAPI(title="Leonardo Backend")

# --- Health ---
@app.get("/api/health")
def health():
    return {"ok": True}

# --- Minimal catalog the UI expects ---
# Feel free to expand this later
@app.get("/api/catalog")
def get_catalog():
    return {
        "devices": [
            {"type": "camera"},
            {"type": "router"},
            {"type": "vision mixer"},
            {"type": "server"},
            {"type": "camera control unit"},
            {"type": "embeder"},
            {"type": "encoder"},
            {"type": "replay system"},
            {"type": "monitors"},
        ]
    }

# --- Simple generate stub so the UI doesn't 404 ---
class GenerateIn(BaseModel):
    prompt: str | None = None
    instruction: str | None = None

@app.post("/api/generate")
def generate(body: GenerateIn):
    text = body.instruction or body.prompt or ""
    # For now just echo; you can hook this to GenAI later
    return {"ok": True, "message": f"Generated for: {text}"}

# --- NetBox router we added earlier ---
from . import netbox  # keep your netbox.py file
app.include_router(netbox.router)  # exposes /api/netbox/*
