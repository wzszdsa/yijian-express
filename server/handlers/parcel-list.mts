import { userFromRequest } from '../_shared/auth.mjs'
import { internalError, json, methodNotAllowed } from '../_shared/http.mjs'
import { listParcels } from '../_shared/parcels.mjs'

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  try {
    const user = await userFromRequest(request)
    if (!user) return json({ message: '请先登录后查看包裹', code: 'AUTH_REQUIRED' }, 401)
    return json({ parcels: await listParcels(user.id) })
  } catch (error) {
    return internalError('parcel:list', error)
  }
}


