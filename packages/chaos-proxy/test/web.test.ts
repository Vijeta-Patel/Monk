import { describe, expect, it } from 'vitest';
import { assertPublicUrl, htmlToText, parseDuckDuckGo, webFetch } from '../src/web.ts';

const publicDns = async () => ['93.184.216.34'];

describe('web tools', () => {
  it('parses DuckDuckGo results, unwrapping redirect links and skipping ads', () => {
    const html = `
      <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a>
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwttr.in%2FBengaluru&amp;rut=x">Weather &amp; more</a>
      <a class="result__snippet" href="x">Bengaluru <b>27°C</b> cloudy</a>
      <a rel="nofollow" class="result__a" href="https://example.org/a">Second</a>`;
    expect(parseDuckDuckGo(html)).toEqual([
      { title: 'Weather & more', url: 'https://wttr.in/Bengaluru', snippet: 'Bengaluru 27°C cloudy' },
      { title: 'Second', url: 'https://example.org/a', snippet: '' },
    ]);
  });

  it('refuses local, private and non-http URLs', async () => {
    await expect(assertPublicUrl('http://localhost:8788/api', publicDns)).rejects.toThrow(/local/);
    await expect(assertPublicUrl('http://127.0.0.1/', publicDns)).rejects.toThrow(/private/);
    await expect(assertPublicUrl('http://[::1]/', publicDns)).rejects.toThrow(/private/);
    await expect(assertPublicUrl('file:///etc/passwd', publicDns)).rejects.toThrow(/http/);
    await expect(assertPublicUrl('http://evil.example/', async () => ['10.0.0.5'])).rejects.toThrow(/private/);
    await expect(assertPublicUrl('https://wttr.in/x', publicDns)).resolves.toBeInstanceOf(URL);
  });

  it('checks every redirect hop', async () => {
    const f = (async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } })) as unknown as typeof fetch;
    await expect(webFetch('https://example.org/', { fetchImpl: f, resolve: publicDns })).rejects.toThrow(/private/);
  });

  it('turns HTML into text without scripts', async () => {
    expect(htmlToText('<html><head><title>T</title><script>x()</script></head><body><p>Hello&nbsp;there</p><div>next</div></body></html>')).toBe('# T\n\nHello there\nnext');
    const f = (async () => new Response('{"temp":27}', { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    expect(await webFetch('https://wttr.in/x?format=j1', { fetchImpl: f, resolve: publicDns })).toBe('{"temp":27}');
  });
});
