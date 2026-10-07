/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ensure localnet-only fixtures never get pulled into the client bundle.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      // Explicitly do not resolve localnet IDL
    };
    return config;
  },
  transpilePackages: [
    "@solana/wallet-adapter-base",
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-wallets",
  ],
};

export default nextConfig;
