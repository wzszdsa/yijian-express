import { userFromRequest, publicUser } from '../_shared/auth.mjs'
import { internalError, json, methodNotAllowed } from '../_shared/http.mjs'

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')

  try {
    const user = await userFromRequest(request)
    return user ? json({ user: publicUser(user) }) : json({ user: null, code: 'AUTH_REQUIRED' }, 401)
  } catch (error) {
    return internalError('auth:me', error)
  }
}



