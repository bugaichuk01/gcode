import asyncio
import httpx
from settings import get_settings
async def test():
    s = get_settings()
    params = {"apikey": s.national_catalog_api_key, "feed_id": "2481647", "verbose": "true"}
    base = s.national_catalog_send_url.split("/v3/")[0]
    timeout = httpx.Timeout(s.national_catalog_timeout_seconds)
    async with httpx.AsyncClient(verify=False, timeout=timeout) as client:
        r = await client.get(f"{base}/v3/feed-status", params=params)
        print("Status:", r.status_code)
        print(r.text[:500])
asyncio.run(test())
