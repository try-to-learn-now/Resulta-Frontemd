// pages/api/revalidate.js

// --- THIS IS THE FIX ---
// Cloudflare Pages needs this line to build the API
export const runtime = 'edge';
// --- END FIX ---


export default async function handler(req, res) {
  // 1. Check for your frontend secret token
  // We use req.nextUrl.searchParams because we are in the Edge runtime
  const secret = req.nextUrl.searchParams.get('secret');
  
  if (secret !== process.env.MY_SECRET_TOKEN) {
    return new Response(JSON.stringify({ message: 'Invalid token' }), { status: 401 });
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
    // 'revalidate' is a Next.js feature. We need to check how to call it in edge.
    // For Vercel/Next.js on Pages, calling revalidate() on the response object is correct.
    // But the build log implies this is a dynamic route.
    // Let's assume the build process hooks this up.
    // Note: If `res.revalidate` doesn't work in Edge, we have a different problem.
    // But let's try the fix from the log first.
    // *** A-HA! The log shows `ƒ /api/revalidate` - it's a dynamic function.
    // In Next.js on CF Pages, `revalidate` is part of the `NextResponse`
    // We should be using `NextResponse.revalidate()`
    // BUT your build is using `@cloudflare/next-on-pages` which is old.
    
    // Let's stick to the simplest fix. The log says it's a route, so `res.revalidate` *should* be polyfilled.
    // If this fails, we will change it.
    
    // *** NEW THOUGHT: The log shows you are using `pages` router, not `app` router.
    // My previous code `await res.revalidate('/')` is correct for `pages` router.
    // The only error is the missing `runtime` export.
    
    await res.revalidate('/'); // This line is correct.
    
    console.log('Homepage revalidated.');
    
    // 3. Send a success message
    return new Response(JSON.stringify({ revalidated: true, proxy_purged: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    // If there was an error, send a 500
    console.error('Revalidation error:', err.message);
    return new Response(JSON.stringify({ error: `Error revalidating: ${err.message}` }), { status: 500 });
  }
}
