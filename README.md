# Leonardo: Broadcast Schematic Designer

**Leonardo** is a full‑stack application that helps you design broadcast wiring diagrams.  It integrates a fine‑tuned language model to generate JSON descriptions of devices and their connections and provides a 2D canvas for editing and visualising that structure.  The repository is organised as a monorepo with a Python/FastAPI backend and a TypeScript/React frontend.

## Project Overview

The goal of this project is to allow engineers and operators to quickly prototype and edit broadcast signal chains.  Your model (fine‑tuned and placed in the `backend/Leonardo/` directory) accepts natural language commands such as “Generate 5 cameras” and returns a JSON document describing devices, ports and connections.  This repository wraps that model so it can be used from a web UI.

The core pieces are:

| Layer      | Purpose                                                             |
|-----------|---------------------------------------------------------------------|
| **Backend** | Exposes REST and WebSocket endpoints via FastAPI.  It loads the broadcast JSON schema and rules from the `schema/` folder, validates model output, and proxies requests to your fine‑tuned model in `backend/Leonardo/`.  It also serves a simple device catalog used by the UI. |
| **Frontend** | A Vite/React application written in TypeScript.  It renders a 2D canvas using React Flow, a device catalogue sidebar, a BOM (bill of materials) editor and a chat prompt.  The JSON returned by the backend is displayed in real time and used to update nodes and edges on the canvas. |

The repository structure is intentionally modular to simplify maintenance and future extensions.  Files are grouped by responsibility and can be extended without modifying unrelated components.

## Getting Started

### Prerequisites

* Python 3.10 or later
* Node.js 18 or later
* npm (comes with Node.js)

### Cloning and Setup

Clone this repository into your own GitHub account (this file assumes it will be called `Leonardo`), then follow these steps to install dependencies and run both services locally.

```
# Backend setup
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# Frontend setup
cd frontend
npm install
```

### Running the Backend

The backend is a FastAPI application.  Start it using uvicorn:

```
cd backend/app
uvicorn main:app --reload
```

This will start a development server at `http://localhost:8000`.  It exposes several endpoints:

* `GET /schema` – returns the broadcast JSON schema used for validation.
* `GET /rules` – returns the system prompt and rules used to guide the model.
* `GET /devices` – returns a simple device catalogue (see `backend/app/device_catalog.json`).
* `POST /generate` – accepts a `prompt` and a `bom` (bill of materials) and returns JSON output from the model after validation.
* `WS /ws/generate` – WebSocket endpoint for streaming model output line‑by‑line.

> **Note**: The backend uses `subprocess` to call your model wrapper script.  It expects to find the fine‑tuned adapter in the `backend/Leonardo/` directory.  Copy your adapter folder (renamed to **Leonardo**) into that folder before starting the server.

### Running the Frontend

The frontend uses Vite.  Start the dev server as follows:

```
cd frontend
npm run dev
```

This will serve the React app on `http://localhost:5173` (or the next free port).  The Vite configuration proxies API calls to `http://localhost:8000`, so both services need to be running concurrently during development.

### Building for Production

To create a production build of the frontend, run:

```
cd frontend
npm run build
```

The compiled static assets will be placed in `frontend/dist/`.  You can then serve these files from the backend or any static web server.

## Repository Layout

```
.
├── README.md                 – project documentation and setup instructions
├── LICENSE                   – MIT license
├── .gitignore               – ignored files for Git
├── backend/
│   ├── requirements.txt      – Python dependencies
│   ├── Leonardo/             – place your fine‑tuned adapter here (not committed)
│   │   └── .gitkeep          – placeholder so Git tracks the empty dir
│   └── app/
│       ├── main.py           – FastAPI application
│       ├── __init__.py       – package marker
│       ├── schema/
│       │   ├── broadcast_json_schema_v1.json        – JSON schema for validation
│       │   └── broadcast_rules_system_prompt_v1.md  – system prompt and rules
│       └── device_catalog.json – sample device catalogue used by the UI
└── frontend/
    ├── package.json          – Node.js dependencies and scripts
    ├── vite.config.ts        – Vite configuration with API proxy
    ├── tsconfig.json         – TypeScript configuration
    ├── tsconfig.node.json    – TypeScript config for Vite
    ├── tailwind.config.cjs   – Tailwind CSS configuration
    ├── postcss.config.js     – PostCSS configuration for Tailwind
    ├── index.html            – HTML entry point for Vite
    └── src/
        ├── index.css         – global styles importing Tailwind
        ├── main.tsx          – React entry point
        ├── App.tsx           – root React component
        ├── store/
        │   └── useStore.ts   – Zustand state management
        └── components/
            ├── Canvas.tsx    – React Flow canvas rendering nodes and edges
            ├── DeviceNode.tsx – custom node component for devices and ports
            ├── DeviceCatalog.tsx – device selection panel
            └── Chat.tsx      – BOM input and generator chat box
```

## Device Catalogue

The `backend/app/device_catalog.json` file contains a small example device catalogue.  Each entry includes an `id`, a `label`, a `role` and a list of `ports`.  The frontend lists these devices in the catalogue panel and allows you to add them to the canvas.  Feel free to replace this catalogue with your own data or hook it up to a real database.

## Customising the Model

Your fine‑tuned adapter must be named **Leonardo** and placed under `backend/Leonardo/`.  The backend currently calls `Test.py` using `subprocess` as a simple wrapper around your model.  If you have a different entry point or need to customise how prompts are passed to the model, modify the `run_model` and `stream_model` functions in `backend/app/main.py` accordingly.

## License

This project is licensed under the MIT License – see the [LICENSE](LICENSE) file for details.
