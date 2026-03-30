import { z, ZodSchema } from 'zod'
import { NextResponse } from 'next/server'

// Parse and validate request body. Returns parsed data or a NextResponse error.
export function parseBody<T>(schema: ZodSchema<T>, body: unknown):
  { success: true; data: T } | { success: false; response: NextResponse } {
  const result = schema.safeParse(body)
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Validation failed', details: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 }
      )
    }
  }
  return { success: true, data: result.data }
}

// Common schemas
export const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM wallet address')
export const uuidSchema = z.string().uuid('Invalid UUID')
export const githubPrUrlSchema = z.string().url().regex(/github\.com\/.*\/pull\/\d+/, 'Must be a GitHub PR URL').optional()
