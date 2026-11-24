/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["read-excel-file"],
  turbopack: {
    root: import.meta.dirname,
  },
}

export default nextConfig
