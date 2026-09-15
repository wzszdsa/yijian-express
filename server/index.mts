import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import authLogin from './handlers/auth-login.mjs'
import authLogout from './handlers/auth-logout.mjs'
import authMe from './handlers/auth-me.mjs'
import authRegister from './handlers/auth-register.mjs'
import authSendCode from './handlers/auth-send-code.mjs'
import authSetPassword from './handlers/auth-set-password.mjs'
import parcelConfirmPickup from './handlers/parcel-confirm-pickup.mjs'
import parcelDetectCarrier from './handlers/parcel-detect-carrier.mjs'
import parcelList from './handlers/parcel-list.mjs'
import parcelTrackingQuery from './handlers/parcel-tracking-query.mjs'
import { json } from './_shared/http.mjs'
import { storageProvider } from './_shared/storage.mjs'

type Handler = (request: Request) => Promise<Response>

type ProcessWithEnvLoader = NodeJS.Process & {
  loadEnvFile?: (path?: string) => void
}

const envProcess = process as ProcessWithEnvLoader
try {
  envProcess.loadEnvFile?.(process.env.ENV_FILE || '.env')
} catch (error) {
  if (process.env.NODE_ENV === 'production') {
    console.warn('[yijian:env] 环境文件加载失败，继续使用系统环境变量', error instanceof Error ? error.message : 'unknown error')
  }
}

const routes = new Map<string, Handler>([
  ['GET /api/health', async () => json({ ok: true, service: 'yijian', storage: storageProvider() })],
  ['POST /api/auth/login', authLogin],
  ['POST /api/auth/logout', authLogout],
  ['GET /api/auth/me', authMe],
  ['POST /api/auth/register', authRegister],
  ['POST /api/auth/send-code', authSendCode],
  ['POST /api/auth/set-password', authSetPassword],
  ['POST /api/parcels/confirm-pickup', parcelConfirmPickup],
  ['POST /api/parcels/detect-carrier', parcelDetectCarrier],
  ['GET /api/parcels', parcelList],
  ['POST /api/parcels/query-tracking', parcelTrackingQuery],
])

const port = Number(process.env.PORT || process.env.APP_PORT || 3000)
const host = process.env.APP_HOST || '127.0.0.1'
const publicOrigin = process.env.PUBLIC_ORIGIN || 'https://wzzsl.fun'
const distRoot = path.resolve(process.env.WEB_ROOT || path.join(process.cwd(), 'dist'))
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || 1024 * 1024)

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  return headers
}

async function requestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += data.length
    if (size > maxBodyBytes) throw new Error('REQUEST_TOO_LARGE')
    chunks.push(data)
  }
  return Buffer.concat(chunks)
}

async function toWebRequest(request: IncomingMessage, body: Buffer): Promise<Request> {
  const forwardedProto = request.headers['x-forwarded-proto']
  const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || 'http'
  const hostHeader = request.headers.host || 'localhost'
  const url = new URL(request.url || '/', `${protocol}://${hostHeader}`)
  const method = request.method || 'GET'
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers: requestHeaders(request),
  }
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = body as unknown as BodyInit
    init.duplex = 'half'
  }
  return new Request(url, init)
}

function mimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }
  return types[extension] || 'application/octet-stream'
}

function safeStaticPath(urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const relative = decoded.replace(/^[/\\]+/, '')
  const filePath = path.resolve(distRoot, relative || 'index.html')
  const rootWithSeparator = distRoot.endsWith(path.sep) ? distRoot : `${distRoot}${path.sep}`
  if (filePath !== distRoot && !filePath.startsWith(rootWithSeparator)) return null
  return filePath
}

async function staticResponse(urlPath: string): Promise<Response> {
  const requestedPath = safeStaticPath(urlPath)
  if (!requestedPath) return json({ message: '资源路径不合法', code: 'INVALID_PATH' }, 400)
  try {
    const fileInfo = await stat(requestedPath)
    if (fileInfo.isFile()) {
      const content = await readFile(requestedPath)
      return new Response(content, {
        status: 200,
        headers: {
          'content-type': mimeType(requestedPath),
          'cache-control': requestedPath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        },
      })
    }
  } catch {
    // Fall through to the SPA entry below.
  }
  const indexPath = path.join(distRoot, 'index.html')
  try {
    const content = await readFile(indexPath)
    return new Response(content, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } })
  } catch {
    return json({ message: '前端资源尚未部署', code: 'WEB_NOT_DEPLOYED' }, 503)
  }
}

async function sendResponse(response: Response, serverResponse: ServerResponse): Promise<void> {
  serverResponse.statusCode = response.status
  const headersWithCookies = response.headers as Headers & { getSetCookie?: () => string[] }
  const setCookies = headersWithCookies.getSetCookie?.() ?? []
  response.headers.forEach((value, key) => {
    if (key === 'set-cookie') return
    serverResponse.setHeader(key, value)
  })
  if (setCookies.length) serverResponse.setHeader('set-cookie', setCookies)
  const body = Buffer.from(await response.arrayBuffer())
  if (!serverResponse.hasHeader('content-length')) serverResponse.setHeader('content-length', body.length)
  serverResponse.end(body)
}

async function handle(request: IncomingMessage, serverResponse: ServerResponse): Promise<void> {
  const method = request.method || 'GET'
  const parsedUrl = new URL(request.url || '/', publicOrigin)
  const route = routes.get(`${method} ${parsedUrl.pathname}`)
  if (route) {
    try {
      const body = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await requestBody(request)
      await sendResponse(await route(await toWebRequest(request, body)), serverResponse)
    } catch (error) {
      if (error instanceof Error && error.message === 'REQUEST_TOO_LARGE') {
        await sendResponse(json({ message: '请求内容过大', code: 'REQUEST_TOO_LARGE' }, 413), serverResponse)
        return
      }
      console.error('[yijian:server]', error instanceof Error ? error.message : 'unknown error')
      await sendResponse(json({ message: '服务暂时不可用，请稍后重试', code: 'SERVER_ERROR' }, 503), serverResponse)
    }
    return
  }
  if (parsedUrl.pathname.startsWith('/api/')) {
    await sendResponse(json({ message: '接口不存在', code: 'NOT_FOUND' }, 404), serverResponse)
    return
  }
  if (method !== 'GET' && method !== 'HEAD') {
    await sendResponse(json({ message: '请求方法不支持', code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET, HEAD' }), serverResponse)
    return
  }
  await sendResponse(await staticResponse(parsedUrl.pathname), serverResponse)
}

const server = createServer((request, response) => {
  void handle(request, response).catch(async (error) => {
    console.error('[yijian:server:uncaught]', error instanceof Error ? error.message : 'unknown error')
    if (!response.headersSent) await sendResponse(json({ message: '服务暂时不可用，请稍后重试', code: 'SERVER_ERROR' }, 503), response)
    else response.destroy()
  })
})

server.on('error', (error) => {
  console.error('[yijian:server:error]', error)
  process.exitCode = 1
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 5_000).unref()
  })
}

server.listen(port, host, () => {
  console.log(`[yijian] server listening on http://${host}:${port}; public origin ${publicOrigin}; web root ${distRoot}`)
})

