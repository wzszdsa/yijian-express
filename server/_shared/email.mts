import { Resend } from 'resend'
import { env } from './config.mjs'

export type EmailDelivery = { provider: 'console' | 'resend'; demo: boolean }

export async function sendVerificationEmail(email: string, code: string): Promise<EmailDelivery> {
  const provider = (env('EMAIL_PROVIDER', 'console') ?? 'console').toLowerCase()
  if (provider === 'console' || provider === 'mock') {
    console.info(`[yijian:email:console] ${email} verification code generated`)
    return { provider: 'console', demo: true }
  }
  if (provider !== 'resend') throw new Error(`不支持的邮件服务商: ${provider}`)

  const resendToken = env('RESEND_TOKEN')
  const from = env('EMAIL_FROM')
  if (!resendToken || !from) throw new Error('Resend 邮件环境变量未配置完整')

  const resend = new Resend(resendToken)
  const result = await resend.emails.send({
    from,
    to: [email],
    subject: env('EMAIL_SUBJECT', '驿见邮箱验证码') ?? '驿见邮箱验证码',
    text: `你的驿见验证码是：${code}\n验证码 5 分钟内有效，请勿转发给他人。`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.7"><h2>驿见邮箱验证码</h2><p>你的验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 5 分钟内有效，请勿转发给他人。</p></div>`,
  })
  if (result.error) throw new Error(`Resend 邮件发送失败: ${result.error.message}`)
  return { provider: 'resend', demo: false }
}

