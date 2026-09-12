export function env(name: string, fallback?: string): string | undefined {
  const value = process.env[name]
  return value === undefined ? fallback : value
}

export function isProduction(): boolean {
  return env('NODE_ENV') === 'production'
}

