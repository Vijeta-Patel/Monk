"""textkit: small text helpers used by the Monk sandbox app (Monk eval fixture)."""
from .slug import slugify
from .duration import parse_duration
from .paginate import paginate

__all__ = ["slugify", "parse_duration", "paginate"]
