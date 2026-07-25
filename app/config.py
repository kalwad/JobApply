import os

from pydantic_settings import BaseSettings, SettingsConfigDict


def _migrate_legacy_env_prefix() -> None:
    """Copy JOBFINDER_* into JOBAPPLY_* when the new key is unset."""
    for key, value in list(os.environ.items()):
        if not key.startswith("JOBFINDER_"):
            continue
        new_key = "JOBAPPLY_" + key[len("JOBFINDER_") :]
        if new_key not in os.environ or os.environ.get(new_key, "") == "":
            os.environ[new_key] = value


_migrate_legacy_env_prefix()


class Settings(BaseSettings):
    anthropic_api_key: str = ""
    usajobs_api_key: str = ""
    db_path: str = "data/jobapply.db"
    scrape_interval_hours: int = 6
    min_salary: int = 150000
    min_hourly_rate: int = 95
    # Local-only by default. Override with JOBAPPLY_HOST=0.0.0.0 only if intentional.
    host: str = "127.0.0.1"
    port: int = 8085
    resume_path: str = "data/resume.txt"
    # Stage 1 default: disable scrapers, CRM, analytics, and scheduled jobs.
    slim_mode: bool = True

    model_config = SettingsConfigDict(env_prefix="JOBAPPLY_")
