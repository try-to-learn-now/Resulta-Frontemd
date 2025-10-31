// pages/api/revalidate.js

export default async function handler(req, res) {
  // 1. Check for your frontend secret token
  if (req.query.secret !== process.env.MY_SECRET_TOKEN) {
    return res.status(401).json({ message: 'Invalid token' });
  }

  try {
    // === JOB 1: Purge the Cloudflare Worker's Cache ===
    console.log('Purging proxy worker cache...');
    const proxyUrl = 'https://resulta-exams-proxy.walla.workers.dev'; // Your proxy URL
    const purgeResponse = await fetch(proxyUrl, {
      method: 'PURGE',
      headers: {
        // This 'X-PURGE-SECRET' MUST match the 'MY_SECRET_TOKEN'
        // You set in your WORKER's environment variables.
        'X-PURGE-SECRET': process.env.MY_SECRET_TOKEN
      }
    });

    if (!purgeResponse.ok) {
      const errorBody = await purgeResponse.text();
      throw new Error(`Failed to purge proxy cache: ${purgeResponse.status} - ${errorBody}`);
    }
    console.log('Proxy cache purged successfully.');

    // === JOB 2: Rebuild the Next.js Homepage ===
    console.log('Revalidating homepage...');
    await res.revalidate('/');
    console.log('Homepage revalidated.');
    
    // 3. Send a success message
    return res.json({ revalidated: true, proxy_purged: true });

  } catch (err) {
    // If there was an error, send a 500
    console.error('Revalidation error:', err.message);
    return res.status(500).send(`Error revalidating: ${err.message}`);
  }
}
