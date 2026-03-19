#!/usr/bin/env python3
import sys
import json
import hashlib


def send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def op_echo(params):
    return {"text": str(params.get("text", ""))}


def op_sha256(params):
    text = str(params.get("text", ""))
    h = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return {"sha256": h}


OPS = {
    "echo": op_echo,
    "sha256": op_sha256,
}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as e:
            send({"id": None, "ok": False, "error": f"invalid json: {e}"})
            continue

        rid = req.get("id")
        op = req.get("op")
        params = req.get("params") or {}

        if op not in OPS:
            send({"id": rid, "ok": False, "error": f"unknown op: {op}"})
            continue

        try:
            result = OPS[op](params)
            send({"id": rid, "ok": True, "result": result})
        except Exception as e:
            send({"id": rid, "ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
