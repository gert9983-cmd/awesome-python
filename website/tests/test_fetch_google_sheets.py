"""Tests for fetch_google_sheets module and build.py Google Sheets index sync."""

import json
from unittest.mock import MagicMock

from build import merge_sheet_projects
from fetch_google_sheets import (
    extract_spreadsheet_id,
    fetch_sheet_rows,
    fetch_sheet_titles,
    is_header_row,
    load_sheet_projects,
    parse_int_metric,
    parse_sheet_projects,
    save_sheet_cache,
    sync_once,
)


class TestExtractSpreadsheetId:
    def test_extracts_id_from_full_url(self):
        url = "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0"
        assert extract_spreadsheet_id(url) == "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"

    def test_returns_raw_id_unchanged(self):
        raw_id = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
        assert extract_spreadsheet_id(raw_id) == raw_id

    def test_empty_input(self):
        assert extract_spreadsheet_id("   ") == ""


class TestParseIntMetric:
    def test_parses_comma_formatted_numbers(self):
        assert parse_int_metric("1,234,567") == 1234567

    def test_returns_none_for_badges_or_dashes(self):
        assert parse_int_metric("Stdlib") is None
        assert parse_int_metric("—") is None
        assert parse_int_metric("") is None


class TestParseSheetProjects:
    def test_parses_rows_with_header(self):
        rows = [
            [
                "Project Name",
                "Repository / Docs URL",
                "PyPI Downloads (30d)",
                "GitHub Stars",
                "Last Commit",
                "Tags",
                "Description",
            ],
            [
                "httpx",
                "https://github.com/encode/httpx",
                "120,000,000",
                "14,200",
                "2026-10-15T12:00:00Z",
                "HTTP Clients, Asynchronous Programming",
                "A next-generation HTTP client for Python.",
            ],
        ]
        assert is_header_row(rows[0]) is True
        projects = parse_sheet_projects(rows)
        assert len(projects) == 1
        p = projects[0]
        assert p["name"] == "httpx"
        assert p["url"] == "https://github.com/encode/httpx"
        assert p["downloads"] == 120000000
        assert p["stars"] == 14200
        assert p["last_commit_at"] == "2026-10-15T12:00:00Z"
        assert p["tags"] == ["HTTP Clients", "Asynchronous Programming"]
        assert p["description"] == "A next-generation HTTP client for Python."

    def test_parses_rows_without_header_and_deduplicates(self):
        rows = [
            ["fastapi", "https://github.com/fastapi/fastapi", "95000000", "80000", "", "Web Frameworks", "Fast web framework."],
            ["FastAPI", "https://github.com/fastapi/fastapi", "95000000", "80000", "", "Web Frameworks", "Duplicate row."],
        ]
        assert is_header_row(rows[0]) is False
        projects = parse_sheet_projects(rows)
        assert len(projects) == 1
        assert projects[0]["name"] == "fastapi"


class TestSaveAndLoadSheetCache:
    def test_round_trip(self, tmp_path):
        cache_file = tmp_path / "google_sheets_projects.json"
        sample = [
            {
                "name": "pydantic",
                "url": "https://github.com/pydantic/pydantic",
                "downloads": 300000000,
                "stars": 22000,
                "last_commit_at": "2026-11-01T00:00:00Z",
                "tags": ["Data Validation"],
                "description": "Data validation using Python type hints.",
            }
        ]
        save_sheet_cache(
            sample,
            spreadsheet_id="sheet-123",
            sheet_title="Shortlist",
            cache_file=cache_file,
        )
        loaded = load_sheet_projects(cache_file)
        assert loaded == sample


class TestFetchAndSyncOnce:
    def test_fetch_sheet_titles_and_rows_and_sync_once(self, tmp_path, monkeypatch):
        cache_file = tmp_path / "google_sheets_projects.json"

        meta_resp = MagicMock()
        meta_resp.raise_for_status = MagicMock()
        meta_resp.json.return_value = {
            "sheets": [
                {"properties": {"title": "Curated Picks"}},
                {"properties": {"title": "Archive"}},
            ]
        }

        values_resp = MagicMock()
        values_resp.raise_for_status = MagicMock()
        values_resp.json.return_value = {
            "values": [
                ["Project Name", "Repository / Docs URL", "PyPI Downloads (30d)", "GitHub Stars", "Last Commit", "Tags", "Description"],
                ["uv", "https://github.com/astral-sh/uv", "45,000,000", "42,000", "2026-11-02T00:00:00Z", "Package Management", "Fast Python package installer."],
            ]
        }

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get.side_effect = [meta_resp, values_resp]

        monkeypatch.setattr("fetch_google_sheets.httpx.Client", lambda **kwargs: mock_client)

        projects = sync_once(
            "https://docs.google.com/spreadsheets/d/abc123XYZ/edit",
            access_token="ya29.test-token",
            cache_file=cache_file,
        )
        assert len(projects) == 1
        assert projects[0]["name"] == "uv"
        assert projects[0]["downloads"] == 45000000
        saved = json.loads(cache_file.read_text(encoding="utf-8"))
        assert saved["spreadsheet_id"] == "abc123XYZ"
        assert saved["sheet_title"] == "Curated Picks"


class TestMergeSheetProjectsIntoBuild:
    def test_updates_existing_and_adds_new_entry(self):
        entries = [
            {
                "name": "requests",
                "url": "https://github.com/psf/requests",
                "description": "Old description.",
                "categories": ["HTTP Clients"],
                "groups": ["HTTP & Scraping"],
                "subcategories": [],
                "stars": 50000,
                "downloads": 100000000,
                "owner": "psf",
                "last_commit_at": "2025-01-01T00:00:00Z",
                "source_type": None,
                "bundled": False,
                "badge": None,
                "also_see": [],
            }
        ]
        categories = [{"name": "HTTP Clients", "slug": "http-clients", "description": "", "description_html": "", "entries": [], "entry_count": 1}]
        groups = [{"name": "HTTP & Scraping", "slug": "http-scraping", "categories": categories}]
        sheet_projects = [
            {
                "name": "requests",
                "url": "https://github.com/psf/requests",
                "downloads": 250000000,
                "stars": 53000,
                "last_commit_at": "2026-11-01T00:00:00Z",
                "tags": ["HTTP Clients"],
                "description": "Updated from Google Sheet.",
            },
            {
                "name": "custom-http-tool",
                "url": "https://github.com/example/custom-http-tool",
                "downloads": 500000,
                "stars": 1200,
                "last_commit_at": "2026-10-20T00:00:00Z",
                "tags": ["HTTP Clients"],
                "description": "Synced custom tool from Google Sheet.",
            },
        ]

        merged = merge_sheet_projects(entries, sheet_projects, categories, groups)
        assert len(merged) == 2
        assert merged[0]["downloads"] == 250000000
        assert merged[0]["stars"] == 53000
        assert merged[0]["description"] == "Updated from Google Sheet."
        assert merged[1]["name"] == "custom-http-tool"
        assert merged[1]["owner"] == "example"
        assert merged[1]["categories"] == ["HTTP Clients"]
