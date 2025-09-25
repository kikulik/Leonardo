import argparse
import json
p = argparse.ArgumentParser()
p.add_argument("--instruction")
p.add_argument("--adapter-path")
p.add_argument("--compact", action="store_true")
args = p.parse_args()
# Minimal, valid JSON shape for the backend to parse
print(json.dumps({"devices": [{"id": "camera1", "role": "camera", "ports": [
      {"id": "SDI Output 1", "family": "SDI", "direction": "Output", "index": 1}]}], "connections": [], "policy": "mixed-allowed"}))
