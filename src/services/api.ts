import axios from 'axios'
import type { InspectionDraft, InspectionRecord, StandardVersion } from '../types'
import { buildItemsFromStandard } from './standards'

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 5000
})

export async function loadInspectionSnapshot(fallback: InspectionRecord[]): Promise<InspectionRecord[]> {
  if (!import.meta.env.VITE_API_BASE_URL) return fallback
  try {
    const response = await client.get<InspectionRecord[]>('/inspections')
    return response.data
  } catch {
    return fallback
  }
}

/**
 * 新任务按开始时刻的已发布标准版本执行，标准内容（限值）冻结进任务快照。
 * 之后管理员再发布新标准，进行中的任务仍按开始时那版判定。
 */
export function createOfflineInspection(draft: InspectionDraft, standard: StandardVersion): InspectionRecord {
  const now = new Date().toISOString()
  return {
    id: `INS-${Date.now().toString().slice(-10)}`,
    ...draft,
    inspectedAt: now,
    status: '待检验',
    stopped: false,
    items: buildItemsFromStandard(standard),
    evidence: [],
    disposition: '',
    standardVersion: standard.version,
    standardLabel: standard.label,
    standardFrozenAt: now,
    reviewNote: '',
    retests: [],
    nextRetestDate: null,
    revision: 1,
    version: 1,
    lastSavedBy: draft.inspector,
    createdAt: now,
    updatedAt: now
  }
}

export function connectLiveUpdates(onMessage: (message: string) => void): () => void {
  const endpoint = import.meta.env.VITE_WS_URL
  if (!endpoint) return () => undefined
  const socket = new WebSocket(endpoint)
  socket.addEventListener('message', (event) => onMessage(String(event.data)))
  return () => socket.close()
}
