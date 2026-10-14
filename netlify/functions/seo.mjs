// robots.txt et sitemap.xml, avec l'adresse réelle du site (quel que soit le domaine).
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
export default async (req) => {
  const u = new URL(req.url), base = u.origin;
  if (u.pathname === '/robots.txt')
    return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`, {headers: {'content-type': 'text/plain; charset=utf-8'}});
  const day = new Date().toISOString().slice(0, 10);
  const urls = ['/', '/joueurs/', ...LETTERS.map(l => `/joueurs/${l}.html`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(p => `  <url><loc>${base}${p}</loc><lastmod>${day}</lastmod><changefreq>${p === '/' ? 'daily' : 'weekly'}</changefreq><priority>${p === '/' ? '1.0' : '0.6'}</priority></url>`).join('\n') +
    `\n</urlset>\n`;
  return new Response(xml, {headers: {'content-type': 'application/xml; charset=utf-8'}});
};
export const config = { path: ['/robots.txt', '/sitemap.xml'] };
