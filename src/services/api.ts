import axios from 'axios'
import type { InspectionRecord } from '../types'

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

export function connectLiveUpdates(onMessage: (message: string) => void): () => void {
  const endpoint = import.meta.env.VITE_WS_URL
  if (!endpoint) return () => undefined
  const socket = new WebSocket(endpoint)
  socket.addEventListener('message', (event) => onMessage(String(event.data)))
  return () => socket.close()
}
