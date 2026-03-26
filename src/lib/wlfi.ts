import { execSync } from 'child_process'

export interface TransferResult {
  success: boolean
  txHash?: string
  error?: string
}

/**
 * 调用 wlfi-agent 命令行工具完成链上转账
 */
export async function transferWithWLFI(
  toAddress: string,
  amount: number,
  memo: string
): Promise<TransferResult> {
  // 如果是 Demo 模式（未配置真实钱包），返回模拟结果
  if (process.env.WLFI_DEMO_MODE === 'true') {
    await new Promise(r => setTimeout(r, 1500))
    const fakeTxHash = '0x' + Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')
    return { success: true, txHash: fakeTxHash }
  }

  try {
    const wlfiBin = process.env.WLFI_HOME
      ? `${process.env.WLFI_HOME}/bin/wlfi-agent`
      : 'wlfi-agent'

    const network = process.env.WLFI_NETWORK || 'base'
    const token = process.env.WLFI_TOKEN_ADDRESS || ''

    const cmd = token
      ? `${wlfiBin} transfer --network "${network}" --token "${token}" --to "${toAddress}" --amount "${amount}" --broadcast --json`
      : `${wlfiBin} transfer-native --network "${network}" --to "${toAddress}" --amount "${amount}" --broadcast --json`

    const result = execSync(cmd, { timeout: 60000, encoding: 'utf-8' })

    const parsed = JSON.parse(result)
    return {
      success: true,
      txHash: parsed.txHash || parsed.tx_hash || parsed.hash || parsed.receipt?.transactionHash
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err)
    return { success: false, error }
  }
}
