/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true, // Recommended for development
  // If deploying to Cloudflare Pages via static export (less common now):
  // output: 'export',
  // images: {
  //   unoptimized: true, // Needed for static export if using next/image
  // },
};

module.exports = nextConfig;
