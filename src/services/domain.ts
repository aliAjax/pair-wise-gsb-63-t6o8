import { familyOf, standardAt, defaultStandard, latestStandard } from '../data/standards'
import type {
  CheckResult,
  InspectionDraft,
  InspectionItem,
  InspectionRecord,
  InspectionStandard,
  RecordRevision,
  RetestRecord,
  RevisionFields,
  RevisionKind,
  SaveOutcome,
  SavePayload
} from '../types'

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`
}

export function newRecordId(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  seq += 1
  return `INS-${y}${m}${d}-${String(seq).padStart(2, '0')}`
}

export function newEvidenceId(now: Date = new Date()): string {
  seq += 1
  const compact = now.toISOString().slice(0, 10).replace(/-/g, '')
  return `EV-${compact}-${String(1000 + seq).slice(-4)}`
}

/** 任务开始时把标准版本逐项快照冻结，之后标准再发布也不会改动在途任务 */
export function snapshotItems(standard: InspectionStandard): InspectionItem[] {
  return standard.items.map((def) => ({
    id: def.id,
    name: def.name,
    result: '正常' as CheckResult,
    reading: '待录入',
    limit: def.limit,
    standardId: standard.id,
    note: ''
  }))
}

export function parseReadingNumber(reading: string): number | null {
  const matched = String(reading).match(/-?\d+(?:\.\d+)?/)
  return matched ? parseFloat(matched[0]) : null
}

const POSITIVE_WORDS = ['可靠', '有效', '正常', '合格', '完好', '无异常', '无可见', '闭合']
const NEGATIVE_WORDS = ['异常', '间隙', '回弹', '超限', '失效', '异响', '渗漏', '松动', '卡滞']

/** 按任务固定版本的标准定义判定单项结果 */
export function judgeReading(reading: string, def: InspectionStandard['items'][number]): CheckResult {
  const text = String(reading ?? '').trim()
  if (!text || text === '待录入') return '正常'
  const numeric = parseReadingNumber(text)
  if (def.threshold !== undefined && numeric !== null) {
    return def.operator === 'le'
      ? numeric <= def.threshold
        ? '正常'
        : '异常'
      : numeric >= def.threshold
        ? '正常'
        : '异常'
  }
  if (NEGATIVE_WORDS.some((word) => text.includes(word))) return '异常'
  if (POSITIVE_WORDS.some((word) => text.includes(word))) return '正常'
  return '正常'
}

function standardOf(record: InspectionRecord, standards: InspectionStandard[]): InspectionStandard | undefined {
  return standards.find((standard) => standard.id === record.standardId)
}

/** 按当前固定版本重新判定全部检验项（限值取自快照，阈值取自标准库） */
export function rejudge(record: InspectionRecord, standards: InspectionStandard[]) {
  const standard = standardOf(record, standards)
  if (!standard) return
  record.items = record.items.map((item) => {
    const def = standard.items.find((candidate) => candidate.id === item.id)
    if (!def) return item
    return { ...item, result: judgeReading(item.reading, def), limit: def.limit, standardId: standard.id }
  })
}

export function hasAbnormal(record: InspectionRecord): boolean {
  return record.items.some((item) => item.result === '异常')
}

function makeRevision(
  record: InspectionRecord,
  kind: RevisionKind,
  operator: string,
  note: string,
  fields: RevisionFields,
  options: { baseRevision?: number; windowId?: string; standardId?: string; prior?: RecordRevision['priorProtected'] } = {}
): RecordRevision {
  record.revision += 1
  const revision: RecordRevision = {
    id: nextId('REV'),
    revision: record.revision,
    kind,
    operator,
    windowId: options.windowId,
    at: new Date().toISOString(),
    baseRevision: options.baseRevision ?? record.revision - 1,
    fields,
    note,
    standardId: options.standardId ?? (record.standardId || undefined)
  }
  if (options.prior) revision.priorProtected = options.prior
  record.revisions.push(revision)
  record.updatedAt = revision.at
  return revision
}

/** 新任务：固定到开始时刻已发布的最新版本；该型号无标准则直接进入待复核 */
export function buildNewRecord(draft: InspectionDraft, standards: InspectionStandard[], nowIso: string, id: string): InspectionRecord {
  const family = familyOf(draft.deviceCode)
  const standard = standardAt(family, nowIso, standards)
  const base: InspectionRecord = {
    id,
    deviceCode: draft.deviceCode.trim(),
    deviceName: draft.deviceName.trim(),
    family,
    area: draft.area,
    shift: draft.shift,
    inspector: draft.inspector,
    inspectedAt: nowIso,
    status: standard ? '待检验' : '待复核',
    risk: draft.risk,
    stopped: false,
    assignedTo: draft.assignedTo,
    disposition: '',
    evidenceIds: [],
    dueDate: draft.dueDate,
    items: standard ? snapshotItems(standard) : [],
    standardId: standard?.id ?? '',
    standardVersion: standard?.version ?? 0,
    revision: 0,
    revisions: [],
    retests: [],
    reviewReason: standard ? undefined : `型号系列 ${family} 暂无已发布检验标准，需人工复核并指派适用版本`,
    createdAt: nowIso,
    updatedAt: nowIso
  }
  makeRevision(
    base,
    '创建',
    draft.inspector,
    standard
      ? `任务开始，固定执行 ${standard.id}（${standard.publishedAt.slice(0, 10)} 发布）；在途期间不串用后续新版本`
      : `任务开始时型号 ${family} 无适用标准，登记待复核`,
    { status: base.status, assignedTo: base.assignedTo, risk: base.risk, dueDate: base.dueDate, items: base.items },
    { standardId: standard?.id }
  )
  return base
}

/** 旧记录迁移：按设备型号补默认版本；无适用版本进入待复核 */
export function backfillLegacyRecord(raw: LegacyRecord, standards: InspectionStandard[]): InspectionRecord {
  const family = familyOf(raw.deviceCode)
  const standard = defaultStandard(family, standards)
  const record: InspectionRecord = {
    id: raw.id,
    deviceCode: raw.deviceCode,
    deviceName: raw.deviceName,
    family,
    area: raw.area,
    shift: raw.shift,
    inspector: raw.inspector,
    inspectedAt: raw.inspectedAt,
    status: raw.status,
    risk: raw.risk,
    stopped: raw.stopped,
    assignedTo: raw.assignedTo,
    disposition: raw.disposition ?? '',
    evidenceIds: raw.evidenceIds ?? [],
    dueDate: raw.dueDate,
    items: [],
    standardId: '',
    standardVersion: 0,
    revision: 0,
    revisions: [],
    retests: raw.retests ?? [],
    createdAt: raw.createdAt,
    updatedAt: raw.createdAt
  }
  makeRevision(record, '创建', raw.inspector, '历史检验记录（旧系统迁移）', {
    status: raw.status,
    assignedTo: raw.assignedTo,
    risk: raw.risk,
    dueDate: raw.dueDate
  })
  record.revisions[0].at = raw.createdAt
  record.updatedAt = raw.createdAt

  if (standard) {
    record.standardId = standard.id
    record.standardVersion = standard.version
    record.items = raw.items.map((item) => {
      const def = standard.items.find((candidate) => candidate.id === item.id)
      return {
        ...item,
        limit: def?.limit ?? item.limit,
        standardId: standard.id,
        result: def ? judgeReading(item.reading, def) : item.result
      }
    })
    const backfilledAt = new Date(new Date(raw.updatedAt).getTime() + 1000).toISOString()
    makeRevision(record, '标准回填', '系统迁移', `旧记录按设备型号 ${family} 补挂默认版本 ${standard.id}，逐项限值按该版快照固定`, {
      items: record.items
    }, { standardId: standard.id })
    record.revisions[record.revisions.length - 1].at = backfilledAt
    record.updatedAt = backfilledAt
  } else {
    record.items = raw.items.map((item) => ({ ...item, standardId: '' }))
    record.status = '待复核'
    record.reviewReason = `未找到型号 ${family} 适用的已发布标准版本，旧记录转入待复核，由人工指派标准后重开检验`
    const flaggedAt = new Date(new Date(raw.updatedAt).getTime() + 1000).toISOString()
    makeRevision(record, '待复核登记', '系统迁移', record.reviewReason, {
      status: '待复核',
      items: record.items
    })
    record.revisions[record.revisions.length - 1].at = flaggedAt
    record.updatedAt = flaggedAt
  }
  return record
}

/** 待复核记录人工指派标准版本（默认取该型号最新版），重新快照检验项 */
export function assignStandard(record: InspectionRecord, standard: InspectionStandard, operator: string): void {
  record.standardId = standard.id
  record.standardVersion = standard.version
  record.reviewReason = undefined
  const previousReadings = new Map(record.items.map((item) => [item.id, item]))
  record.items = standard.items.map((def) => {
    const previous = previousReadings.get(def.id)
    const item: InspectionItem = {
      id: def.id,
      name: def.name,
      result: previous ? judgeReading(previous.reading, def) : '正常',
      reading: previous?.reading ?? '待录入',
      limit: def.limit,
      standardId: standard.id,
      note: previous?.note ?? ''
    }
    return item
  })
  if (record.status === '待复核') record.status = '待检验'
  makeRevision(record, '标准指派', operator, `人工指派适用标准 ${standard.id}，检验项限值按该版重新快照`, {
    status: record.status,
    items: record.items
  }, { standardId: standard.id })
}

/**
 * 多窗口并发保存：
 * - baseRevision 落后即判定为冲突，生成“冲突修订”
 * - 后保存窗口的全部输入原样保留在修订里
 * - 先保存窗口的责任人、处置结论、证据编号受保护，不被覆盖
 */
export function saveInspection(record: InspectionRecord, payload: SavePayload, standards: InspectionStandard[]): SaveOutcome {
  const conflict = payload.baseRevision !== record.revision
  const priorAssignee = record.assignedTo
  const priorDisposition = record.disposition
  const priorEvidence = [...record.evidenceIds]

  // 后保存窗口的输入完整保留在修订字段中
  const fields: RevisionFields = {
    assignedTo: payload.assignedTo,
    disposition: payload.disposition,
    risk: payload.risk,
    dueDate: payload.dueDate,
    stopped: payload.stopped,
    evidenceIds: [...payload.evidenceIds],
    items: structuredClone(payload.items)
  }

  record.risk = payload.risk
  record.dueDate = payload.dueDate
  record.stopped = payload.stopped
  record.items = structuredClone(payload.items)
  rejudge(record, standards)
  fields.items = structuredClone(record.items)

  // 证据编号合并：先保存的编号不能丢
  record.evidenceIds = Array.from(new Set([...priorEvidence, ...payload.evidenceIds]))
  fields.evidenceIds = [...payload.evidenceIds]

  if (hasAbnormal(record) && record.status === '待检验') {
    record.status = '需整改'
    fields.status = '需整改'
  }

  let note: string
  let priorProtected: RecordRevision['priorProtected'] | undefined
  if (conflict) {
    // 责任人 / 处置结论沿用先保存窗口；后保存意见只记入修订，等待“采纳”
    record.assignedTo = priorAssignee
    record.disposition = priorDisposition
    const priorRevision = [...record.revisions].reverse().find((item) => item.kind !== '创建') ?? record.revisions[record.revisions.length - 1]
    note = `检测到并发保存：本窗口基于 R${payload.baseRevision}，先保存窗口已写入 R${record.revision}。`
      + `现行责任人「${priorAssignee}」、处置结论「${priorDisposition || '（空）'}」与证据 ${priorEvidence.length ? priorEvidence.join('、') : '（无）'} 已保护；`
      + `本窗口意见（责任人「${payload.assignedTo}」、处置结论「${payload.disposition || '（空）'}」）已留存于本冲突修订，可人工采纳。`
    priorProtected = {
      operator: priorRevision?.operator ?? '先保存窗口',
      windowId: priorRevision?.windowId,
      at: priorRevision?.at ?? record.updatedAt,
      revision: record.revision,
      assignedTo: priorAssignee,
      disposition: priorDisposition,
      evidenceIds: priorEvidence
    }
  } else {
    record.assignedTo = payload.assignedTo
    record.disposition = payload.disposition
    note = `检验录入保存，按 ${record.standardId || '待复核标准'} 判定${hasAbnormal(record) ? '，存在异常项已转入需整改' : '，各项均符合固定版本限值'}`
  }

  makeRevision(record, conflict ? '冲突修订' : '检验保存', payload.operator, note, fields, {
    baseRevision: payload.baseRevision,
    windowId: payload.windowId,
    prior: conflict ? priorProtected : undefined
  })

  return {
    ok: true,
    conflict,
    message: conflict
      ? `并发冲突已生成 R${record.revision}：你的输入已保留，先保存窗口的责任人/处置结论/证据编号未被覆盖`
      : `已保存为 R${record.revision}`,
    laterInputs: conflict
      ? { assignedTo: payload.assignedTo, disposition: payload.disposition }
      : undefined
  }
}

/** 后保存窗口在冲突修订上申请“采纳本窗口意见”，以最新修订为基线再次保存 */
export function adoptConflictProposal(record: InspectionRecord, revisionId: string, operator: string, standards: InspectionStandard[]): SaveOutcome {
  const proposal = record.revisions.find((item) => item.id === revisionId)
  if (!proposal || proposal.kind !== '冲突修订') {
    return { ok: false, conflict: false, message: '只能采纳冲突修订中的意见' }
  }
  return saveInspection(record, {
    baseRevision: record.revision,
    operator,
    windowId: proposal.windowId ? `${proposal.windowId}-采纳` : '采纳冲突意见',
    assignedTo: proposal.fields.assignedTo ?? record.assignedTo,
    disposition: proposal.fields.disposition ?? record.disposition,
    risk: proposal.fields.risk ?? record.risk,
    dueDate: proposal.fields.dueDate ?? record.dueDate,
    stopped: proposal.fields.stopped ?? record.stopped,
    evidenceIds: proposal.fields.evidenceIds ?? record.evidenceIds,
    items: proposal.fields.items ?? record.items
  }, standards)
}

export interface TransitionResult {
  ok: boolean
  message: string
}

export function transitionStatus(record: InspectionRecord, next: InspectionRecord['status'], operator: string, detail: string): TransitionResult {
  if (next === '已关闭' && hasAbnormal(record)) {
    return { ok: false, message: '仍有异常项，不能关闭任务' }
  }
  if (next === '待复测' && !record.stopped && record.risk === '紧急') {
    return { ok: false, message: '紧急风险缺陷必须先执行停用隔离' }
  }
  if (next === '停用' && !record.stopped) {
    record.stopped = true
  }
  const previous = record.status
  record.status = next
  makeRevision(record, next === '停用' ? '停用隔离' : '状态流转', operator, detail || `${previous} → ${next}`, { status: next })
  return { ok: true, message: `已流转至${next}` }
}

export interface RetestInput {
  tester: string
  passed: boolean
  summary: string
  /** 复测失败时必须预约下一次复测 */
  nextRetestAt?: string
}

/** 复测：失败继续停用并预约下一次复测；通过后方可恢复开放 */
export function applyRetest(record: InspectionRecord, input: RetestInput): TransitionResult {
  if (!['待复测', '停用'].includes(record.status)) {
    return { ok: false, message: '只有待复测或停用中的任务可以执行复测' }
  }
  if (!input.summary.trim()) return { ok: false, message: '请填写复测情况说明' }
  if (!input.passed && !input.nextRetestAt) {
    return { ok: false, message: '复测失败必须预约下一次复测时间，设备继续停用' }
  }
  const round = record.retests.length + 1
  const retest: RetestRecord = {
    id: nextId('RT'),
    round,
    testedAt: new Date().toISOString(),
    tester: input.tester,
    passed: input.passed,
    summary: input.summary,
    nextRetestAt: input.passed ? undefined : input.nextRetestAt,
    reopened: false,
    standardId: record.standardId
  }
  record.retests.push(retest)
  if (input.passed) {
    record.status = '已关闭'
    makeRevision(record, '复测通过', input.tester, `第 ${round} 次复测通过（依据 ${record.standardId}），具备恢复开放条件，待执行开放确认`, {
      status: '已关闭'
    })
    return { ok: true, message: `第 ${round} 次复测通过，可恢复开放` }
  }
  record.stopped = true
  record.status = '停用'
  makeRevision(record, '复测失败', input.tester, `第 ${round} 次复测未通过（依据 ${record.standardId}）：${input.summary}；设备继续停用，已预约下一次复测 ${input.nextRetestAt}`, {
    status: '停用',
    stopped: true
  })
  return { ok: true, message: `复测失败，设备继续停用，已预约下一次复测（${input.nextRetestAt}）` }
}

/** 恢复开放：最近一次复测必须通过 */
export function reopen(record: InspectionRecord, operator: string): TransitionResult {
  const last = record.retests[record.retests.length - 1]
  if (!last || !last.passed) {
    return { ok: false, message: '最近一次复测未通过，不能恢复开放' }
  }
  if (!record.stopped) return { ok: false, message: '设备当前未处于停用状态' }
  record.stopped = false
  last.reopened = true
  makeRevision(record, '恢复开放', operator, `依据第 ${last.round} 次通过的复测（${last.id}，标准 ${record.standardId}）解除停用，恢复开放`, {
    stopped: false
  })
  return { ok: true, message: '设备已恢复开放' }
}

/** 标准发布：克隆某型号最新版生成新版本，仅影响之后开始的任务 */
export function publishStandard(
  standards: InspectionStandard[],
  family: string,
  familyName: string,
  publishedBy: string,
  changeNote: string,
  patchItems: Array<{ id: string; threshold?: number; limit?: string; requirement?: string }>
): InspectionStandard {
  const previous = latestStandard(family, standards)
  const version = (previous?.version ?? 0) + 1
  const standard: InspectionStandard = {
    id: `STD-${family}-V${version}`,
    family,
    familyName: previous?.familyName ?? familyName,
    version,
    publishedAt: new Date().toISOString(),
    publishedBy,
    changeNote: changeNote || `发布 ${family} 系列 V${version}`,
    items: (previous?.items ?? []).map((item) => {
      const patch = patchItems.find((candidate) => candidate.id === item.id)
      if (!patch) return { ...item }
      return {
        ...item,
        threshold: patch.threshold ?? item.threshold,
        limit: patch.limit ?? item.limit,
        requirement: patch.requirement ?? item.requirement
      }
    })
  }
  standards.push(standard)
  return standard
}

/** 迁移用的旧记录结构（无标准版本、无修订链字段） */
export interface LegacyRecord {
  id: string
  deviceCode: string
  deviceName: string
  area: string
  shift: string
  inspector: string
  inspectedAt: string
  status: InspectionRecord['status']
  risk: InspectionRecord['risk']
  stopped: boolean
  assignedTo: string
  disposition?: string
  evidenceIds?: string[]
  dueDate: string
  items: InspectionItem[]
  retests?: RetestRecord[]
  createdAt: string
  updatedAt: string
}
