"""Shared usage limits for Free vs Pro tiers (server-enforced where noted)."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Literal, Optional, TypedDict

Tier = Literal["free", "pro"]

FREE_RUN_DAILY_LIMIT = int(os.environ.get("FREE_RUN_DAILY_LIMIT", "10"))
PRO_RUN_DAILY_LIMIT = int(os.environ.get("PRO_RUN_DAILY_LIMIT", "50"))
FREE_SNIPPET_PUBLISH_MONTHLY = int(os.environ.get("FREE_SNIPPET_PUBLISH_MONTHLY", "3"))
PRO_SNIPPET_PUBLISH_MONTHLY = int(os.environ.get("PRO_SNIPPET_PUBLISH_MONTHLY", "100"))


class QuotaSnapshot(TypedDict):
    used: int
    limit: int
    resets_at: str


def normalize_tier(raw: Optional[str]) -> Tier:
    return "pro" if (raw or "").strip().lower() == "pro" else "free"


def run_daily_limit(tier: Tier) -> int:
    return PRO_RUN_DAILY_LIMIT if tier == "pro" else FREE_RUN_DAILY_LIMIT


def snippet_publish_monthly_limit(tier: Tier) -> int:
    return PRO_SNIPPET_PUBLISH_MONTHLY if tier == "pro" else FREE_SNIPPET_PUBLISH_MONTHLY


def utc_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def utc_month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def next_utc_midnight_iso() -> str:
    now = datetime.now(timezone.utc)
    tomorrow = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if now.hour or now.minute or now.second or now.microsecond:
        from datetime import timedelta

        tomorrow = tomorrow + timedelta(days=1)
    return tomorrow.isoformat()


def next_utc_month_iso() -> str:
    now = datetime.now(timezone.utc)
    year = now.year + (1 if now.month == 12 else 0)
    month = 1 if now.month == 12 else now.month + 1
    return datetime(year, month, 1, tzinfo=timezone.utc).isoformat()
