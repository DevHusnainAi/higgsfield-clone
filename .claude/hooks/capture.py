#!/usr/bin/env python3
"""Append prompt/response pairs to .agent-logs/. Wired to UserPromptSubmit and Stop in .claude/settings.json."""
import json, os, re, sys, glob, time
from datetime import datetime, timezone

AUTHOR, TOOL, PROJECT = "DevHusnainAi", "claude-code", "higgsfield-clone"


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def transcript(path):
    try:
        with open(path) as f:
            return [json.loads(l) for l in f if l.strip()]
    except (OSError, ValueError):
        return []


def last_model(entries):
    for e in reversed(entries):
        m = (e.get("message") or {}).get("model")
        if e.get("type") == "assistant" and m and m != "<synthetic>":
            return m
    try:  # first prompt of a session: no assistant reply yet, fall back to configured model
        return json.load(open(os.path.expanduser("~/.claude/settings.json"))).get("model") or "unknown"
    except (OSError, ValueError):
        return "unknown"


def last_reply(entries):
    # final assistant message = all text blocks sharing the last assistant message id
    msgs = [e for e in entries if e.get("type") == "assistant"]
    if not msgs:
        return ""
    mid = msgs[-1]["message"].get("id")
    parts = [b["text"] for e in msgs if e["message"].get("id") == mid
             for b in e["message"].get("content", []) if isinstance(b, dict) and b.get("type") == "text"]
    return "\n".join(parts)


def main():
    data = json.load(sys.stdin)
    event, sid = data.get("hook_event_name"), data["session_id"]
    entries = transcript(data.get("transcript_path", ""))
    # ponytail: Stop can fire before the reply is flushed to the transcript; poll up to 2s for it
    for _ in range(20 if event == "Stop" else 0):
        if any(e.get("type") == "assistant" and (e.get("message") or {}).get("model") not in (None, "<synthetic>")
               for e in entries[-5:]):
            break
        time.sleep(0.1)
        entries = transcript(data.get("transcript_path", ""))
    logdir = os.path.join(data.get("cwd") or os.getcwd(), ".agent-logs")
    os.makedirs(logdir, exist_ok=True)
    ts = now()

    # optional argv[1]: pin every session to one log file in .agent-logs/
    pinned = os.path.join(logdir, sys.argv[1]) if len(sys.argv) > 1 else None
    existing = [pinned] if pinned and os.path.exists(pinned) else glob.glob(os.path.join(logdir, f"*_{sid}.md"))
    path = existing[0] if existing else pinned or os.path.join(
        logdir, datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S") + f"_{sid}.md")
    raw = open(path).read() if existing else ""
    sids = re.findall(r"^session_id: (.+)$", raw, re.M)
    sids = [s.strip() for s in sids[0].split(",")] if sids else []
    sids += [sid] if sid not in sids else []
    body = raw.split("\n---\n", 1)[1] if existing else (
        f"\n# Session Log - {ts[:10]}\n\nSession: `{sid[:8]}` | Project: `{PROJECT}` | Author: `{AUTHOR}`\n\n---\n")

    nums = [int(n) for n in re.findall(r"\[LOG_ENTRY type=PROMPT num=(\d+)", body)]
    model = last_model(entries)
    if event == "UserPromptSubmit":
        num, kind, text = (max(nums) + 1 if nums else 1), "PROMPT", data.get("prompt", "")
    else:  # Stop
        num, kind = (max(nums) if nums else 0), "RESPONSE"
        text = data.get("last_assistant_message") or last_reply(entries)

    body += (f"\n[LOG_ENTRY type={kind} num={num} session={sid[:8]}]\ntimestamp: {ts}\nmodel: {model}\n\n"
             f"{text}\n\n")

    prompt_times = re.findall(r"type=PROMPT num=\d+ session=\w+\]\ntimestamp: (\S+)", body)
    models = sorted(set(re.findall(r"^model: (\S+)$", body, re.M)))
    header = (f"---\nsession_id: {', '.join(sids)}\ndate: {(prompt_times or [ts])[0][:10]}\nauthor: {AUTHOR}\n"
              f"model: {', '.join(models)}\ntool: {TOOL}\nproject: {PROJECT}\ntotal_exchanges: {len(prompt_times)}\n"
              f"first_prompt_time: {(prompt_times or [ts])[0]}\nlast_prompt_time: {(prompt_times or [ts])[-1]}\n---")
    with open(path, "w") as f:
        f.write(header + "\n" + body)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # never block the session on a logging failure
        print(f"capture hook error: {e}", file=sys.stderr)
