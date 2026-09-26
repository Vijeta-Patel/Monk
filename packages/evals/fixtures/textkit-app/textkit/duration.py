import re

_UNITS = {"h": 3600, "m": 60, "s": 1}


def parse_duration(text: str) -> int:
    """Parse durations like "90s", "5m", "2h" or "1h30m" into seconds."""
    parts = re.findall(r"(\d+)([hms])", text.strip().lower())
    if not parts:
        raise ValueError(f"not a duration: {text!r}")
    value, unit = parts[-1]
    return int(value) * _UNITS[unit]
