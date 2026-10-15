#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["websockets>=13"]
# ///
"""Rename Home Assistant entities from a map file.

Lets a page's entity IDs be matched without clicking through
Settings -> Entities one at a time.

    export HA_TOKEN=...   # profile -> Security -> Long-lived access tokens
    tools/rename_entities.py tools/irrigation-renames.json --url http://homeassistant.local:8123          # dry run
    tools/rename_entities.py tools/irrigation-renames.json --url http://homeassistant.local:8123 --apply  # do it

The map file is a JSON list of {"from": <current ID>, "to": <new ID>, "name": <optional display name>}.
Safe to run again: finished renames are skipped. Runs with uv, which installs the dependencies.
"""

import argparse
import json
import os
import sys

from websockets.sync.client import connect


class HomeAssistant:
    """Home Assistant websocket API: auth, then request/response by id."""

    def __init__(self, ws, token):
        self.ws = ws
        self.next_id = 1

        msg = self._recv()
        if msg.get("type") != "auth_required":
            sys.exit(f"Unexpected first message: {msg}")
        self.ws.send(json.dumps({"type": "auth", "access_token": token}))
        msg = self._recv()
        if msg.get("type") != "auth_ok":
            sys.exit(f"Token rejected: {msg.get('message', msg)}")

    def call(self, type_, **data):
        """Send one command and return its result; raises RuntimeError on failure."""
        msg_id = self.next_id
        self.next_id += 1
        self.ws.send(json.dumps({"id": msg_id, "type": type_, **data}))
        while True:
            msg = self._recv()
            if msg.get("type") == "result" and msg.get("id") == msg_id:
                if not msg.get("success"):
                    raise RuntimeError(msg.get("error", {}).get("message", "request failed"))
                return msg.get("result")

    def _recv(self):
        return json.loads(self.ws.recv())


def main():
    parser = argparse.ArgumentParser(description="Rename Home Assistant entities from a map file.")
    parser.add_argument("map_file", help="JSON list of {from, to, name?}, e.g. tools/irrigation-renames.json")
    parser.add_argument("--url", required=True, help="e.g. http://homeassistant.local:8123")
    parser.add_argument("--apply", action="store_true", help="make the changes (default is a dry run)")
    args = parser.parse_args()

    token = os.environ.get("HA_TOKEN")
    if not token:
        sys.exit("Set HA_TOKEN to a long-lived access token.")
    with open(args.map_file, encoding="utf-8") as f:
        renames = json.load(f)

    ws_url = "ws" + args.url.rstrip("/").removeprefix("http") + "/api/websocket"
    try:
        # The entity registry can be several MB, over websockets' 1 MB default.
        with connect(ws_url, max_size=None, open_timeout=30) as ws:
            problems = rename(HomeAssistant(ws, token), renames, args.apply)
    except OSError as err:
        sys.exit(f"Could not connect to {args.url}: {err}")
    sys.exit(1 if problems else 0)


def rename(ha, renames, apply):
    """Rename and name each entity in the map; returns the number of problems."""
    registry = {e["entity_id"]: e for e in ha.call("config/entity_registry/list")}
    # IDs that are being renamed away, so another entity may take them (a swap).
    moving = {r["from"] for r in renames if r["from"] in registry and r["to"] != r["from"]}

    plan = []  # (update, action)
    problems = 0
    for r in renames:
        src, dst, name = r["from"], r["to"], r.get("name")
        src_entry, dst_entry = registry.get(src), registry.get(dst)
        dst_taken = dst_entry is not None and dst not in moving
        update = {"entity_id": src}

        if src_entry and src != dst and dst_taken:
            print(f"CONFLICT  {src} -> {dst}: both exist, rename one by hand")
            problems += 1
            continue
        elif src_entry and src != dst:
            update["new_entity_id"] = dst
            action = f"rename    {src} -> {dst}" + ("  (swap)" if dst_entry else "")
        elif src_entry or dst_taken:
            update["entity_id"] = dst
            action = f"done      {dst}"
        else:
            print(f"MISSING   {src} (and {dst} doesn't exist either)")
            problems += 1
            continue
        if name and (src_entry or dst_entry).get("name") != name:
            update["name"] = name
            action += f'  name "{name}"'

        if len(update) == 1:
            print(action)
        else:
            plan.append((update, action))

    if not apply:
        for _, action in plan:
            print(action)
    else:
        # A swap can't be done in one step, so when there is one, every rename first
        # moves to a temporary ID that's free, then to its final ID.
        swaps = any(u.get("new_entity_id") in registry for u, _ in plan)
        renaming = [u for u, _ in plan if "new_entity_id" in u]
        if swaps:
            for u in renaming:
                tmp = u["new_entity_id"] + "_renaming"
                try:
                    ha.call("config/entity_registry/update", entity_id=u["entity_id"], new_entity_id=tmp)
                except RuntimeError as err:
                    moved = [v["entity_id"] for v in renaming if v["entity_id"].endswith("_renaming")]
                    sys.exit(f"Moving {u['entity_id']} to {tmp} failed: {err}\n"
                             f"Already at temporary IDs (rename these by hand): {', '.join(moved) or 'none'}")
                u["entity_id"] = tmp
        for update, action in plan:
            try:
                ha.call("config/entity_registry/update", **update)
                print(f"{action}  OK")
            except RuntimeError as err:
                print(f"{action}  FAILED: {err}")
                problems += 1

    todo = len(plan)
    if apply:
        print(f"\n{todo} change(s) sent, {problems} problem(s).")
    else:
        print(f"\nDry run: {todo} change(s) to make, {problems} problem(s). Run again with --apply to make them.")
    return problems


if __name__ == "__main__":
    main()
