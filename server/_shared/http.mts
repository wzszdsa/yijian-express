import { env } from './config.mjs'
import { SESSION_TTL_SECONDS } from './security.mjs'

export function json(data: Record<string, unknown>, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('content-type', 'application/json; charset=utf-8')
  responseHeaders.set('cache-control', 'no-store')
  responseHeaders.set('x-content-type-options', 'nosniff')
  return new Response(JSON.stringify(data), { status, headers: responseHeaders })
}

export async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function methodNotAllowed(allow = 'POST'): Response {
  return json({ message: '请求方法不支持', code: 'METHOD_NOT_ALLOWED' }, 405, { allow })
}

export function sessionCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === 'https:'
  return `yijian_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS};${secure ? ' Secure;' : ''}`
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:'
  return `yijian_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT;${secure ? ' Secure;' : ''}`
}

export function cookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('cookie') ?? ''
  for (const entry of cookieHeader.split(';')) {
    const [key, ...rest] = entry.trim().split('=')
    if (key === name) return rest.join('=') || null
  }
  return null
}

export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown'
}

export function exposeDemoCode(): boolean {
  return env('AUTH_EXPOSE_DEMO_CODE') === 'true' && (env('EMAIL_PROVIDER', 'console') ?? 'console').toLowerCase() === 'console'
}

export function internalError(scope: string, error: unknown): Response {
  const details = error instanceof Error ? error.message : 'unknown error'
  console.error(`[yijian:${scope}]`, details)
  return json({ message: '服务暂时不可用，请稍后重试', code: 'SERVER_ERROR' }, 503)
}

