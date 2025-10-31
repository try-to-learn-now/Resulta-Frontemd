// This is your secret "update" button.
// It is safe because only someone who knows the
// 'MY_SECRET_TOKEN' can use it.
export default async function handler(req, res) {
  
  // 1. Check for your secret token
  // This prevents random users/hackers from spamming you.
  if (req.query.secret !== process.env.MY_SECRET_TOKEN) {
    return res.status(401).json({ message: 'Invalid token' });
  }

  try {
    // 2. Tell Next.js to re-build the homepage
    // The '/' means the homepage (pages/index.js)
    console.log('Revalidating homepage...');
    await res.revalidate('/');
    
    // 3. Send a success message
    console.log('Revalidation successful!');
    return res.json({ revalidated: true });
  } catch (err) {
    // If there was an error, send a 500
    console.error('Revalidation error:', err);
    return res.status(500).send('Error revalidating');
  }
}
