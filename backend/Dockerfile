FROM python:3.11-slim

WORKDIR /app

# Optional build tools (keeps manylibs happy); safe to keep
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps defined by your repo
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# App code
COPY backend/app ./backend/app
# Include your adapter directory with model files
COPY backend/Leonardo ./backend/Leonardo

# The backend calls a runner at the repo root named Test.py
# (main.py builds the path to ../../Test.py). :contentReference[oaicite:1]{index=1}
COPY Test.py ./Test.py

EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
