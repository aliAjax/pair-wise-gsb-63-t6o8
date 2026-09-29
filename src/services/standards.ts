import type { InspectionItem, InspectionRecord, StandardItem, StandardVersion } from '../types'

/** 从设备编号推断型号前缀，如 RC-007 -> RC */
export function resolveModel(deviceCode: string): string {
  return deviceCode.trim().split(/[\s-]/)[0]?.toUpperCase() ?? ''
}

/**
 * 取任务开始时刻应当适用的标准版本。
 * 已开始的任务在创建时冻结一次；新标准发布后不会串改进行中的任务。
 */
export function standardAt(standards: StandardVersion[], deviceModel: string, at: string): StandardVersion | null {
  const applicable = standards
    .filter((item) => item.deviceModel === deviceModel && item.publishedAt <= at)
    .sort((a, b) => b.version - a.version)
  return applicable[0] ?? null
}

export function latestStandard(standards: StandardVersion[], deviceModel: string): StandardVersion | null {
  const list = standards.filter((item) => item.deviceModel === deviceModel)
    .sort((a, b) => b.version - a.version)
  return list[0] ?? null
}

/** 从标准版本逐项生成检验录入快照：限值复制进任务，之后标准再发布也不影响本次判定 */
export function buildItemsFromStandard(standard: StandardVersion, abnormal = false): InspectionItem[] {
  return standard.items.map((item) => emptyItem(item, abnormal))
}

function emptyItem(item: StandardItem, abnormal: boolean): InspectionItem {
  const preset: Record<string, { result: InspectionItem['result']; reading: string; note?: string } | undefined> = {
    wear: abnormal ? { result: '异常', reading: '4.6 mm', note: '主支撑连接处磨损超限' } : { result: '正常', reading: '', note: '' },
    noise: { result: '正常', reading: '', note: '' },
    brake: abnormal ? { result: '正常', reading: '', note: '' } : { result: '正常', reading: '', note: '' },
    lock: abnormal ? { result: '异常', reading: '存在间隙', note: '安全压杠锁止存在回弹' } : { result: '正常', reading: '', note: '' }
  }
  const hit = preset[item.id]
  return {
    id: item.id,
    name: item.name,
    result: hit?.result ?? '正常',
    reading: hit?.reading ?? '待录入',
    limit: item.limit,
    note: hit?.note ?? ''
  }
}

/** 限值的数值上界（含 ≤），用于自动比对实测读数 */
function numericUpperBound(limit: string): number | null {
  const match = limit.match(/≤\s*([\d.]+)/)
  return match ? Number(match[1]) : null
}

function numericReading(reading: string): number | null {
  const match = reading.match(/-?\d+(\.\d+)?/)
  return match ? Number(match[0]) : null
}

/** 按任务冻结的标准版本判定单项是否合格（标准不再就地变更，这里只做读数比对提示） */
export function judgeItem(item: Pick<InspectionItem, 'result' | 'reading' | 'limit'>): 'pass' | 'fail' | 'skip' {
  if (item.result === '不适用') return 'skip'
  if (item.result === '异常') return 'fail'
  if (!item.reading || item.reading === '待录入') return 'skip'
  const bound = numericUpperBound(item.limit)
  const value = numericReading(item.reading)
  if (bound !== null && value !== null) return value <= bound ? 'pass' : 'fail'
  return 'pass'
}

export function hasAbnormalItem(record: Pick<InspectionRecord, 'items'>): boolean {
  return record.items.some((item) => item.result === '异常' || judgeItem(item) === 'fail')
}

export function standardTag(standard: StandardVersion | null): string {
  return standard ? standard.label : '无适用版本'
}
