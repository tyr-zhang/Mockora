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
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  // pdfjs-dist 通过动态字符串 require 加载 @napi-rs/canvas 以在 Node 环境下提供
  // DOMMatrix/ImageData/Path2D 的运行时能力，输出文件追踪（nft）静态分析不到这类动态
  // require，standalone 产物默认不会携带它，需显式指定追踪包含，否则部署后解析带图片的
  // PDF 会抛出 "ReferenceError: DOMMatrix is not defined"。
  outputFileTracingIncludes: {
    "/api/resume": ["./node_modules/@napi-rs/**/*"],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
