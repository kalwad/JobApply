from app.config import Settings

def test_settings_defaults():
    s = Settings(anthropic_api_key="test-key")
    assert s.db_path == "data/jobapply.db"
    assert s.host == "127.0.0.1"
    assert s.scrape_interval_hours == 6
    assert s.min_salary == 150000
    assert s.min_hourly_rate == 95
    assert s.anthropic_api_key == "test-key"
    assert s.slim_mode is True

def test_settings_custom():
    s = Settings(anthropic_api_key="k", scrape_interval_hours=12, min_salary=180000, slim_mode=False)
    assert s.scrape_interval_hours == 12
    assert s.min_salary == 180000
    assert s.slim_mode is False
