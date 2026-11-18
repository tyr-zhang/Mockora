import type { NextConfig } from "next";

const basePath = "/mockora";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  output: "standalone",
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // pdf-parse（底层 pdfjs-dist）依赖运行期动态加载 worker 文件，被打包器（webpack/turbopack）
  // 重写后会触发 "Object.defineProperty called on non-object"，需在服务端排除打包。
  serverExternalPackages: ["pdf-parse"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
