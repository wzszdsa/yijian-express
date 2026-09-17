import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { ArrowUpRight, Bell, Check, ChevronRight, CircleAlert, CircleCheck, Clipboard, Clock3, Copy, Eye, EyeOff, House, KeyRound, Layers3, Link2, LockKeyhole, LogIn, LogOut, MapPin, Menu, Package, PackageCheck, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Truck, UserRound, X, Zap } from 'lucide-react'
import { apiRequest } from './api'
import './App.css'

type Status = '待取件' | '运输中' | '已完成'
type Filter = '全部' | Status
type View = 'packages' | 'sources' | 'settings'
type AuthMode = 'code' | 'password'
type AuthView = 'login' | 'register'
type AuthStatus = 'checking' | 'authenticated' | 'anonymous' | 'unavailable'
type AuthUser = { id: string; email: string; createdAt: string; passwordSet?: boolean }
type AuthResponse = { user?: AuthUser | null; message?: string; code?: string; retryAfter?: number; demoCode?: string }
/** 密码弹窗的两种语义：首次设置无需原密码，修改必须校验身份。 */
type PasswordDialogMode = 'set' | 'change'
/** 服务端返回的「可就地修正」的字段级错误，由表单显示在对应输入框下方。 */
type PasswordFieldError = { field: 'current' | 'code'; message: string }
/** 提示条带自增序号，保证同文案重复触发时动画与计时都会重新开始。 */
type Notice = { text: string; seq: number }
type SendCodeResult = { ok: boolean; status: number; retryAfter?: number; message?: string; code?: string }
type ParcelQueryResponse = { parcels?: Parcel[]; parcel?: { trackingNo: string; status: Status }; message?: string; code?: string; detection?: DetectionResult; carrierCode?: string }
type ParcelMutationResponse = { message?: string; code?: string }

type Event = { time: string; title: string; text: string; active?: boolean; location?: string; lat?: number; lng?: number }
type Parcel = { id: string; carrier: string; short: string; color: string; pale: string; tracking: string; title: string; route: string; status: Status; eta: string; updated: string; location: string; code?: string; spot?: string; events: Event[] }
type Provider = { code?: string; name: string; short: string; color: string; pale: string; connected: boolean; synced?: string; description: string }

type DetectionConfidence = 'high' | 'medium' | 'low'
type DetectionEvidence = { type: string; value: string; note: string }
type CarrierCandidate = { carrierCode: string; carrierName: string; short: string; confidence: DetectionConfidence; evidence: DetectionEvidence[] }
type DetectionResult = { trackingNo: string; normalized: string; matched: boolean; best: CarrierCandidate | null; candidates: CarrierCandidate[]; unmatchedReason: string | null }
type DetectionResponse = { detection?: DetectionResult; message?: string; code?: string }


const initialParcels: Parcel[] = []

const providerList: Provider[] = [
  { code: 'shunfeng', name: '顺丰速运', short: '顺丰', color: '#ed6b4d', pale: '#fff0ea', connected: true, synced: '实时', description: '平台直查 · 物流轨迹 · 状态同步' },
  { code: 'jd', name: '京东物流', short: '京东', color: '#4a6ff0', pale: '#edf2ff', connected: true, synced: '实时', description: '平台直查 · 物流轨迹 · 配送状态' },
  { code: 'zto', name: '中通快递', short: '中通', color: '#1d9f73', pale: '#e9faf3', connected: true, synced: '实时', description: '平台直查 · 物流轨迹 · 到站状态' },
  { code: 'yto', name: '圆通速递', short: '圆通', color: '#f0a334', pale: '#fff6e4', connected: true, synced: '实时', description: '平台直查 · 物流轨迹 · 到站状态' },
  { code: 'yunda', name: '韵达快递', short: '韵达', color: '#7659d6', pale: '#f1edff', connected: true, synced: '实时', description: '平台直查 · 物流轨迹 · 到站状态' },
  { code: 'sto', name: '申通快递', short: '申通', color: '#ef7c35', pale: '#fff0e7', connected: true, synced: '实时', description: '平台直查 · 物流轨迹 · 到站状态' },
  { code: 'jtexpress', name: '极兔速递', short: '极兔', color: '#e95c72', pale: '#fff0f3', connected: true, synced: '实时', description: '平台直查 · 物流轨迹 · 配送状态' },
  { code: 'deppon', name: '德邦快递', short: '德邦', color: '#3193bf', pale: '#eaf7fc', connected: true, synced: '实时', description: '平台直查 · 物流轨迹 · 配送状态' },
  { code: 'ems', name: 'EMS', short: 'EMS', color: '#2b7bb9', pale: '#eaf5fd', connected: true, synced: '实时', description: '平台直查 · 物流轨迹 · 配送状态' },
  { code: 'best', name: '百世快递', short: '百世', color: '#e5a52f', pale: '#fff8e5', connected: true, synced: '实时', description: '平台直查 · 物流轨迹 · 配送状态' },
  { code: 'youshunda', name: '优速快递', short: '优速', color: '#6b61ca', pale: '#f1efff', connected: true, synced: '实时', description: '平台直查 · 物流轨迹 · 配送状态' },
  { code: 'anep', name: '安能物流', short: '安能', color: '#e06e3a', pale: '#fff0e8', connected: true, synced: '实时', description: '平台直查 · 物流轨迹 · 配送状态' },
  { code: 'china_post', name: '中国邮政', short: '邮政', color: '#cf4e4e', pale: '#fff0f0', connected: true, synced: '实时', description: '平台直查 · 物流轨迹 · 配送状态' },
  { code: 'zjs', name: '宅急送', short: '宅急送', color: '#d96e3e', pale: '#fff1eb', connected: true, synced: '实时', description: '平台直查 · 物流轨迹 · 配送状态' },
  { name: '菜鸟/其他', short: '更多', color: '#667785', pale: '#eef2f4', connected: false, description: '支持快递100可查询的更多承运商' },
]

const selectableProviders = providerList.filter((provider): provider is Provider & { code: string } => Boolean(provider.code))

/**
 * 快递100 要求必填收寄件人手机号的承运商。
 * 官方《实时快递查询接口》文档：phone 字段「顺丰速运、顺丰快运、中通快递必填，其他快递公司选填」，
 * 缺失时上游返回 408「快递公司参数异常：验证码错误」。本项目顺丰速运/快运共用 shunfeng 编码。
 */
const PHONE_REQUIRED_CARRIERS = new Set(['shunfeng', 'zto'])

const nav: Array<{ key: View; label: string; icon: ReactNode }> = [
  { key: 'packages', label: '我的包裹', icon: <House size={18} /> },
  { key: 'sources', label: '数据来源', icon: <Layers3 size={18} /> },
  { key: 'settings', label: '账号设置', icon: <Settings2 size={18} /> },
]

const maskEmail = (email: string) => { const [local, domain] = email.split('@'); if (!domain) return email; return `${local.slice(0, 2)}***@${domain}` }
const avatarText = (email: string) => email.trim().charAt(0).toUpperCase() || '驿'
const cssVars = (color: string, pale: string) => ({ '--carrier': color, '--carrier-pale': pale } as CSSProperties)
const readBooleanPreference = (key: string, fallback: boolean) => {
  try {
    const value = typeof window === 'undefined' ? null : window.localStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}
/** 尊重系统的「减少动态效果」偏好：滚动与过渡不应强制播放动画。 */
const prefersReducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [view, setView] = useState<View>('packages')
  const [filter, setFilter] = useState<Filter>('全部')
  const [query, setQuery] = useState('')
  const [parcels, setParcels] = useState(initialParcels)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState('尚未查询')
  const [trackingCarrier, setTrackingCarrier] = useState('')
  const [trackingNumber, setTrackingNumber] = useState('')
  const [detection, setDetection] = useState<DetectionResult | null>(null)
  const [detecting, setDetecting] = useState(false)
  // 用户一旦手动指定过平台，识别结果就不再覆盖它（人工选择优先，避免"改回去"的体验倒退）
  const [carrierTouched, setCarrierTouched] = useState(false)
  // 收寄件人手机号：仅中通/顺丰需要。存在这里是为了让「重新查询同一单号」不必重填。
  const [trackingPhone, setTrackingPhone] = useState('')
  // 服务端明确要求手机号时置位：这样即便平台尚未确定（自动识别未定案），字段也能出现并给出指引。
  const [phoneRequiredByServer, setPhoneRequiredByServer] = useState(false)
  const detectionSeq = useRef(0)
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeSeq = useRef(0)
  const noticeTimer = useRef<number | null>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountAreaRef = useRef<HTMLDivElement>(null)
  const [autoSync, setAutoSync] = useState(() => readBooleanPreference('yijian.autoSync', true))
  const [push, setPush] = useState(() => readBooleanPreference('yijian.push', true))
  const [authMode, setAuthMode] = useState<AuthMode>('code')
  const [authView, setAuthView] = useState<AuthView>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [verificationTarget, setVerificationTarget] = useState('')
  const [passwordDialog, setPasswordDialog] = useState<PasswordDialogMode | null>(null)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  // 包裹列表是否已完成首次加载：用于区分「确实没有包裹」与「还没查完」，
  // 否则首屏会先闪一下「还没有包裹记录」再跳出列表。
  const [parcelsReady, setParcelsReady] = useState(false)
  const demoAuthEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_AUTH !== 'false'

  useEffect(() => {
    let active = true
    void apiRequest<AuthResponse>('/api/auth/me').then(({ response, data }) => {
      if (!active) return
      if (response.ok && data?.user) {
        setUser(data.user)
        setEmail(data.user.email)
        setAuthStatus('authenticated')
        void apiRequest<ParcelQueryResponse>('/api/parcels').then(({ response: parcelResponse, data: parcelData }) => {
          if (!active) return
          if (parcelResponse.ok) {
            const list = parcelData?.parcels ?? []
            setParcels(list)
            // 已有包裹时用最新一条的更新时间，避免出现"最后更新于 尚未查询"这种自相矛盾的文案。
            // 列表按 last_synced_at 倒序返回，取首条即可。
            if (list.length && list[0].updated) setLastSync(list[0].updated)
          }
          setParcelsReady(true)
        })
      } else if (response.status === 401) {
        setAuthStatus('anonymous')
      } else {
        setAuthStatus('unavailable')
      }
    }).catch(() => {
      if (active) setAuthStatus('unavailable')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!accountMenuOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (accountAreaRef.current && !accountAreaRef.current.contains(event.target as Node)) setAccountMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [accountMenuOpen])

  // Esc 统一关闭浮层：侧栏菜单、账号菜单、包裹详情抽屉、密码弹窗。
  // 之前只覆盖了前两者，导致抽屉与弹窗打开时按 Esc 无反应。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMobileNav(false)
      setAccountMenuOpen(false)
      setSelectedId(null)
      setPasswordDialog((current) => (passwordBusy ? current : null))
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [passwordBusy])

  // 浮层打开时锁定背景滚动，避免抽屉/弹窗后面的列表跟着一起滚。
  useEffect(() => {
    if (!selectedId && !passwordDialog) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [selectedId, passwordDialog])

  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem('yijian.autoSync', String(autoSync))
      window.localStorage.setItem('yijian.push', String(push))
    } catch {
      // 本地存储不可用时仍保留当前页面内的设置。
    }
  }, [autoSync, push])

  // 运单号识别：输入停顿 450ms 后才请求，避免把单号逐字符送到服务端。
  // 识别只用于"预填 + 展示依据"，不参与任何自动重试。
  useEffect(() => {
    if (authStatus !== 'authenticated') return
    const normalized = trackingNumber.trim().replace(/\s/g, '')
    // 单号太短时不值得请求；清理由 effect 同步到外部（服务端）之外的状态。
    if (normalized.length < 8) return
    const seq = ++detectionSeq.current
    const timer = window.setTimeout(() => {
      setDetecting(true)
      void apiRequest<DetectionResponse>('/api/parcels/detect-carrier', { method: 'POST', body: JSON.stringify({ trackingNo: normalized }) })
        .then(({ response, data }) => {
          if (seq !== detectionSeq.current) return
          setDetection(response.ok ? data?.detection ?? null : null)
        })
        .catch(() => { if (seq === detectionSeq.current) setDetection(null) })
        .finally(() => { if (seq === detectionSeq.current) setDetecting(false) })
    }, 450)
    return () => window.clearTimeout(timer)
  }, [trackingNumber, authStatus])

  // 展示用的识别结果与"生效平台"都在渲染期派生，避免用 effect 回写 state 造成级联渲染。
  // activeDetection：单号过短时视为无识别结果，防止上一单号的结论残留。
  const activeDetection = trackingNumber.trim().replace(/\s/g, '').length >= 8 ? detection : null
  const activeDetecting = trackingNumber.trim().replace(/\s/g, '').length >= 8 ? detecting : false
  // 生效平台：人工指定优先；否则在未手动指定时用高置信度识别结果兜底。
  const effectiveCarrier = trackingCarrier
    || (carrierTouched ? '' : (activeDetection?.best?.confidence === 'high' ? activeDetection.best.carrierCode : ''))
  // 手机号字段的显示条件：生效平台在必填名单内，或服务端已明确要求（含自动识别出中通/顺丰的情形）。
  const phoneNeeded = PHONE_REQUIRED_CARRIERS.has(effectiveCarrier) || phoneRequiredByServer

  const selected = useMemo(() => parcels.find((item) => item.id === selectedId) ?? null, [parcels, selectedId])
  const connected = new Set(parcels.map((item) => item.carrier)).size
  const waiting = parcels.filter((item) => item.status === '待取件').length
  const transit = parcels.filter((item) => item.status === '运输中').length
  const filtered = useMemo(() => parcels.filter((item) => (filter === '全部' || item.status === filter) && (!query.trim() || [item.carrier, item.title, item.tracking, item.location].some((field) => field.toLowerCase().includes(query.trim().toLowerCase())))), [filter, parcels, query])

  // 提示条只保留一个计时器：否则连续两次提示时，前一个计时器会提前清掉后一条提示。
  const toast = (text: string) => {
    setNotice({ text, seq: (noticeSeq.current += 1) })
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => {
      noticeTimer.current = null
      setNotice(null)
    }, 3200)
  }
  const openAccountSettings = () => {
    const alreadyOpen = view === 'settings'
    setView('settings')
    setMobileNav(false)
    setAccountMenuOpen(false)
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    if (alreadyOpen) toast('你已在账号设置')
  }
  const toggleAccountMenu = () => {
    setMobileNav(false)
    setAccountMenuOpen((open) => !open)
  }
  const queryTrackingNumber = async (carrierCode: string, trackingValue: string, phoneValue = '') => {
    if (syncing) return
    const normalizedCarrierCode = carrierCode.trim().toLowerCase()
    // 平台可以由用户手动指定，也可以留空交由服务端按单号识别。
    if (normalizedCarrierCode && !selectableProviders.some((provider) => provider.code === normalizedCarrierCode)) return toast('请选择快递平台')
    const normalizedTrackingNo = trackingValue.trim().replace(/\s/g, '')
    if (!/^[A-Za-z0-9-]{4,128}$/.test(normalizedTrackingNo)) return toast('请输入正确的快递运单号')
    const normalizedPhone = phoneValue.trim()
    // 平台已确定是中通/顺丰时不发无谓请求：直接展开手机号字段，把「缺什么」说在前面。
    if (PHONE_REQUIRED_CARRIERS.has(normalizedCarrierCode) && !normalizedPhone) {
      setPhoneRequiredByServer(true)
      return toast('查询中通、顺丰需要填写收寄件人手机号')
    }
    setSyncing(true)
    try {
      const { response, data } = await apiRequest<ParcelQueryResponse>('/api/parcels/query-tracking', { method: 'POST', body: JSON.stringify({ ...(normalizedCarrierCode ? { carrierCode: normalizedCarrierCode } : {}), trackingNo: normalizedTrackingNo, ...(normalizedPhone ? { phone: normalizedPhone } : {}) }) })
      if (!response.ok || !data) {
        // 歧义或未能识别时，把候选交给用户确认，绝不静默换平台重试。
        if (data?.detection) setDetection(data.detection)
        // 服务端要求手机号（含自动识别出中通/顺丰、以及号码对不上的情况）：展开字段让用户就地补齐再查。
        if (data?.code === 'PHONE_REQUIRED' || data?.code === 'INVALID_PHONE') setPhoneRequiredByServer(true)
        return toast(data?.message ?? '运单查询失败，请稍后重试')
      }
      const { response: parcelResponse, data: parcelData } = await apiRequest<ParcelQueryResponse>('/api/parcels')
      if (parcelResponse.ok) setParcels(parcelData?.parcels ?? [])
      setLastSync('刚刚')
      if (data.detection?.best) setDetection(data.detection)
      toast(data.message ?? '物流信息已更新')
    } catch {
      toast('暂时无法连接物流查询服务，请稍后重试')
    } finally {
      setSyncing(false)
    }
  }
  const sync = () => { void queryTrackingNumber(effectiveCarrier, trackingNumber, trackingPhone) }

  const chooseCarrier = (carrierCode: string) => {
    setCarrierTouched(true)
    setTrackingCarrier(carrierCode)
  }

  const copy = (code: string) => { navigator.clipboard?.writeText(code).then(() => toast(`取件码 ${code} 已复制`)).catch(() => toast('复制失败，请手动记录')) }
  const markParcelPickedUp = (parcelId: string) => {
    setParcels((items) => items.map((item) => item.id === parcelId ? { ...item, status: '已完成', eta: '已取件', code: undefined, updated: '刚刚', location: '已从驿站取出', events: [{ time: '刚刚', title: '用户已确认取件', text: '取件码已按隐私策略删除。', active: true }, ...item.events] } : item))
    setSelectedId(null)
    setVisible((items) => ({ ...items, [parcelId]: false }))
  }

  const confirm = async (parcel: Parcel) => {
    if (confirmingId) return
    setConfirmingId(parcel.id)
    try {
      if (demoAuthEnabled) {
        markParcelPickedUp(parcel.id)
        toast('演示模式已确认取件，刷新页面后会重置')
        return
      }
      const { response, data } = await apiRequest<ParcelMutationResponse>('/api/parcels/confirm-pickup', { method: 'POST', body: JSON.stringify({ parcelId: parcel.id }) })
      if (!response.ok) {
        toast(data?.message ?? '取件状态保存失败，请稍后重试')
        return
      }
      const { response: parcelResponse, data: parcelData } = await apiRequest<ParcelQueryResponse>('/api/parcels')
      if (parcelResponse.ok) setParcels(parcelData?.parcels ?? [])
      else markParcelPickedUp(parcel.id)
      setSelectedId(null)
      setVisible((items) => ({ ...items, [parcel.id]: false }))
      toast(data?.message ?? '已确认取件，取件码已删除')
    } catch {
      toast('暂时无法保存取件状态，请检查网络后重试')
    } finally {
      setConfirmingId(null)
    }
  }

  const changeAuthView = (value: AuthView) => {
    setAuthView(value)
    setAuthMode('code')
    setPassword('')
    setVerificationTarget('')
  }

  const changeAuthMode = (value: AuthMode) => {
    setAuthMode(value)
    setPassword('')
    setVerificationTarget('')
  }

  const sendCode = async (targetEmail: string, purpose: AuthView): Promise<SendCodeResult> => {
    const normalizedEmail = targetEmail.trim().toLowerCase()
    try {
      const { response, data } = await apiRequest<AuthResponse>('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ email: normalizedEmail, purpose }) })
      if (!data) {
        if (demoAuthEnabled) {
          setVerificationTarget(normalizedEmail)
          toast('当前为本地演示模式，验证码为 123456')
          return { ok: true, status: response.status, retryAfter: 60, message: '演示验证码已准备好' }
        }
        toast('服务响应异常，请稍后重试')
        return { ok: false, status: response.status }
      }
      if (!response.ok) {
        if (response.status === 409 && purpose === 'register') {
          changeAuthView('login')
          toast(data.message ?? '该邮箱已注册，已切换到登录')
        } else {
          toast(data.message ?? '验证码发送失败')
        }
        return { ok: false, status: response.status, retryAfter: data.retryAfter, message: data.message, code: data.code }
      }
      setVerificationTarget(normalizedEmail)
      toast(data.demoCode ? `验证码已发送，演示码：${data.demoCode}` : data.message ?? '验证码已发送，请查收邮件')
      return { ok: true, status: response.status, retryAfter: data.retryAfter ?? 60, message: data.message, code: data.code }
    } catch {
      if (demoAuthEnabled) {
        setVerificationTarget(normalizedEmail)
        toast('当前为本地演示模式，验证码为 123456')
        return { ok: true, status: 0, retryAfter: 60, message: '演示验证码已准备好' }
      }
      toast('暂时无法连接服务，请检查网络后重试')
      return { ok: false, status: 0 }
    }
  }

  const finishAuth = (authUser: AuthUser, message: string) => {
    setUser(authUser)
    setEmail(authUser.email)
    setAuthStatus('authenticated')
    setAuthBusy(false)
    setPassword('')
    setVerificationTarget('')
    setParcelsReady(false)
    void apiRequest<ParcelQueryResponse>('/api/parcels').then(({ response, data }) => {
      if (response.ok) {
        const list = data?.parcels ?? []
        setParcels(list)
        if (list.length && list[0].updated) setLastSync(list[0].updated)
      }
      setParcelsReady(true)
    })
    toast(message)
  }

  const submitAuth = async (code?: string) => {
    if (authBusy) return
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return toast('请输入正确的邮箱地址')
    if ((authMode === 'code' || authView === 'register') && (!code || !/^\d{6}$/.test(code))) return toast('请输入 6 位验证码')
    if (code && verificationTarget && verificationTarget !== normalizedEmail) return toast(`验证码已发送到 ${maskEmail(verificationTarget)}，请使用该邮箱完成验证`)
    if ((authMode === 'password' || authView === 'register') && (password.length < 6 || password.length > 128)) return toast('密码长度需为 6-128 位')

    setAuthBusy(true)
    const demoUser = { id: 'demo-user', email: normalizedEmail, createdAt: new Date().toISOString() }
    try {
      const endpoint = authView === 'register' ? '/api/auth/register' : '/api/auth/login'
      const payload = authView === 'register'
        ? { email: normalizedEmail, code, password }
        : { email: normalizedEmail, mode: authMode, code: authMode === 'code' ? code : undefined, password: authMode === 'password' ? password : undefined }
      const { response, data } = await apiRequest<AuthResponse>(endpoint, { method: 'POST', body: JSON.stringify(payload) })
      if (!data) {
        if (demoAuthEnabled && authMode === 'code' && code === '123456') {
          finishAuth(demoUser, authView === 'register' ? '演示注册成功，已自动登录' : '演示登录成功，已进入你的包裹空间')
        } else {
          setAuthBusy(false)
          toast(demoAuthEnabled ? '本地演示验证码为 123456' : '服务响应异常，请稍后重试')
        }
        return
      }
      if (!response.ok) {
        setAuthBusy(false)
        if (response.status === 409 && authView === 'register') changeAuthView('login')
        if (data.code === 'PASSWORD_NOT_SET') changeAuthMode('code')
        toast(data.message ?? (authView === 'register' ? '注册失败' : '登录失败'))
        return
      }
      if (!data.user) {
        setAuthBusy(false)
        toast('登录状态响应异常，请稍后重试')
        return
      }
      finishAuth(data.user, authView === 'register' ? '注册成功，已自动登录' : '登录成功，已进入你的包裹空间')
    } catch {
      if (demoAuthEnabled && authMode === 'code' && code === '123456') {
        finishAuth(demoUser, authView === 'register' ? '演示注册成功，已自动登录' : '演示登录成功，已进入你的包裹空间')
      } else {
        setAuthBusy(false)
        toast('网络异常，请稍后重试')
      }
    }
  }

  /**
   * 提交密码弹窗。返回非 null 表示「这是字段级错误」，由表单就地展示、弹窗保持打开；
   * 返回 null 表示已处理完毕（成功关闭，或已用提示条告知的通用错误）。
   */
  const submitPassword = async (mode: PasswordDialogMode, payload: { currentPassword?: string; code?: string; newPassword: string }): Promise<PasswordFieldError | null> => {
    if (passwordBusy) return null
    setPasswordBusy(true)
    try {
      const isChange = mode === 'change'
      const { response, data } = await apiRequest<AuthResponse>(
        isChange ? '/api/auth/change-password' : '/api/auth/set-password',
        {
          method: 'POST',
          // 修改密码时二选一：带 currentPassword 或带 code，服务端按存在的那个验证身份
          body: JSON.stringify(isChange
            ? { currentPassword: payload.currentPassword, code: payload.code, newPassword: payload.newPassword }
            : { password: payload.newPassword }),
        },
      )
      if (!response.ok) {
        const message = data?.message ?? (isChange ? '密码修改失败，请稍后重试' : '密码设置失败，请稍后重试')
        // 这两类错误用户能就地修正，交回表单显示在对应输入框下方
        if (data?.code === 'INVALID_CURRENT_PASSWORD') return { field: 'current', message }
        if (data?.code === 'INVALID_VERIFICATION_CODE') return { field: 'code', message }
        if (data?.code === 'AUTH_REQUIRED') {
          setPasswordDialog(null)
          setUser(null)
          setAuthStatus('anonymous')
        }
        toast(message)
        return null
      }
      setPasswordDialog(null)
      setUser((current) => (current ? { ...current, passwordSet: true } : current))
      toast(data?.message ?? (isChange ? '登录密码已更新' : '登录密码设置成功'))
      return null
    } catch {
      toast('暂时无法连接服务，请稍后重试')
      return null
    } finally {
      setPasswordBusy(false)
    }
  }

  const logout = async () => {
    try {
      const { response } = await apiRequest<AuthResponse>('/api/auth/logout', { method: 'POST' })
      if (!response.ok) toast('本地已退出，但服务器会话清理未完成，请稍后重新打开页面')
    } catch {
      toast('本地已退出；网络恢复后请重新打开页面确认会话')
    } finally {
      setAccountMenuOpen(false)
      setUser(null)
      setAuthStatus('anonymous')
        changeAuthView('login')
    }
  }

  if (authStatus === 'checking') return <AuthLoading />

  if (authStatus !== 'authenticated' || !user) return <>
    <LoginPage view={authView} setView={changeAuthView} mode={authMode} setMode={changeAuthMode} email={email} setEmail={setEmail} password={password} setPassword={setPassword} onSubmit={submitAuth} onNotice={toast} onSendCode={sendCode} busy={authBusy} demoMode={demoAuthEnabled} backendUnavailable={authStatus === 'unavailable'} />
    {notice && <div className="toast" key={notice.seq} role="status" aria-live="polite"><CircleCheck size={17} />{notice.text}</div>}
  </>

  return (    <div className="app-shell">
      <button className={`nav-backdrop ${mobileNav ? 'visible' : ''}`} type="button" aria-label="关闭菜单" onClick={() => setMobileNav(false)} />
      <aside id="primary-navigation" className={`sidebar ${mobileNav ? 'open' : ''}`} aria-label="主导航">
        <div className="brand"><div className="brand-mark"><PackageCheck size={20} /></div><div><strong>驿见</strong><span>你的快递都在这里</span></div></div>
        <div className="side-label">工作台</div>
        <nav>{nav.map((item) => <button key={item.key} type="button" className={`nav-item ${view === item.key ? 'active' : ''}`} aria-current={view === item.key ? 'page' : undefined} onClick={() => { setView(item.key); setMobileNav(false); setAccountMenuOpen(false) }}>{item.icon}<span>{item.label}</span>{item.key === 'packages' && waiting > 0 && <em title={`${waiting} 个待取件`}>{waiting}</em>}</button>)}</nav>
        <div className="side-spacer" />
        <div className="privacy-tip"><ShieldCheck size={17} /><div><strong>隐私优先</strong><span>取件码只在你的账号内展示</span></div></div>
        <button className="side-account" type="button" aria-label={`打开账号设置，当前账号 ${maskEmail(user.email)}`} onClick={openAccountSettings}><span className="avatar">{avatarText(user.email)}</span><span><strong>我的账号</strong><small>{maskEmail(user.email)}</small></span><ChevronRight size={16} /></button>
      </aside>
      <main className="main">
        <header className="topbar"><button className="mobile-menu" type="button" aria-label={mobileNav ? '关闭菜单' : '打开菜单'} aria-expanded={mobileNav} aria-controls="primary-navigation" onClick={() => setMobileNav(!mobileNav)}><Menu size={21} /></button><div className="crumb"><span>驿站工作台</span><ChevronRight size={14} /><b>{view === 'packages' ? '我的包裹' : view === 'sources' ? '数据来源' : '账号设置'}</b></div><div className="top-actions" ref={accountAreaRef}><button className="icon-btn dot" type="button" aria-label="查看提醒" onClick={() => toast('暂无新的未读提醒')}><Bell size={18} /></button><button className="account-chip" type="button" aria-haspopup="menu" aria-expanded={accountMenuOpen} aria-label={`打开账号菜单，当前账号 ${maskEmail(user.email)}`} onClick={toggleAccountMenu}><span className="avatar small">{avatarText(user.email)}</span><span>{maskEmail(user.email)}</span><ChevronRight size={14} /></button>{accountMenuOpen && <div className="account-menu" role="menu"><div className="account-menu-user"><span className="avatar small">{avatarText(user.email)}</span><div><b>{maskEmail(user.email)}</b><small>当前登录账号</small></div></div><button type="button" role="menuitem" onClick={openAccountSettings}><Settings2 size={15} />账号设置<ChevronRight size={14} /></button>{user.passwordSet && <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setPasswordDialog('change') }}><KeyRound size={15} />修改登录密码<ChevronRight size={14} /></button>}<button type="button" role="menuitem" onClick={() => void logout()}><LogOut size={15} />退出当前账号</button></div>}</div></header>
        <div className="content">
          {view === 'packages' && <Packages parcels={parcels} parcelsReady={parcelsReady} filtered={filtered} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} effectiveCarrier={effectiveCarrier} trackingNumber={trackingNumber} setTrackingNumber={setTrackingNumber} trackingPhone={trackingPhone} setTrackingPhone={setTrackingPhone} phoneNeeded={phoneNeeded} detection={activeDetection} detecting={activeDetecting} onChooseCarrier={chooseCarrier} waiting={waiting} transit={transit} connected={connected} syncing={syncing} lastSync={lastSync} onSync={sync} onViewSources={() => { setView('sources'); setAccountMenuOpen(false) }} visible={visible} setVisible={setVisible} onOpen={setSelectedId} onCopy={copy} onConfirm={confirm} confirmingId={confirmingId} />}
          {view === 'sources' && <Sources connected={connected} onExplain={toast} />}
          {view === 'settings' && <Settings email={user.email} passwordSet={Boolean(user.passwordSet)} autoSync={autoSync} push={push} setAutoSync={setAutoSync} setPush={setPush} onPreferenceSaved={() => toast('偏好设置已保存到本设备')} onLogout={logout} onSetPassword={() => setPasswordDialog('set')} onChangePassword={() => setPasswordDialog('change')} />}
        </div>
      </main>
      {selected && <Drawer parcel={selected} shown={Boolean(visible[selected.id])} toggle={() => setVisible((items) => ({ ...items, [selected.id]: !items[selected.id] }))} onCopy={copy} onClose={() => setSelectedId(null)} onConfirm={confirm} confirming={confirmingId === selected.id} />}
      {passwordDialog && <PasswordDialog key={passwordDialog} mode={passwordDialog} email={user.email} busy={passwordBusy} onClose={() => { if (!passwordBusy) setPasswordDialog(null) }} onSubmit={submitPassword} onSendCode={sendCode} />}
      {notice && <div className="toast" key={notice.seq} role="status" aria-live="polite"><CircleCheck size={17} />{notice.text}</div>}
    </div>
  )
}

function AuthLoading() {
  return <div className="auth-loading" role="status" aria-live="polite"><span className="brand-mark"><PackageCheck size={20} /></span><strong>正在恢复登录状态…</strong><small>正在安全检查你的会话</small></div>
}

function Header({ kicker, title, text, action }: { kicker: ReactNode; title: ReactNode; text: string; action?: ReactNode }) {
  return <section className="heading"><div><div className="eyebrow">{kicker}</div><h1>{title}</h1><p>{text}</p></div>{action}</section>
}

const CONFIDENCE_TEXT: Record<DetectionConfidence, string> = { high: '置信度高', medium: '置信度中', low: '置信度低' }

/**
 * 识别结果提示。设计原则：
 * - 只展示结论与依据，不改变用户已做的选择；
 * - 置信度不足时给出候选按钮，由用户确认，绝不自动替用户决定；
 * - 识别失败不阻断手动选平台后查询。
 */
function DetectionHint({ detection, detecting, effectiveCarrier, onChooseCarrier }: { detection: DetectionResult | null; detecting: boolean; effectiveCarrier: string; onChooseCarrier: (carrierCode: string) => void }) {
  if (detecting) return <div className="detect-hint detecting"><RefreshCw size={14} className="spin" />正在按公开单号规则识别快递平台…</div>
  if (!detection) return null

  const decided = Boolean(detection.best) && detection.best?.confidence === 'high'
  if (decided && detection.best) {
    const candidate = detection.best
    return <div className="detect-hint ok" style={cssVars(providerColor(candidate.carrierCode), providerPale(candidate.carrierCode))}>
      <div className="detect-head"><CircleCheck size={15} /><b>已识别为 {candidate.carrierName}</b><small>{CONFIDENCE_TEXT[candidate.confidence]}</small></div>
      <ul className="detect-evidence">{candidate.evidence.filter((evidence) => evidence.type !== 'source').map((evidence, index) => <li key={`${evidence.type}-${index}`}><span>{EVIDENCE_LABEL[evidence.type] ?? evidence.type}</span>{evidence.note}</li>)}</ul>
    </div>
  }

  if (detection.candidates.length) {
    return <div className="detect-hint ambiguous">
      <div className="detect-head"><CircleAlert size={15} /><b>该运单号可能属于多个平台</b><small>纯数字单号无法唯一判定，请确认后查询</small></div>
      <div className="detect-candidates">{detection.candidates.slice(0, 6).map((candidate) => <button key={candidate.carrierCode} type="button" className={effectiveCarrier === candidate.carrierCode ? 'active' : ''} style={cssVars(providerColor(candidate.carrierCode), providerPale(candidate.carrierCode))} onClick={() => onChooseCarrier(candidate.carrierCode)}><i />{candidate.carrierName}<em>{CONFIDENCE_TEXT[candidate.confidence]}</em></button>)}</div>
      <ul className="detect-evidence">{detection.candidates[0].evidence.filter((evidence) => evidence.type === 'length' || evidence.type === 'prefix').slice(0, 2).map((evidence, index) => <li key={`${evidence.type}-${index}`}><span>{EVIDENCE_LABEL[evidence.type] ?? evidence.type}</span>{evidence.note}</li>)}</ul>
    </div>
  }

  return <div className="detect-hint failed">
    <CircleAlert size={15} />
    <div><b>未能识别该运单号所属平台</b><small>{detection.unmatchedReason === 'invalid_format' || detection.unmatchedReason === 'too_short' ? '请检查运单号是否输入完整' : '请在上方手动选择快递平台后再查询'}</small></div>
  </div>
}

const EVIDENCE_LABEL: Record<string, string> = { prefix: '前缀', length: '长度', charset: '字符集', suffix: '后缀', pattern: '规则', source: '来源' }

function providerColor(carrierCode: string): string {
  return selectableProviders.find((provider) => provider.code === carrierCode)?.color ?? '#177c73'
}

function providerPale(carrierCode: string): string {
  return selectableProviders.find((provider) => provider.code === carrierCode)?.pale ?? '#e9faf3'
}

function Packages({ parcels, parcelsReady, filtered, filter, setFilter, query, setQuery, effectiveCarrier, trackingNumber, setTrackingNumber, trackingPhone, setTrackingPhone, phoneNeeded, detection, detecting, onChooseCarrier, waiting, transit, connected, syncing, lastSync, onSync, onViewSources, visible, setVisible, onOpen, onCopy, onConfirm, confirmingId }: { parcels: Parcel[]; parcelsReady: boolean; filtered: Parcel[]; filter: Filter; setFilter: (value: Filter) => void; query: string; setQuery: (value: string) => void; effectiveCarrier: string; trackingNumber: string; setTrackingNumber: (value: string) => void; trackingPhone: string; setTrackingPhone: (value: string) => void; phoneNeeded: boolean; detection: DetectionResult | null; detecting: boolean; onChooseCarrier: (carrierCode: string) => void; waiting: number; transit: number; connected: number; syncing: boolean; lastSync: string; onSync: () => void; onViewSources: () => void; visible: Record<string, boolean>; setVisible: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; onOpen: (id: string) => void; onCopy: (code: string) => void; onConfirm: (parcel: Parcel) => void | Promise<void>; confirmingId: string | null }) {
  const trackingInputRef = useRef<HTMLInputElement>(null)
  const phoneInputRef = useRef<HTMLInputElement>(null)
  const hasParcels = parcels.length > 0
  // 首次加载完成前不渲染列表与空状态，避免「还没有包裹记录」一闪而过。
  const listVisible = parcelsReady && hasParcels

  // 手机号字段出现时（选中中通/顺丰，或服务端明确要求）把焦点送过去，
  // 用户不必自己回头找这个新出现的输入框。只在 false→true 时触发，避免每次渲染都抢焦点。
  const phoneNeededBefore = useRef(phoneNeeded)
  useEffect(() => {
    if (phoneNeeded && !phoneNeededBefore.current) phoneInputRef.current?.focus()
    phoneNeededBefore.current = phoneNeeded
  }, [phoneNeeded])

  return <>
    <Header kicker={<><Sparkles size={14} /> 运单号查件</>} title={<>你的包裹，<span>一眼就够了。</span></>} text={hasParcels ? `已保存 ${parcels.length} 个包裹${lastSync && lastSync !== '尚未查询' ? `，最后更新于 ${lastSync}` : ''}。` : '查询结果会保存到你的账号，下次打开或换设备登录都能接着看。'} />
    <form className="tracking-query" onSubmit={(event) => { event.preventDefault(); onSync() }}>
      <div className="tracking-query-meta"><span><Package size={18} /></span><label htmlFor="parcel-tracking"><b>运单号查快递</b><small>粘贴或输入单号，自动识别快递平台；结果只保存到当前账号。</small></label></div>
      <div className="tracking-query-fields">
        <label className="tracking-field" htmlFor="parcel-tracking"><span>快递运单号</span><input id="parcel-tracking" ref={trackingInputRef} value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value.replace(/\s/g, '').slice(0, 128))} autoComplete="off" placeholder="请输入快递运单号" maxLength={128} required /></label>
        <label className="tracking-field" htmlFor="parcel-carrier"><span>快递平台<em className="optional-tag">选填</em></span><select id="parcel-carrier" value={effectiveCarrier} onChange={(event) => onChooseCarrier(event.target.value)}><option value="">不填，自动识别</option>{selectableProviders.map((provider) => <option key={provider.code} value={provider.code}>{provider.name}{PHONE_REQUIRED_CARRIERS.has(provider.code) ? '（需手机号）' : ''}</option>)}</select></label>
        {phoneNeeded && <label className="tracking-field phone-field" htmlFor="parcel-phone"><span>手机号<em className="required-tag">必填</em></span><input id="parcel-phone" ref={phoneInputRef} value={trackingPhone} onChange={(event) => setTrackingPhone(event.target.value.replace(/[^0-9\s()+-]/g, '').slice(0, 20))} inputMode="tel" autoComplete="off" placeholder="收寄件人手机号，虚拟号填后四位" maxLength={20} /></label>}
      </div>
      <button type="submit" disabled={syncing || !trackingNumber.trim()}>{syncing ? '查询中…' : '查询快递'}</button>
      <DetectionHint detection={detection} detecting={detecting} effectiveCarrier={effectiveCarrier} onChooseCarrier={onChooseCarrier} />
    </form>
    {listVisible && <section className="summary"><div className="hero"><div className="orb one" /><div className="orb two" /><div className="hero-copy"><div className="hero-kicker"><i /> 查询记录已保存</div><h2>{waiting ? `有 ${waiting} 个包裹，正在等你取件` : hasParcels ? '当前没有待取件包裹' : '从第一个运单号开始'}</h2><p>{waiting ? '取件码只会在你的账号内展示，确认取件后会自动删除。' : hasParcels ? '输入新的运单号即可继续添加包裹。' : '查询结果会保存到当前账号，方便你下次继续查看。'}</p><div className="stats"><div><b>{waiting}</b><span>待取件</span></div><div><b>{transit}</b><span>运输中</span></div><div><b>{connected}</b><span>已查询承运商</span></div></div></div><div className="hero-art"><div><Package size={29} /><small>包裹状态</small><b>查询后保存</b></div><span><Check size={14} /></span></div></div><div className="trust"><div className="trust-title"><span><ShieldCheck size={19} /></span>安心提示</div><h3>你的数据，只为你服务</h3><p>运单号仅用于服务端查询并关联当前登录账号；取件码仅在服务商明确返回时展示，不会出现在推送通知里。</p><footer><span><LockKeyhole size={14} /> 加密存储</span><span><Zap size={14} /> 确认后清理</span></footer></div></section>}
    {listVisible && <div className="section-head"><div><h2>包裹列表</h2><span>{filtered.length} 个结果</span></div><div className="section-tools"><label className="search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="搜索包裹" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索平台、包裹或单号" /></label><span className="sync-label"><Zap size={15} /> 查询后自动保存</span></div></div>}
    {listVisible && <div className="tabs" role="group" aria-label="按状态筛选包裹">{(['全部', '待取件', '运输中', '已完成'] as Filter[]).map((item) => <button key={item} type="button" aria-pressed={filter === item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}{item !== '全部' && <em>{parcels.filter((parcel) => parcel.status === item).length}</em>}</button>)}</div>}
    {!parcelsReady ? <ParcelSkeleton /> : !hasParcels ? <div className="empty empty-first"><Package size={24} /><strong>还没有包裹记录</strong><span>输入快递运单号，系统会识别快递平台并保存物流信息。</span><button className="empty-action" type="button" onClick={() => trackingInputRef.current?.focus()}>查询第一个包裹 <ChevronRight size={14} /></button></div> : filtered.length ? <div className="parcel-grid">{filtered.map((parcel) => <Card key={parcel.id} parcel={parcel} shown={Boolean(visible[parcel.id])} toggle={() => setVisible((items) => ({ ...items, [parcel.id]: !items[parcel.id] }))} onOpen={() => onOpen(parcel.id)} onCopy={onCopy} onConfirm={onConfirm} confirming={confirmingId === parcel.id} />)}</div> : <div className="empty"><Search size={24} /><strong>没有找到匹配的包裹</strong><span>试试搜索其他平台、包裹名称或运单号。</span></div>}
    <div className="integration"><div className="integration-icon"><CircleAlert size={18} /></div><div><strong>查询说明</strong><p>输入运单号后，系统按公开单号规则识别快递平台并查询真实物流；纯数字单号可能对应多个平台，此时会请你确认。取件码仅在上游明确返回时展示，不会根据运单号猜测。中通、顺丰按快递100 要求需填写收寄件人手机号。</p></div><button onClick={onViewSources}>查看查询方式 <ArrowUpRight size={15} /></button></div>
  </>
}

/** 首屏占位：结构尽量贴近真实卡片，减少列表出现时的跳动。 */
function ParcelSkeleton() {
  return <>
    <span className="sr-only" role="status">正在加载包裹列表…</span>
    <div className="parcel-grid" aria-hidden="true">
      {[0, 1].map((index) => <article className="parcel skeleton" key={index}>
        <div className="skeleton-head"><span className="skeleton-block square" /><span className="skeleton-lines"><i className="skeleton-block w60" /><i className="skeleton-block w40" /></span></div>
        <i className="skeleton-block w75 tall" />
        <i className="skeleton-block w50" />
        <div className="skeleton-foot"><i className="skeleton-block w35" /><i className="skeleton-block w25" /></div>
      </article>)}
    </div>
  </>
}

function Card({ parcel, shown, toggle, onOpen, onCopy, onConfirm, confirming }: { parcel: Parcel; shown: boolean; toggle: () => void; onOpen: () => void; onCopy: (code: string) => void; onConfirm: (parcel: Parcel) => void | Promise<void>; confirming: boolean }) {
  const waiting = parcel.status === '待取件'
  return <article className={`parcel ${waiting ? 'waiting' : ''}`} style={cssVars(parcel.color, parcel.pale)}><div className="parcel-head"><div className="carrier"><Truck size={19} /></div><div className="carrier-copy"><b>{parcel.carrier}</b><span>{parcel.tracking}</span></div><Pill status={parcel.status} /></div><button className="parcel-main" type="button" onClick={onOpen}><div><h3>{parcel.title}</h3><p>{parcel.route}</p></div><ChevronRight size={18} /></button><div className="meta"><span><MapPin size={14} />{parcel.location}</span><span><Clock3 size={14} />{parcel.updated}</span></div>{waiting && parcel.code ? <div className="code-panel"><div className="code-top"><span><PackageCheck size={15} /> 取件码</span><small><ShieldCheck size={13} /> 仅本人可见</small></div><div className="code-row"><b>{shown ? parcel.code : '•••-•••'}</b><button type="button" className={`icon-ghost ${shown ? 'on' : ''}`} aria-pressed={shown} aria-label={shown ? '隐藏取件码' : '显示取件码'} title={shown ? '隐藏取件码' : '显示取件码'} onClick={toggle}>{shown ? <EyeOff size={16} /> : <Eye size={16} />}</button>{shown && <button type="button" className="icon-ghost" aria-label="复制取件码" title="复制取件码" onClick={() => onCopy(parcel.code ?? '')}><Copy size={16} /></button>}</div><small className="spot">{parcel.spot}</small></div> : <div className="card-foot"><span><i className={parcel.status === '已完成' ? 'done' : ''} />{parcel.eta}</span><button type="button" onClick={onOpen}>查看轨迹 <ChevronRight size={14} /></button></div>}{waiting && <div className="card-actions"><button type="button" onClick={onOpen}>查看完整轨迹 <ChevronRight size={14} /></button><button type="button" disabled={confirming} onClick={() => void onConfirm(parcel)}><Check size={15} /> {confirming ? '保存中…' : '我已取件'}</button></div>}</article>
}

function Pill({ status }: { status: Status }) { return <span className={`pill ${status === '待取件' ? 'wait' : status === '运输中' ? 'transit' : 'done'}`}>{status === '待取件' ? <PackageCheck size={13} /> : status === '运输中' ? <Truck size={13} /> : <Check size={13} />}{status}</span> }
function Sources({ connected, onExplain }: { connected: number; onExplain: (message: string) => void }) {
  return <><Header kicker={<><Link2 size={14} /> 查询方式</>} title={<>数据来源，<span>清楚可见。</span></>} text={'已查询 ' + connected + ' 个承运商；输入运单号后按公开规则识别平台，再查询并保存物流记录。'} action={<button className="outline-btn" onClick={() => onExplain('输入运单号后，驿见会按公开单号规则识别快递平台并查询物流；识别依据会展示在查询框下方，当前不需要单独绑定快递账号。')}><Clipboard size={16} /> 查询说明</button>} /><section className="source-banner"><div className="source-icon"><ShieldCheck size={24} /></div><div><strong>识别只做建议，不替你做决定</strong><p>纯数字单号在多家公司之间真实重叠，此时系统会列出候选由你确认，绝不静默切换平台重试，也不通过邮箱地址猜测你的包裹。</p></div><span className="secure"><i /> 服务端查询</span></section><div className="section-head"><div><h2>支持识别与查询的快递平台</h2><span>识别依据为公开单号规则</span></div><div className="source-count"><b>{connected}</b><span>个已查询</span></div></div><div className="provider-grid">{providerList.map((provider) => <article className="provider" key={provider.name} style={cssVars(provider.color, provider.pale)}><div className="provider-top"><span>{provider.short.slice(0, 1)}</span>{provider.connected ? <b><CircleCheck size={14} /> 可查询</b> : <small>暂不可直查</small>}</div><h3>{provider.name}</h3><p>{provider.description}</p>{provider.connected ? <footer><span><RefreshCw size={13} /> 支持查询</span><button onClick={() => onExplain(provider.name + '会根据公开单号规则参与识别，并按识别或你指定的平台编码查询，不需要单独授权。')}>查看说明 <ChevronRight size={14} /></button></footer> : <button className="connect" onClick={() => onExplain(provider.name + '需要先确认快递100是否提供对应平台编码，具体支持范围以快递100返回结果为准。')}><Link2 size={15} /> 查看支持范围</button>}</article>)}</div><section className="how"><div className="section-head"><div><h2>查询流程</h2><span>输入一个运单号即可开始</span></div></div><div className="steps"><Step no="01" icon={<Package size={18} />} title="输入运单号" text="输入或粘贴快递运单号，支持带空格与连字符。" /><Step no="02" icon={<Search size={18} />} title="识别快递平台" text="按前缀、长度、号段等公开规则给出结论与依据；歧义时列候选由你确认。" /><Step no="03" icon={<PackageCheck size={18} />} title="保存到我的包裹" text="查询结果保存到当前账号，方便下次继续查看。" /></div></section></>
}
function Step({ no, icon, title, text }: { no: string; icon: ReactNode; title: string; text: string }) { return <div className="step"><small>{no}</small><div>{icon}</div><strong>{title}</strong><p>{text}</p></div> }

function Settings({ email, passwordSet, autoSync, push, setAutoSync, setPush, onPreferenceSaved, onLogout, onSetPassword, onChangePassword }: { email: string; passwordSet: boolean; autoSync: boolean; push: boolean; setAutoSync: (value: boolean) => void; setPush: (value: boolean) => void; onPreferenceSaved: () => void; onLogout: () => void; onSetPassword: () => void; onChangePassword: () => void }) {
  return <><Header kicker={<><Settings2 size={14} /> 账号与偏好</>} title={<>把体验调成，<span>你喜欢的样子。</span></>} text="账号安全、查询方式和取件码规则，都可以在这里查看。" /><div className="settings-grid"><section className="settings"><div className="settings-title"><div><small>账号信息</small><h2>登录与安全</h2></div><span><LockKeyhole size={18} /></span></div><div className="profile"><span className="avatar large">{avatarText(email)}</span><div><b>已验证邮箱地址</b><small>{maskEmail(email)}</small></div><em><Check size={13} /> 已验证</em></div><div className="setting-row"><div><b>登录方式</b><small>{passwordSet ? '邮箱验证码 · 密码登录均可用' : '当前仅支持验证码登录，建议设置密码'}</small></div><span className="setting-status">{passwordSet ? '验证码 + 密码' : '仅验证码'}</span></div><div className="setting-row"><div><b>登录密码</b><small>{passwordSet ? '修改后请使用新密码登录，原密码用于确认是你本人' : '设置后可以跳过验证码，用邮箱和密码快速登录'}</small></div>{passwordSet ? <button type="button" onClick={onChangePassword}><KeyRound size={14} /> 修改密码 <ChevronRight size={15} /></button> : <button type="button" onClick={onSetPassword}><KeyRound size={14} /> 设置密码 <ChevronRight size={15} /></button>}</div><div className="setting-row"><div><b>登录设备</b><small>当前设备 · 最后活跃刚刚</small></div><span className="setting-status">当前设备</span></div><button className="logout" type="button" onClick={onLogout}><LogOut size={15} /> 退出当前账号</button></section><section className="settings"><div className="settings-title"><div><small>查询与提醒</small><h2>偏好设置</h2></div><span className="warm"><Zap size={18} /></span></div><Toggle icon={<RefreshCw size={17} />} title="后台自动同步" text="偏好已保存；服务端同步功能开放后生效" enabled={autoSync} onToggle={() => { setAutoSync(!autoSync); onPreferenceSaved() }} /><Toggle icon={<Bell size={17} />} title="到站提醒" text="偏好已保存；通知服务开放后生效" enabled={push} onToggle={() => { setPush(!push); onPreferenceSaved() }} /><div className="rule"><ShieldCheck size={17} /><div><b>取件码删除规则</b><p>点击“我已取件”并保存成功后立即删除；若一直未确认，最多保留 30 天。</p></div></div></section></div><div className="footnote"><CircleAlert size={17} /> 偏好设置保存在本设备；物流记录仍保存到当前登录账号。</div></>
}
function Toggle({ icon, title, text, enabled, onToggle }: { icon: ReactNode; title: string; text: string; enabled: boolean; onToggle: () => void }) {
  return <div className="toggle-row"><span>{icon}</span><div><b>{title}</b><small>{text}</small></div><button className={`toggle ${enabled ? 'on' : ''}`} type="button" aria-label={`${title}${enabled ? '已开启' : '已关闭'}`} aria-pressed={enabled} onClick={onToggle}><i /></button></div>
}

/**
 * 密码弹窗。mode='set' 为首次设置（无需验证身份），mode='change' 为修改。
 * 修改时身份证明二选一：当前密码，或邮箱验证码（给忘记原密码的用户兜底）。
 * 校验分两层：前端先给出即时、可就地修正的字段提示；服务端返回的字段级错误也会落回对应输入框。
 */
function PasswordDialog({ mode, email, busy, onClose, onSubmit, onSendCode }: { mode: PasswordDialogMode; email: string; busy: boolean; onClose: () => void; onSubmit: (mode: PasswordDialogMode, payload: { currentPassword?: string; code?: string; newPassword: string }) => Promise<PasswordFieldError | null>; onSendCode: (email: string, purpose: AuthView) => Promise<SendCodeResult> }) {
  const isChange = mode === 'change'
  const [verifyWithCode, setVerifyWithCode] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [sendingCode, setSendingCode] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [errors, setErrors] = useState<{ current?: string; code?: string; next?: string; confirm?: string }>({})
  const panelRef = useDialogFocus<HTMLElement>()

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setInterval(() => setCountdown((value) => Math.max(value - 1, 0)), 1000)
    return () => window.clearInterval(timer)
  }, [countdown])

  // 切换验证方式会换掉首个输入框，旧焦点随节点一起消失（落到 body），需要重新聚焦到新的首字段
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [verifyWithCode, panelRef])

  const strength = useMemo(() => {
    if (!newPassword) return null
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(newPassword)).length
    if (newPassword.length < 8 || kinds <= 1) return { level: 1, label: '强度偏弱', hint: '建议至少 8 位，并混合字母与数字' }
    if (newPassword.length >= 12 && kinds >= 3) return { level: 3, label: '强度较高', hint: '长度与字符种类都足够' }
    return { level: 2, label: '强度一般', hint: '再增加长度或字符种类会更安全' }
  }, [newPassword])

  const handleSendCode = async () => {
    if (sendingCode || countdown > 0 || busy) return
    setSendingCode(true)
    setErrors((previous) => ({ ...previous, code: undefined }))
    try {
      const result = await onSendCode(email, 'login')
      if (result.retryAfter && result.retryAfter > 0) setCountdown(result.retryAfter)
    } finally {
      setSendingCode(false)
    }
  }

  const switchVerifyMode = () => {
    setVerifyWithCode(!verifyWithCode)
    setErrors({})
  }

  const validate = () => {
    const next: typeof errors = {}
    if (isChange) {
      if (verifyWithCode) {
        if (!/^\d{6}$/.test(verificationCode)) next.code = '请输入 6 位邮箱验证码'
      } else if (!currentPassword) {
        next.current = '请输入当前密码'
      }
    }
    if (!newPassword) next.next = '请输入新密码'
    else if (newPassword.length < 6 || newPassword.length > 128) next.next = '新密码长度需为 6-128 位'
    else if (isChange && !verifyWithCode && currentPassword && newPassword === currentPassword) next.next = '新密码不能与当前密码相同'
    if (!confirmPassword) next.confirm = '请再次输入新密码'
    else if (confirmPassword !== newPassword) next.confirm = '两次输入的新密码不一致'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    if (!validate()) return
    void onSubmit(mode, {
      ...(isChange ? (verifyWithCode ? { code: verificationCode } : { currentPassword }) : {}),
      newPassword,
    }).then((result) => {
      if (result) setErrors((previous) => ({ ...previous, [result.field]: result.message }))
    })
  }

  const toggleReveal = <button type="button" className="password-toggle" aria-label={reveal ? '隐藏密码' : '显示密码'} aria-pressed={reveal} onClick={() => setReveal(!reveal)}>{reveal ? <EyeOff size={16} /> : <Eye size={16} />}</button>

  return <div className="modal-layer" onClick={() => { if (!busy) onClose() }}><section className="login-modal password-dialog" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label="关闭密码窗口" disabled={busy} onClick={onClose}><X size={18} /></button><div className="modal-icon"><KeyRound size={20} /></div><small>账号安全</small><h2 id="password-dialog-title">{isChange ? '修改登录密码' : '设置登录密码'}</h2><p>{isChange ? '先用当前密码或邮箱验证码证明身份，再设置新密码；修改后请使用新密码登录。' : '设置后可以跳过验证码，使用邮箱和密码快速登录。'}</p><form className="auth-form" onSubmit={submit} noValidate>
    {isChange && (verifyWithCode
      ? <label htmlFor="password-code">邮箱验证码<div className="code-input"><input id="password-code" data-autofocus value={verificationCode} onChange={(event) => { setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setErrors((previous) => ({ ...previous, code: undefined })) }} placeholder="输入 6 位验证码" inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-invalid={Boolean(errors.code)} aria-describedby={errors.code ? 'password-code-error' : undefined} /><button type="button" disabled={countdown > 0 || sendingCode || busy} onClick={() => void handleSendCode()}>{sendingCode ? '发送中…' : countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}</button></div>{errors.code && <small className="auth-hint auth-error" id="password-code-error" role="alert">{errors.code}</small>}<small className="auth-hint">验证码将发送到 {maskEmail(email)}，5 分钟内有效</small></label>
      : <label htmlFor="password-current">当前密码<div className="password-input"><LockKeyhole size={16} /><input id="password-current" data-autofocus value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setErrors((previous) => ({ ...previous, current: undefined })) }} type={reveal ? 'text' : 'password'} autoComplete="current-password" maxLength={128} aria-invalid={Boolean(errors.current)} aria-describedby={errors.current ? 'password-current-error' : undefined} placeholder="请输入当前使用的登录密码" />{currentPassword && toggleReveal}</div>{errors.current && <small className="auth-hint auth-error" id="password-current-error" role="alert">{errors.current}</small>}</label>)}
    {isChange && <button type="button" className="auth-link" onClick={switchVerifyMode}>{verifyWithCode ? '改用当前密码验证' : '忘记当前密码？改用邮箱验证码'}</button>}
    <label htmlFor="password-next">新密码<div className="password-input"><KeyRound size={16} /><input id="password-next" data-autofocus={isChange ? undefined : true} value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setErrors((previous) => ({ ...previous, next: undefined })) }} type={reveal ? 'text' : 'password'} autoComplete="new-password" minLength={6} maxLength={128} aria-invalid={Boolean(errors.next)} aria-describedby={errors.next ? 'password-next-error' : undefined} placeholder="请输入 6-128 位新密码" />{newPassword && toggleReveal}</div>{errors.next && <small className="auth-hint auth-error" id="password-next-error" role="alert">{errors.next}</small>}{strength && <span className={`password-strength level-${strength.level}`}><i /><b>{strength.label}</b><em>{strength.hint}</em></span>}</label>
    <label htmlFor="password-confirm">确认新密码<div className="password-input"><KeyRound size={16} /><input id="password-confirm" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setErrors((previous) => ({ ...previous, confirm: undefined })) }} type={reveal ? 'text' : 'password'} autoComplete="new-password" minLength={6} maxLength={128} aria-invalid={Boolean(errors.confirm)} aria-describedby={errors.confirm ? 'password-confirm-error' : undefined} placeholder="请再次输入新密码" />{confirmPassword && confirmPassword === newPassword && <Check className="password-match" size={16} aria-hidden="true" />}</div>{errors.confirm && <small className="auth-hint auth-error" id="password-confirm-error" role="alert">{errors.confirm}</small>}</label>
    <button className="submit" type="submit" disabled={busy}>{busy ? <RefreshCw size={17} className="spin" /> : <Check size={17} />} {busy ? '保存中…' : isChange ? '确认修改' : '保存密码'}</button>
  </form><div className="drawer-note"><ShieldCheck size={15} />密码会在服务端加密保存，不会显示在通知中。</div></section></div>
}

/**
 * 浮层的焦点管理：挂载时把焦点移入，Tab 在浮层内循环，卸载时把焦点还给触发元素。
 * 抽屉与密码弹窗共用，避免键盘用户「打开浮层后焦点仍留在背后的页面上」。
 */
function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const panel = ref.current
    if (!panel) return
    const selector = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'
    const items = () => Array.from(panel.querySelectorAll<HTMLElement>(selector)).filter((element) => element.offsetParent !== null)
    const previous = document.activeElement as HTMLElement | null
    const preferred = panel.querySelector<HTMLElement>('[data-autofocus]')
    ;(preferred ?? items()[0])?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const list = items()
      if (!list.length) return
      const head = list[0]
      const tail = list[list.length - 1]
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault()
        tail.focus()
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault()
        head.focus()
      }
    }
    panel.addEventListener('keydown', handleKeyDown)
    return () => {
      panel.removeEventListener('keydown', handleKeyDown)
      previous?.focus?.()
    }
  }, [])
  return ref
}

function Drawer({ parcel, shown, toggle, onCopy, onClose, onConfirm, confirming }: { parcel: Parcel; shown: boolean; toggle: () => void; onCopy: (code: string) => void; onClose: () => void; onConfirm: (parcel: Parcel) => void | Promise<void>; confirming: boolean }) {
  const panelRef = useDialogFocus<HTMLElement>()
  return <div className="drawer-layer" onClick={onClose}><aside className="drawer" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="drawer-title" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><small>包裹详情</small><h2 id="drawer-title">{parcel.title}</h2></div><button className="icon-btn" type="button" aria-label="关闭包裹详情" onClick={onClose}><X size={18} /></button></div><div className="drawer-carrier"><span className="carrier" style={cssVars(parcel.color, parcel.pale)}><Truck size={19} /></span><div><b>{parcel.carrier}</b><small>{parcel.tracking}</small></div><Pill status={parcel.status} /></div>{parcel.code ? <div className="drawer-code"><div><span>取件码</span><small>{parcel.spot}</small></div><strong>{shown ? parcel.code : '•••-•••'}</strong><button type="button" className={`icon-ghost ${shown ? 'on' : ''}`} aria-pressed={shown} aria-label={shown ? '隐藏取件码' : '显示取件码'} title={shown ? '隐藏取件码' : '显示取件码'} onClick={toggle}>{shown ? <EyeOff size={16} /> : <Eye size={16} />}</button>{shown && <button type="button" className="icon-ghost" aria-label="复制取件码" title="复制取件码" onClick={() => onCopy(parcel.code ?? '')}><Copy size={16} /></button>}</div> : <div className="drawer-status"><span><Truck size={18} /></span><div><b>{parcel.eta}</b><small>{parcel.location}</small></div></div>}<TrailMap events={parcel.events} /><div className="timeline"><header><b>文字轨迹</b><small>{parcel.events.length} 条记录</small></header>{parcel.events.map((event, index) => <div className={`event ${event.active ? 'active' : ''}`} key={`${event.time}-${index}`}><i /><div><div><b>{event.title}</b><time>{event.time}</time></div><p>{event.text}</p></div></div>)}</div>{parcel.code && <button className="drawer-confirm" type="button" disabled={confirming} onClick={() => void onConfirm(parcel)}><Check size={16} /> {confirming ? '保存中…' : '我已取件，删除取件码'}</button>}<div className="drawer-note"><ShieldCheck size={15} />取件码只在你的账号内展示；确认取件后立即从系统删除。</div></aside></div>
}

/** 两点球面距离（km），用于给示意图标注真实尺度，避免用户误读放大后的路线。 */
function geoDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * 地图轨迹。坐标来自快递100 的 areaCenter（resultv2=4），是**行政区域中心点**而非实时 GPS，
 * 因此这里只做等距示意：按真实经纬度比例缩放（含 cos(纬度) 修正），既不拉长也不压扁路线；
 * 不绘制任何国界、海域或争议区域，只画点位与连线，规避地图数据合规风险。
 */
function TrailMap({ events }: { events: Event[] }) {
  const located = events.filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng)) as Array<Event & { lat: number; lng: number }>
  // 相邻重复坐标（同一行政区的多条轨迹）会叠成同一个点，先去重再绘制
  const points = located.filter((point, index) => index === 0 || point.lat !== located[index - 1].lat || point.lng !== located[index - 1].lng)

  if (points.length < 2) {
    return <section className="trail-map trail-map-empty"><header><div><MapPin size={16} /><b>地图轨迹</b></div><small>承运商未返回坐标</small></header><div className="trail-map-placeholder"><MapPin size={24} /><span>已保留完整文字轨迹</span><small>该单号暂未返回经纬度。承运商提供坐标后，这里会自动显示路线。</small></div></section>
  }

  const W = 320
  const H = 186
  const PAD = 34
  const lats = points.map((point) => point.lat)
  const lngs = points.map((point) => point.lng)
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats)
  const latMid = (minLat + maxLat) / 2
  const kx = Math.cos((latMid * Math.PI) / 180)
  const minX = Math.min(...lngs) * kx; const maxX = Math.max(...lngs) * kx
  // 跨度下限约 5km：点位过于集中时不放大，否则会把几十米的差别画成整条路线
  const spanX = Math.max(maxX - minX, 0.05 * kx)
  const spanY = Math.max(maxLat - minLat, 0.05)
  const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY)
  const px = (lng: number) => W / 2 + (lng * kx - (minX + maxX) / 2) * scale
  const py = (lat: number) => H / 2 - (lat - (minLat + maxLat) / 2) * scale

  const path = points.map((point) => `${px(point.lng).toFixed(1)},${py(point.lat).toFixed(1)}`).join(' ')
  const totalKm = points.reduce((sum, point, index) => index === 0 ? 0 : sum + geoDistance(points[index - 1], point), 0)
  const latest = points[0]
  const origin = points[points.length - 1]
  const cities = new Set(points.map((point) => (point.location ?? '').split(',')[0]).filter(Boolean))

  return <section className="trail-map">
    <header><div><MapPin size={16} /><b>地图轨迹</b></div><small>{points.length} 个坐标点 · 等距示意</small></header>
    <div className="trail-map-canvas">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`快递地图轨迹，共 ${points.length} 个坐标点`}>
        <defs>
          <linearGradient id="trail-route" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#2a9d8f" /><stop offset="1" stopColor="#f06a4d" />
          </linearGradient>
        </defs>
        <g stroke="#e3ecec" strokeWidth="1">
          {[0.25, 0.5, 0.75].map((ratio) => <line key={`h${ratio}`} x1="10" x2={W - 10} y1={H * ratio} y2={H * ratio} />)}
          {[0.25, 0.5, 0.75].map((ratio) => <line key={`v${ratio}`} y1="10" y2={H - 10} x1={W * ratio} x2={W * ratio} />)}
        </g>
        <polyline points={path} fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
        <polyline points={path} fill="none" stroke="url(#trail-route)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => <circle key={`${point.time}-${index}`} cx={px(point.lng)} cy={py(point.lat)} r={index === 0 ? 5.5 : 3.5} fill={index === 0 ? '#f06a4d' : '#2a9d8f'} stroke="#fff" strokeWidth="2"><title>{`${point.location || point.title}（${point.time}）`}</title></circle>)}
        <circle cx={px(latest.lng)} cy={py(latest.lat)} r="10" fill="none" stroke="#f06a4d" strokeWidth="1.5" opacity="0.4" />
        <text x={px(latest.lng)} y={py(latest.lat) - 15} textAnchor="middle" fontSize="10" fontWeight="700" fill="#c2412a">{latest.location || latest.title}</text>
        <text x={px(origin.lng)} y={py(origin.lat) + 21} textAnchor="middle" fontSize="10" fill="#4a6b68">{origin.location || origin.title}</text>
      </svg>
    </div>
    <div className="trail-map-legend"><span><i className="latest" />最新位置</span><span><i />历史节点</span><small>直线跨度约 {totalKm < 10 ? totalKm.toFixed(1) : Math.round(totalKm)} km{cities.size > 1 ? ` · 途经 ${cities.size} 个城市` : ''}</small></div>
    <p className="trail-map-note">点位为承运商返回的行政区域中心，非实时 GPS 定位；示意图按真实经纬度等比缩放。</p>
  </section>
}

type AuthFormProps = {
  view: AuthView
  setView: (value: AuthView) => void
  mode: AuthMode
  setMode: (value: AuthMode) => void
  email: string
  setEmail: (value: string) => void
  password: string
  setPassword: (value: string) => void
  onSubmit: (code?: string) => void | Promise<void>
  onNotice: (text: string) => void
  onSendCode: (email: string, purpose: AuthView) => Promise<SendCodeResult>
  busy: boolean
  demoMode: boolean
  backendUnavailable: boolean
}

function AuthForm({ view, setView, mode, setMode, email, setEmail, password, setPassword, onSubmit, onNotice, onSendCode, busy, demoMode, backendUnavailable }: AuthFormProps) {
  const isRegistering = view === 'register'
  const [verificationCode, setVerificationCode] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [sendingCode, setSendingCode] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [lastSentEmail, setLastSentEmail] = useState('')
  const [sendCodeError, setSendCodeError] = useState('')
  const [sendCodeErrorCode, setSendCodeErrorCode] = useState('')

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setInterval(() => setCountdown((value) => Math.max(value - 1, 0)), 1000)
    return () => window.clearInterval(timer)
  }, [countdown])


  const handleSendCode = async () => {
    if (sendingCode || countdown > 0 || busy) return
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      onNotice('请输入正确的邮箱地址')
      return
    }
    setSendCodeError('')
    setSendCodeErrorCode('')
    setSendingCode(true)
    try {
      const result = await onSendCode(normalizedEmail, isRegistering ? 'register' : 'login')
      if (result.retryAfter && result.retryAfter > 0) setCountdown(result.retryAfter)
      if (result.ok) {
        setLastSentEmail(normalizedEmail)
      } else {
        setSendCodeError(result.message ?? '验证码发送失败，请稍后重试')
        setSendCodeErrorCode(result.code ?? '')
      }
    } finally {
      setSendingCode(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    void onSubmit((mode === 'code' || isRegistering) ? verificationCode : undefined)
  }

  const switchView = () => setView(isRegistering ? 'login' : 'register')
  const switchMode = (nextMode: AuthMode) => setMode(nextMode)

  return <form className="auth-form" onSubmit={handleSubmit} aria-busy={busy} noValidate>
    <div className="auth-form-heading"><div><b>{isRegistering ? '创建你的账号' : '登录账号'}</b><small>{isRegistering ? '验证邮箱，开始查询你的快递' : '使用邮箱进入你的包裹空间'}</small></div>{isRegistering && <span className="new-account-tag">新用户</span>}</div>
    {backendUnavailable && <div className="auth-status-note" role="status"><CircleAlert size={15} /><span>{demoMode ? '后端暂未连接，当前可用本地演示验证码 123456' : '认证服务暂时不可用，请稍后重试'}</span></div>}
    {!isRegistering && <div className="auth-tabs" role="tablist" aria-label="登录方式"><button type="button" role="tab" aria-selected={mode === 'code'} className={mode === 'code' ? 'active' : ''} onClick={() => switchMode('code')}>邮箱验证码登录</button><button type="button" role="tab" aria-selected={mode === 'password'} className={mode === 'password' ? 'active' : ''} onClick={() => switchMode('password')}>密码登录</button></div>}
    <label htmlFor="auth-email">邮箱地址<input id="auth-email" value={email} onChange={(event) => { setEmail(event.target.value); setSendCodeError(''); setSendCodeErrorCode('') }} type="email" autoComplete="email" placeholder="请输入邮箱地址" required /></label>
    {(mode === 'code' || isRegistering) && <label htmlFor="auth-code">邮箱验证码<div className="code-input"><input id="auth-code" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="输入 6 位验证码" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required /><button type="button" disabled={countdown > 0 || sendingCode || busy} onClick={() => void handleSendCode()}>{sendingCode ? '发送中…' : countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}</button></div>{lastSentEmail && <small className="auth-hint" role="status">验证码已发送到 {maskEmail(lastSentEmail)}，5 分钟内有效</small>}{sendCodeError && <small className="auth-hint auth-error" role="alert">{sendCodeError}</small>}{sendCodeErrorCode === 'EMAIL_NOT_REGISTERED' && !isRegistering && <button className="auth-error-action" type="button" onClick={switchView}>注册这个邮箱</button>}</label>}
    {(mode === 'password' || isRegistering) && <label htmlFor="auth-password">{isRegistering ? '设置登录密码' : '登录密码'}<div className="password-input"><KeyRound size={16} /><input id="auth-password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete={isRegistering ? 'new-password' : 'current-password'} maxLength={128} minLength={6} required={isRegistering || mode === 'password'} placeholder={isRegistering ? '至少 6 位，用于后续登录' : '请输入登录密码'} />{password && <button type="button" className="password-toggle" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>}</div></label>}
    {isRegistering && <small className="auth-hint auth-password-note">邮箱验证码用于确认身份，登录密码用于以后快速登录。</small>}
    <button className="submit" type="submit" disabled={busy}>{busy ? <RefreshCw size={17} className="spin" /> : isRegistering ? <UserRound size={17} /> : <LogIn size={17} />} {busy ? '处理中…' : isRegistering ? '创建账号' : '进入我的包裹'}</button>
    <small className="terms">{isRegistering ? '注册即表示你同意《用户协议》和《隐私说明》' : '登录即表示你同意《用户协议》和《隐私说明》'}</small>
    <div className="auth-switch"><span>{isRegistering ? '已经有账号？' : '还没有账号？'}</span><button type="button" onClick={switchView}>{isRegistering ? '返回登录' : '注册账号'}</button></div>
  </form>
}

function LoginPage({ view, setView, mode, setMode, email, setEmail, password, setPassword, onSubmit, onNotice, onSendCode, busy, demoMode, backendUnavailable }: AuthFormProps) {
  return <div className="auth-screen"><div className="auth-panel"><div className="auth-brand"><span className="brand-mark"><PackageCheck size={20} /></span><b>驿见</b></div><div className="auth-copy"><div className="eyebrow"><Sparkles size={14} /> 主流快递，一处查看</div><h1>你的包裹，<br /><span>不必到处找。</span></h1><p>登录后输入运单号查询物流，记录和取件码只在你的账号内展示。</p></div><AuthForm key={view} view={view} setView={setView} mode={mode} setMode={setMode} email={email} setEmail={setEmail} password={password} setPassword={setPassword} onSubmit={onSubmit} onNotice={onNotice} onSendCode={onSendCode} busy={busy} demoMode={demoMode} backendUnavailable={backendUnavailable} /><div className="auth-safe"><ShieldCheck size={15} /> 你的包裹记录只与当前账号关联</div></div><div className="auth-art"><div className="mock-window"><div className="mock-bar"><i /><i /><i /></div><div className="mock-body"><div className="mock-card"><span /><span /><b><PackageCheck size={15} /> A6-219</b></div><div className="mock-row"><div /><div /></div></div></div><div className="mock-caption"><Eye size={16} /><div><b>隐私可见</b><small>取件码不会出现在系统通知里</small></div></div></div></div>
}
