import os
import json
import base64
import time
import secrets
from datetime import datetime
from functools import wraps
from flask import Flask, request, jsonify, render_template, send_from_directory, abort
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ---------- CONFIG ----------
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")   # change!
SESSION_TOKENS = set()                                          # simple in-memory session store
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ---------- AUTH DECORATOR ----------
def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = request.headers.get("X-Auth-Token") or request.args.get("token")
        if not token or token not in SESSION_TOKENS:
            return jsonify({"error": "unauthorized"}), 401
        return f(*args, **kwargs)
    return wrapper

# ---------- ROUTES ----------
@app.route("/")
def home():
    return render_template("index.html")

@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    if data.get("password") == ADMIN_PASSWORD:
        token = secrets.token_hex(24)
        SESSION_TOKENS.add(token)
        return jsonify({"ok": True, "token": token})
    return jsonify({"ok": False, "error": "wrong password"}), 401

@app.route("/api/logout", methods=["POST"])
@require_auth
def logout():
    token = request.headers.get("X-Auth-Token")
    SESSION_TOKENS.discard(token)
    return jsonify({"ok": True})

@app.route("/api/upload", methods=["POST"])
@require_auth
def upload():
    """Receive JSON with {type, ts, meta, dataUrl} and save the file to disk."""
    data = request.get_json(silent=True)
    if not data or "dataUrl" not in data:
        return jsonify({"error": "no data"}), 400

    item_type = data.get("type", "unknown")
    ts = data.get("ts", int(time.time() * 1000))
    meta = data.get("meta", {})
    data_url = data["dataUrl"]

    # decode base64 payload
    try:
        header, b64 = data_url.split(",", 1)
        ext = "bin"
        if "image/png" in header: ext = "png"
        elif "image/jpeg" in header: ext = "jpg"
        elif "audio" in header: ext = "webm"
        elif "video" in header: ext = "webm"
        elif "application/json" in header: ext = "json"
        elif "text/plain" in header: ext = "txt"
        blob = base64.b64decode(b64)
    except Exception as e:
        return jsonify({"error": f"bad dataUrl: {e}"}), 400

    filename = f"{item_type}_{ts}.{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    with open(path, "wb") as f:
        f.write(blob)

    # save metadata alongside
    meta_path = path + ".meta.json"
    with open(meta_path, "w") as f:
        json.dump({
            "type": item_type, "ts": ts, "meta": meta,
            "filename": filename, "size": len(blob),
            "received_at": datetime.utcnow().isoformat()
        }, f, indent=2)

    print(f"[+] saved {filename} ({len(blob)} bytes)")
    return jsonify({"ok": True, "filename": filename, "size": len(blob)})

@app.route("/api/list", methods=["GET"])
@require_auth
def list_uploads():
    files = []
    for name in sorted(os.listdir(UPLOAD_DIR), reverse=True):
        if name.endswith(".meta.json"):
            continue
        full = os.path.join(UPLOAD_DIR, name)
        if os.path.isfile(full):
            files.append({
                "name": name,
                "size": os.path.getsize(full),
                "url": f"/uploads/{name}"
            })
    return jsonify({"count": len(files), "files": files})

@app.route("/uploads/<path:name>")
@require_auth
def get_upload(name):
    if ".." in name or "/" in name:
        abort(400)
    return send_from_directory(UPLOAD_DIR, name)

@app.route("/api/delete/<path:name>", methods=["DELETE"])
@require_auth
def delete_upload(name):
    if ".." in name or "/" in name:
        abort(400)
    path = os.path.join(UPLOAD_DIR, name)
    if os.path.exists(path):
        os.remove(path)
    meta = path + ".meta.json"
    if os.path.exists(meta):
        os.remove(meta)
    return jsonify({"ok": True})

@app.route("/health")
def health():
    return jsonify({"status": "ok", "time": datetime.utcnow().isoformat()})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🔐 Admin Console (Python) running on http://0.0.0.0:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)