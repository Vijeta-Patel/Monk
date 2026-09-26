def paginate(items, page: int, per_page: int = 10):
    """Return one page of items. Pages start at 1."""
    if page < 1 or per_page < 1:
        raise ValueError("page and per_page must be at least 1")
    start = page * per_page
    return list(items[start:start + per_page])
