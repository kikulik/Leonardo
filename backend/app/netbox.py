# backend/app/netbox.py
from fastapi import APIRouter, HTTPException
from typing import Optional, Dict, Any, Iterable, List
import os
import httpx

router = APIRouter(prefix="/api/netbox", tags=["netbox"])

# ---- MCP bridge (preferred) ----
MCP_NETBOX_URL = os.getenv("MCP_NETBOX_URL", "http://mcp-netbox:8090/mcp")

# ---- Direct NetBox fallback (optional) ----
NETBOX_DIRECT_BASE = os.getenv("NETBOX_DIRECT_BASE")  # e.g. http://netbox-netbox-1:8080
NETBOX_TOKEN = os.getenv("NETBOX_TOKEN")              # API token


# ---------------------------
# Low-level helpers
# ---------------------------
async def mcp_invoke(tool: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Call an MCP tool; raise HTTP 502 with server's message if it fails."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{MCP_NETBOX_URL}/invoke", json={"tool": tool, "args": args})
    try:
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        # bubble up MCP error body for transparency
        raise HTTPException(status_code=502, detail=f"MCP call failed: {getattr(e.response, 'text', str(e))}")
    return r.json()

def unwrap_result(payload: Dict[str, Any]) -> Any:
    return payload.get("result", payload)

async def nb_get(path: str, params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Direct REST GET fallback to NetBox (only used if configured and MCP fails)."""
    if not NETBOX_DIRECT_BASE or not NETBOX_TOKEN:
        raise HTTPException(502, "Direct NetBox fallback not configured (NETBOX_DIRECT_BASE / NETBOX_TOKEN).")
    url = NETBOX_DIRECT_BASE.rstrip("/") + path
    headers = {"Authorization": f"Token {NETBOX_TOKEN}"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=headers, params=params or {})
    try:
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    return r.json()

async def nb_post(path: str, json: Dict[str, Any]) -> Dict[str, Any]:
    """Direct REST POST fallback to NetBox (only used if configured and MCP fails)."""
    if not NETBOX_DIRECT_BASE or not NETBOX_TOKEN:
        raise HTTPException(502, "Direct NetBox fallback not configured (NETBOX_DIRECT_BASE / NETBOX_TOKEN).")
    url = NETBOX_DIRECT_BASE.rstrip("/") + path
    headers = {"Authorization": f"Token {NETBOX_TOKEN}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers=headers, json=json)
    try:
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    return r.json()

async def nb_options(path: str) -> Dict[str, Any]:
    """Direct REST OPTIONS to discover choices (DRF OPTIONS metadata)."""
    if not NETBOX_DIRECT_BASE or not NETBOX_TOKEN:
        raise HTTPException(502, "Direct NetBox fallback not configured (NETBOX_DIRECT_BASE / NETBOX_TOKEN).")
    url = NETBOX_DIRECT_BASE.rstrip("/") + path
    headers = {"Authorization": f"Token {NETBOX_TOKEN}"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.options(url, headers=headers)
    try:
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    return r.json()


# ---------------------------
# Readers (sites, roles, manufacturers, device types)
# ---------------------------
def _page_params(limit: int, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    p = {"limit": limit}
    if extra:
        p.update({k: v for k, v in extra.items() if v is not None})
    return p

@router.get("/sites")
async def list_sites(limit: int = 200, name_ic: Optional[str] = None):
    try:
        params = _page_params(limit, {"name__ic": name_ic})
        data = await mcp_invoke("netbox_get_sites", params)
        return unwrap_result(data)
    except HTTPException as e:
        try:
            params = _page_params(limit, {"name__ic": name_ic})
            return await nb_get("/api/dcim/sites/", params=params)
        except Exception:
            raise e

@router.get("/roles")
async def list_device_roles(limit: int = 200, name_ic: Optional[str] = None):
    # NetBox v3 uses /device-roles/, v4 may use /roles/
    try:
        params = _page_params(limit, {"name__ic": name_ic})
        data = await mcp_invoke("netbox_get_device_roles", params)
        return unwrap_result(data)
    except HTTPException as e:
        # try REST primary path
        try:
            params = _page_params(limit, {"name__ic": name_ic})
            return await nb_get("/api/dcim/device-roles/", params=params)
        except Exception:
            # try REST alt path
            try:
                params = _page_params(limit, {"name__ic": name_ic})
                return await nb_get("/api/dcim/roles/", params=params)
            except Exception:
                raise e

@router.get("/manufacturers")
async def list_manufacturers(limit: int = 200, name_ic: Optional[str] = None):
    try:
        params = _page_params(limit, {"name__ic": name_ic})
        data = await mcp_invoke("netbox_get_manufacturers", params)
        return unwrap_result(data)
    except HTTPException as e:
        try:
            params = _page_params(limit, {"name__ic": name_ic})
            return await nb_get("/api/dcim/manufacturers/", params=params)
        except Exception:
            raise e

@router.get("/device-types")
async def list_device_types(limit: int = 200, manufacturer: Optional[str] = None, model_ic: Optional[str] = None):
    try:
        params = _page_params(limit, {"manufacturer": manufacturer, "model__ic": model_ic})
        data = await mcp_invoke("netbox_get_device_types", params)
        return unwrap_result(data)
    except HTTPException as e:
        try:
            params = _page_params(limit, {"manufacturer": manufacturer, "model__ic": model_ic})
            return await nb_get("/api/dcim/device-types/", params=params)
        except Exception:
            raise e

@router.get("/devices-by-site")
async def list_devices_by_site(site: str, limit: int = 200):
    try:
        params = _page_params(limit, {"site": site})
        data = await mcp_invoke("netbox_get_devices", params)
        return unwrap_result(data)
    except HTTPException as e:
        try:
            params = _page_params(limit, {"site": site})
            return await nb_get("/api/dcim/devices/", params=params)
        except Exception:
            raise e


# ---------------------------
# Choices for UI (type dropdowns)
# ---------------------------
def _fallback_choices():
    # Minimal but useful defaults if neither MCP nor REST choices are available
    return {
        "interface_types": [
            {"value": "virtual", "label": "Virtual"},
            {"value": "1000base-t", "label": "1G Copper (1000BASE-T)"},
            {"value": "10gbase-x-sfpp", "label": "10G SFP+"},
        ],
        "rear_port_types": [
            {"value": "8p8c", "label": "8P8C (RJ45)"},
            {"value": "lc", "label": "LC"},
        ],
        "front_port_types": [
            {"value": "8p8c", "label": "8P8C (RJ45)"},
            {"value": "lc", "label": "LC"},
        ],
    }

def _norm_list(lst: Iterable[Dict[str, Any]]) -> List[Dict[str, str]]:
    out = []
    for x in lst or []:
        value = str(x.get("value")).lower()
        label = x.get("label") or x.get("display") or x.get("display_name") or value
        if value:
            out.append({"value": value, "label": label})
    return out

def _merge_choice_sources(sources: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, str]]]:
    merged = {"interface_types": [], "rear_port_types": [], "front_port_types": []}
    for key in merged.keys():
        seen = {}
        for src in sources:
            for item in (src.get(key) or []):
                v = str(item.get("value", "")).lower()
                if not v or v in seen:
                    continue
                seen[v] = {"value": v, "label": item.get("label") or v}
        merged[key] = list(seen.values())
    return merged

@router.get("/choices")
async def list_choices():
    sources: List[Dict[str, Any]] = []

    # 1) MCP “choices” tool if present
    try:
        data = await mcp_invoke("netbox_get_choices", {})
        res = unwrap_result(data) or {}
        if res:
            # Expecting keys: interface_types, rear_port_types, front_port_types
            # If tool returns NetBox-style keys, try to normalize
            def maybe_norm(src: Dict[str, Any]) -> Dict[str, Any]:
                if "interface_types" in src or "rear_port_types" in src or "front_port_types" in src:
                    return src
                return {
                    "interface_types": _norm_list(src.get("interface:type", [])),
                    "rear_port_types": _norm_list(src.get("rearport:type", [])),
                    "front_port_types": _norm_list(src.get("frontport:type", [])),
                }
            sources.append(maybe_norm(res))
    except HTTPException:
        pass

    # 2) REST choices endpoint (NetBox 3.x)
    try:
        choices = await nb_get("/api/dcim/_choices/")
        sources.append({
            "interface_types": _norm_list(choices.get("interface:type", [])),
            "rear_port_types": _norm_list(choices.get("rearport:type", [])),
            "front_port_types": _norm_list(choices.get("frontport:type", [])),
        })
    except Exception:
        pass

    # 3) DRF OPTIONS (works on many v3/v4 installs)
    try:
        int_opts = await nb_options("/api/dcim/interfaces/")
        rp_opts  = await nb_options("/api/dcim/rear-ports/")
        fp_opts  = await nb_options("/api/dcim/front-ports/")

        def opts_to(src: Dict[str, Any], field: str) -> List[Dict[str, str]]:
            post = (src.get("actions") or {}).get("POST") or {}
            f = post.get(field) or {}
            return _norm_list(f.get("choices") or [])

        sources.append({
            "interface_types": opts_to(int_opts, "type"),
            "rear_port_types": opts_to(rp_opts, "type"),
            "front_port_types": opts_to(fp_opts, "type"),
        })
    except Exception:
        pass

    merged = _merge_choice_sources(sources)
    if not any(merged.values()):
        return _fallback_choices()
    return merged


# ---------------------------
# One device + its ports (interfaces/front/rear)
# ---------------------------
@router.get("/device-with-ports")
async def device_with_ports(device: str, site: Optional[str] = None):
    """
    Resolve a device (by id OR by name + optional site) then fetch its interfaces/front_ports/rear_ports.
    All calls go via MCP tools when available, with REST fallback only if configured.
    """
    # 1) Resolve device object
    dev_obj: Optional[Dict[str, Any]] = None

    if device.isdigit():
        # Resolve by numeric id
        try:
            dev_res = await mcp_invoke("netbox_get_device", {"id": int(device)})
            dev_obj = unwrap_result(dev_res)
        except HTTPException as e:
            # optional REST fallback
            try:
                dev_obj = await nb_get(f"/api/dcim/devices/{int(device)}/")
            except Exception:
                raise e
    else:
        # Resolve by name (+ optional site slug)
        filters = {"name": device, "limit": 1}
        if site:
            filters["site"] = site
        data = await mcp_invoke("netbox_get_devices", filters)
        lst = (unwrap_result(data) or {}).get("results") or []
        if not lst and not site:
            # try again without site
            data2 = await mcp_invoke("netbox_get_devices", {"name": device, "limit": 1})
            lst = (unwrap_result(data2) or {}).get("results") or []
        if not lst:
            raise HTTPException(404, f"Device not found: {device} (site={site or '-'})")
        dev_obj = lst[0]

    dev_id = dev_obj["id"]

    # 2) Fetch ports via MCP
    ints = unwrap_result(await mcp_invoke("netbox_get_interfaces", {"device_id": dev_id, "all": True})).get("results", [])
    fps  = unwrap_result(await mcp_invoke("netbox_get_front_ports", {"device_id": dev_id, "all": True})).get("results", [])
    rps  = unwrap_result(await mcp_invoke("netbox_get_rear_ports",  {"device_id": dev_id, "all": True})).get("results", [])

    # Slim device summary for UI badges
    summary = {
        "id": dev_id,
        "name": dev_obj.get("name"),
        "site": (dev_obj.get("site") or {}).get("slug") or (dev_obj.get("site") or {}).get("name"),
        "role": (dev_obj.get("role") or {}).get("slug") or (dev_obj.get("role") or {}).get("name"),
        "device_type": (dev_obj.get("device_type") or {}).get("model"),
    }
    return {"device": summary, "interfaces": ints, "front_ports": fps, "rear_ports": rps}


# ---------------------------
# Prepare / Create (export)
# ---------------------------
@router.post("/prepare-device")
async def prepare_device(body: Dict[str, Any]):
    """
    Resolve references & return ready-to-POST payload for dcim.devices.
    Accepts either slugs or names:
      site: slug OR name
      role: slug OR name
      manufacturer: slug OR name (optional)
      device_type: model OR slug
    """
    required = ["name", "site", "role", "device_type"]
    missing = [k for k in required if not body.get(k)]
    if missing:
        raise HTTPException(400, f"Missing fields: {', '.join(missing)}")

    # normalize to lower-case strings where appropriate
    name = str(body["name"]).strip()
    site_in = str(body["site"]).strip()
    role_in = str(body["role"]).strip()
    dtype_in = str(body["device_type"]).strip()

    # Site
    site_obj = await resolve_one_mcp_or_rest(
        mcp_tool="netbox_get_sites",
        rest_path="/api/dcim/sites/",
        try_filters=({"name": site_in}, {"slug": site_in}),
    )
    site_id = site_obj["id"]

    # Role
    role_obj = await resolve_one_mcp_or_rest(
        mcp_tool="netbox_get_device_roles",
        rest_path="/api/dcim/device-roles/",
        try_filters=({"name": role_in}, {"slug": role_in}),
    )
    role_id = role_obj["id"]

    # Manufacturer (optional)
    manufacturer_id = None
    if body.get("manufacturer"):
        manu_in = str(body["manufacturer"]).strip()
        manu_obj = await resolve_one_mcp_or_rest(
            mcp_tool="netbox_get_manufacturers",
            rest_path="/api/dcim/manufacturers/",
            try_filters=({"name": manu_in}, {"slug": manu_in}),
        )
        manufacturer_id = manu_obj["id"]

    # Device Type (model OR slug)
    dtype_obj = await resolve_one_mcp_or_rest(
        mcp_tool="netbox_get_device_types",
        rest_path="/api/dcim/device-types/",
        try_filters=({"model": dtype_in}, {"slug": dtype_in}),
    )
    device_type_id = dtype_obj["id"]

    payload: Dict[str, Any] = {
        "name": name,
        "site": site_id,
        # include both keys for v3/v4 compatibility (some installs require one or the other)
        "device_role": role_id,
        "role": role_id,
        "device_type": device_type_id,
        "status": (body.get("status") or "active").lower(),
    }

    # Optional passthroughs
    for key in ("serial",):
        if body.get(key) is not None:
            payload[key] = body[key]

    # Optional rack placement (NetBox will validate)
    if body.get("rack"):
        payload["rack"] = body["rack"]
    if body.get("position") is not None:
        payload["position"] = body["position"]
    if body.get("face"):
        payload["face"] = body["face"]

    return {
        "ready_to_post": True,
        "payload": payload,
        "resolved": {
            "site_id": site_id,
            "role_id": role_id,
            "device_type_id": device_type_id,
            "manufacturer_id": manufacturer_id,
        },
    }

async def resolve_one_mcp_or_rest(*, mcp_tool: str, rest_path: str, try_filters: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Try MCP with several filters; fall back to direct REST if available.
    """
    last_err: Optional[Exception] = None
    for f in try_filters:
        try:
            res = await mcp_invoke(mcp_tool, {**f, "limit": 1})
            lst = (unwrap_result(res) or {}).get("results") or []
            if lst:
                return lst[0]
        except Exception as e:
            last_err = e
            break  # if MCP tool missing, stop trying
    # REST fallback with same filters
    if NETBOX_DIRECT_BASE and NETBOX_TOKEN:
        for f in try_filters:
            try:
                data = await nb_get(rest_path, params={**f, "limit": 1})
                lst = data.get("results") or []
                if lst:
                    return lst[0]
            except Exception as e:
                last_err = e
                continue
    if last_err:
        raise last_err
    raise HTTPException(404, f"Object not found via {mcp_tool} / {rest_path}")

@router.post("/create-device")
async def create_device(body: Dict[str, Any]):
    """
    Create a device via MCP (`netbox_create_device`).
    If `payload` not provided, we prepare first (so UI can send raw strings).
    """
    payload = body.get("payload")
    if not payload:
        prepared = await prepare_device(body)
        payload = prepared["payload"]

    # MCP first
    try:
        created = await mcp_invoke("netbox_create_device", {"payload": payload})
        return unwrap_result(created)
    except HTTPException as mcp_err:
        # Optional REST fallback if configured
        last_mcp_error = mcp_err.detail
        try:
            created = await nb_post("/api/dcim/devices/", json=payload)
            return created
        except HTTPException as rest_err:
            # forward NetBox's status + body and include last MCP error for context
            status = getattr(rest_err, "status_code", 400)
            detail = getattr(rest_err, "detail", None)
            # detail can be a string JSON or dict; keep as-is
            if detail is None:
                # avoid the IndexError that previously crashed here
                if getattr(rest_err, "args", None):
                    detail = rest_err.args[0] if rest_err.args else str(rest_err)
                else:
                    detail = str(rest_err)
            raise HTTPException(status_code=status, detail={"detail": detail, "last_mcp_error": last_mcp_error})
        except Exception as rest_err:
            raise HTTPException(status_code=502, detail={"detail": str(rest_err), "last_mcp_error": last_mcp_error})


# ---------------------------
# Create ports & interfaces (export helpers)
# ---------------------------
@router.post("/create-interfaces")
async def create_interfaces(body: Dict[str, Any]):
    """
    Create multiple interfaces for a device.
    Body:
      {
        "device_id": <int>,
        "interfaces": [{"name":"Eth 1","type":"1000base-t","description":"IN/OUT"}, ...]
      }
    """
    device_id = body.get("device_id")
    interfaces = body.get("interfaces") or []
    if not device_id or not isinstance(interfaces, list) or not interfaces:
        raise HTTPException(400, "device_id and interfaces[] are required")

    # Try batch via MCP
    try:
        resp = await mcp_invoke("netbox_create_interfaces", {"device_id": device_id, "interfaces": interfaces})
        return unwrap_result(resp)
    except HTTPException:
        pass

    # Per-item fallback (MCP or REST)
    created, errors = [], []
    for it in interfaces:
        payload = {
            "device": device_id,
            "name": it["name"],
            "type": str(it["type"]).lower(),
        }
        if it.get("description"): payload["description"] = it["description"]
        try:
            try:
                one = await mcp_invoke("netbox_create_interface", {"payload": payload})
                created.append(unwrap_result(one))
            except HTTPException:
                created.append(await nb_post("/api/dcim/interfaces/", json=payload))
        except Exception as e:
            errors.append({"input": it, "error": getattr(e, "detail", str(e))})

    if errors and not created:
        raise HTTPException(502, {"detail": "All interface creates failed", "errors": errors})
    return {"ok": True, "created": created, "errors": errors}

@router.post("/create-rear-ports")
async def create_rear_ports(body: Dict[str, Any]):
    """
    Create multiple rear ports for a device.
    Body:
      {
        "device_id": <int>,
        "rear_ports": [{"name":"RP1","type":"lc","positions":1,"description":"text"}, ...]
      }
    """
    device_id = body.get("device_id")
    rear_ports = body.get("rear_ports") or []
    if not device_id or not isinstance(rear_ports, list) or not rear_ports:
        raise HTTPException(400, "device_id and rear_ports[] are required")

    try:
        resp = await mcp_invoke("netbox_create_rear_ports", {"device_id": device_id, "rear_ports": rear_ports})
        return unwrap_result(resp)
    except HTTPException:
        pass

    created, errors = [], []
    for rp in rear_ports:
        payload = {
            "device": device_id,
            "name": rp["name"],
            "type": str(rp["type"]).lower(),
            "positions": int(rp.get("positions", 1) or 1),
        }
        if rp.get("description"): payload["description"] = rp["description"]
        try:
            try:
                one = await mcp_invoke("netbox_create_rear_port", {"payload": payload})
                created.append(unwrap_result(one))
            except HTTPException:
                created.append(await nb_post("/api/dcim/rear-ports/", json=payload))
        except Exception as e:
            errors.append({"input": rp, "error": getattr(e, "detail", str(e))})

    if errors and not created:
        raise HTTPException(502, {"detail": "All rear-port creates failed", "errors": errors})
    return {"ok": True, "created": created, "errors": errors}

@router.post("/create-front-ports")
async def create_front_ports(body: Dict[str, Any]):
    """
    Create multiple front ports for a device.
    Body:
      {
        "device_id": <int>,  # optional if rear_port_id/position already belongs to device
        "front_ports": [
          {"name":"...", "type":"lc", "rear_port_id": 123, "rear_port_position": 1, "description":"..."},
          ...
        ]
      }
    """
    device_id = body.get("device_id")
    front_ports = body.get("front_ports") or []
    if not isinstance(front_ports, list) or not front_ports:
        raise HTTPException(400, "front_ports[] is required")

    try:
        resp = await mcp_invoke("netbox_create_front_ports", {"device_id": device_id, "front_ports": front_ports})
        return unwrap_result(resp)
    except HTTPException:
        pass

    created: List[Any] = []
    errors: List[Any] = []
    for fp in front_ports:
        payload = {
            "name": fp["name"],
            "type": fp["type"],
            "rear_port": fp["rear_port_id"],
            "rear_port_position": int(fp.get("rear_port_position", 1) or 1),
        }
        # Include device only if provided (NetBox can infer device from rear_port)
        if device_id:
            payload["device"] = device_id
        if fp.get("description"):
            payload["description"] = fp["description"]

        try:
            try:
                one = await mcp_invoke("netbox_create_front_port", {"payload": payload})
                created.append(unwrap_result(one))
            except HTTPException:
                created.append(await nb_post("/api/dcim/front-ports/", json=payload))
        except Exception as e:
            errors.append({"input": fp, "error": getattr(e, "detail", str(e))})

    if errors and not created:
        raise HTTPException(502, {"detail": "All front-port creates failed", "errors": errors})
    return {"ok": True, "created": created, "errors": errors}
