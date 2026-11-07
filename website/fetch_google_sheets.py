#!/usr/bin/env python3
"""Fetch and sync project data from a connected Google Sheet into the Awesome Python library index.

Reads project rows from a Google Spreadsheet via the Google Sheets v4 API,
dynamically resolving tab names from spreadsheet metadata, and writes the
normalized project records to website/data/google_sheets_projects.json so
website/build.py can merge them into the library index. Can run once or as a
continuous background sync loop (--interval).
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from collections.abc import Sequence
try:
    from datetime import UTC
except ImportError:
    from datetime import timezone
    UTC = timezone.utc
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import httpx

DATA_DIR = Path(__file__).parent / "data"
CACHE_FILE = DATA_DIR / "google_sheets_projects.json"
REPO_ROOT = Path(__file__).parent.parent
SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets"

SPREADSHEET_URL_RE = re.compile(r"/spreadsheets/d/([a-zA-Z0-9-_]+)")


def extract_spreadsheet_id(raw: str) -> str:
    """Extract a Google Spreadsheet ID from a full URL or raw ID string."""
    trimmed = raw.strip()
    if not trimmed:
        return ""
    match = SPREADSHEET_URL_RE.search(trimmed)
    return match.group(1) if match else trimmed


def parse_int_metric(raw: str) -> int | None:
    """Parse an integer metric such as downloads or stars, returning None if absent/non-numeric."""
    cleaned = raw.strip().replace(",", "").replace("_", "")
    if not cleaned:
        return None
    if cleaned.isdigit():
        return int(cleaned)
    return None


def _normalize_header(cell: str) -> str:
    return re.sub(r"[^a-z0-9]", "", cell.strip().lower())


HEADER_ALIASES = {
    "projectname": "name",
    "name": "name",
    "project": "name",
    "library": "name",
    "repositorydocsurl": "url",
    "repositoryurl": "url",
    "url": "url",
    "link": "url",
    "homepage": "url",
    "pypidownloads30d": "downloads",
    "pypidownloads": "downloads",
    "downloads": "downloads",
    "githubstars": "stars",
    "stars": "stars",
    "lastcommit": "last_commit_at",
    "lastcommitat": "last_commit_at",
    "commit": "last_commit_at",
    "tags": "tags",
    "categories": "tags",
    "category": "tags",
    "description": "description",
    "summary": "description",
}


def is_header_row(row: Sequence[str]) -> bool:
    """Return True if the row looks like a column header row."""
    if not row:
        return False
    first_norm = _normalize_header(str(row[0]))
    if first_norm in ("projectname", "name", "project", "library"):
        return True
    matched = sum(1 for cell in row if _normalize_header(str(cell)) in HEADER_ALIASES)
    return matched >= 2


def parse_sheet_projects(rows: Sequence[Sequence[str]]) -> list[dict]:
    """Parse raw 2D sheet values into normalized project dictionaries."""
    if not rows:
        return []

    col_map = {
        "name": 0,
        "url": 1,
        "downloads": 2,
        "stars": 3,
        "last_commit_at": 4,
        "tags": 5,
        "description": 6,
    }
    start_idx = 0

    if is_header_row(rows[0]):
        start_idx = 1
        detected: dict[str, int] = {}
        for idx, cell in enumerate(rows[0]):
            field = HEADER_ALIASES.get(_normalize_header(str(cell)))
            if field and field not in detected:
                detected[field] = idx
        if "name" in detected:
            col_map.update(detected)

    projects: list[dict] = []
    seen_names: set[str] = set()

    for row in rows[start_idx:]:
        def get_col(field: str) -> str:
            idx = col_map.get(field, -1)
            if 0 <= idx < len(row) and row[idx] is not None:
                return str(row[idx]).strip()
            return ""

        name = get_col("name")
        if not name:
            continue
        norm_key = re.sub(r"[^a-z0-9]", "", name.lower())
        if not norm_key or norm_key in seen_names:
            continue
        seen_names.add(norm_key)

        url = get_col("url") or f"https://pypi.org/project/{name}/"
        downloads = parse_int_metric(get_col("downloads"))
        stars = parse_int_metric(get_col("stars"))
        last_commit_at = get_col("last_commit_at") or None
        raw_tags = get_col("tags")
        tags = [t.strip() for t in raw_tags.split(",") if t.strip()] if raw_tags else []
        description = get_col("description")

        projects.append(
            {
                "name": name,
                "url": url,
                "downloads": downloads,
                "stars": stars,
                "last_commit_at": last_commit_at,
                "tags": tags,
                "description": description,
            }
        )

    return projects


def fetch_sheet_titles(
    spreadsheet_id: str,
    client: httpx.Client,
    api_key: str = "",
) -> list[str]:
    """Fetch sheet tab titles from Google Spreadsheet metadata without grid data."""
    url = f"{SHEETS_API_BASE}/{quote(spreadsheet_id, safe='')}?includeGridData=false"
    if api_key:
        url += f"&key={quote(api_key, safe='')}"
    resp = client.get(url)
    resp.raise_for_status()
    data = resp.json()
    titles = [
        sheet.get("properties", {}).get("title", "")
        for sheet in data.get("sheets", [])
    ]
    return [t for t in titles if t]


def fetch_sheet_rows(
    spreadsheet_id: str,
    sheet_title: str,
    client: httpx.Client,
    cell_range: str = "A1:G2000",
    api_key: str = "",
) -> list[list[str]]:
    """Fetch 2D cell values from the specified sheet tab and cell range."""
    safe_title = sheet_title.replace("'", "''")
    full_range = f"'{safe_title}'!{cell_range}"
    url = f"{SHEETS_API_BASE}/{quote(spreadsheet_id, safe='')}/values/{quote(full_range, safe='')}"
    if api_key:
        url += f"?key={quote(api_key, safe='')}"
    resp = client.get(url)
    resp.raise_for_status()
    data = resp.json()
    return data.get("values", [])


def save_sheet_cache(
    projects: Sequence[dict],
    spreadsheet_id: str = "",
    sheet_title: str = "",
    cache_file: Path | None = None,
) -> dict:
    """Save synced Google Sheets project records to the JSON cache file."""
    target_file = cache_file or CACHE_FILE
    target_file.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "spreadsheet_id": spreadsheet_id,
        "sheet_title": sheet_title,
        "synced_at": datetime.now(UTC).isoformat(),
        "projects": list(projects),
    }
    target_file.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return payload


def load_sheet_projects(path: Path) -> list[dict]:
    """Load synced Google Sheets project records from disk. Returns empty list if missing or invalid."""
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("projects"), list):
            return raw["projects"]
        if isinstance(raw, list):
            return raw
    except (json.JSONDecodeError, OSError):
        return []
    return []


def sync_once(
    spreadsheet_id: str,
    *,
    sheet_title: str = "",
    access_token: str = "",
    api_key: str = "",
    cache_file: Path | None = None,
    rebuild_site: bool = False,
) -> list[dict]:
    """Fetch rows from the Google Sheet, update the local cache, and optionally rebuild the site."""
    clean_id = extract_spreadsheet_id(spreadsheet_id)
    if not clean_id:
        raise ValueError("A valid Google Spreadsheet ID or URL is required.")

    headers: dict[str, str] = {}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    with httpx.Client(
        headers=headers,
        transport=httpx.HTTPTransport(retries=2),
        timeout=30,
    ) as client:
        resolved_title = sheet_title.strip()
        if not resolved_title:
            titles = fetch_sheet_titles(clean_id, client, api_key=api_key)
            if not titles:
                raise RuntimeError(f"No sheet tabs found in spreadsheet {clean_id}.")
            resolved_title = titles[0]

        rows = fetch_sheet_rows(clean_id, resolved_title, client, api_key=api_key)
        projects = parse_sheet_projects(rows)

    save_sheet_cache(
        projects,
        spreadsheet_id=clean_id,
        sheet_title=resolved_title,
        cache_file=cache_file,
    )

    if rebuild_site:
        from build import build
        build(REPO_ROOT)

    return projects


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Fetch and sync project data from a Google Sheet into the Awesome Python library index."
    )
    parser.add_argument(
        "--spreadsheet-id",
        default=os.environ.get("GOOGLE_SPREADSHEET_ID", ""),
        help="Google Spreadsheet ID or URL (defaults to GOOGLE_SPREADSHEET_ID env var).",
    )
    parser.add_argument(
        "--tab",
        default=os.environ.get("GOOGLE_SHEET_TAB", ""),
        help="Sheet tab title (defaults to GOOGLE_SHEET_TAB or first tab in spreadsheet metadata).",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("GOOGLE_ACCESS_TOKEN", ""),
        help="OAuth 2.0 Bearer access token (defaults to GOOGLE_ACCESS_TOKEN env var).",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("GOOGLE_API_KEY", ""),
        help="Optional Google API key for public sheets (defaults to GOOGLE_API_KEY env var).",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=int(os.environ.get("GOOGLE_SHEETS_SYNC_INTERVAL", "0") or "0"),
        help="Poll interval in seconds for continuous background syncing (0 = run once).",
    )
    parser.add_argument(
        "--build",
        action="store_true",
        help="Rebuild website/output whenever synced sheet data changes.",
    )
    args = parser.parse_args(argv)

    if not args.spreadsheet_id:
        print(
            "Error: Provide --spreadsheet-id or set GOOGLE_SPREADSHEET_ID.",
            file=sys.stderr,
        )
        sys.exit(1)

    last_digest = ""
    while True:
        try:
            projects = sync_once(
                args.spreadsheet_id,
                sheet_title=args.tab,
                access_token=args.token,
                api_key=args.api_key,
                rebuild_site=False,
            )
            digest = hashlib.sha256(
                json.dumps(projects, sort_keys=True).encode("utf-8")
            ).hexdigest()
            print(f"Synced {len(projects)} projects from Google Sheet.")
            if args.build and digest != last_digest:
                from build import build
                build(REPO_ROOT)
            last_digest = digest
        except Exception as exc:
            print(f"Sync error: {exc}", file=sys.stderr)
            if args.interval <= 0:
                sys.exit(1)

        if args.interval <= 0:
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
