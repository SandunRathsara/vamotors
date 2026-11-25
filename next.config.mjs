/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["**.ts.net"],
  serverExternalPackages: ["read-excel-file"],
  turbopack: {
    root: import.meta.dirname,
  },
}

export default nextConfig
