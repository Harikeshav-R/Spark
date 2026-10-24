/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    resolveAlias: {
      "./common.js": "./src/contracts/common.ts",
      "./mastery.js": "./src/contracts/mastery.ts",
      "./course.js": "./src/contracts/course.ts",
      "./classroom.js": "./src/contracts/classroom.ts",
    },
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
