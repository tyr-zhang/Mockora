/**
 * 应用部署子路径（basePath），需与 next.config.ts 中的 basePath 保持一致。
 * 客户端的原生 fetch 调用不会被 Next.js 自动加上 basePath 前缀（不同于 next/link、useRouter），
 * 因此所有指向本应用 API 路由的 fetch 调用都需要显式拼接本前缀。
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function apiPath(path: string): string {
  return `${BASE_PATH}${path}`;
}
