const SUPABASE_URL = process.env.SUPABASE_URL || 'https://stboueshyjvooiftfuxm.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

module.exports = async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  if (!SUPABASE_ANON_KEY || /PLACEHOLDER|YOUR-ANON/i.test(SUPABASE_ANON_KEY)) {
    return res.status(500).json({ error: 'Client auth is not configured.' });
  }
  return res.status(200).json({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY });
};
