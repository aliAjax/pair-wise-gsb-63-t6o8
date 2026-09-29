import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedConflictRevisions, seedRecords, seedStandards } from '../data/seed'
import { createOfflineInspection } from '../services/api'
import { hasAbnormalItem, resolveModel, standardAt } from '../services/standards'
import { deepClone } from '../utils/clone'
import type {
  AuditEntry, ConflictRevision, EvidenceRef, InspectionDraft, InspectionItem,
  InspectionRecord, InspectionStatus, RetestRecord, StandardItem, StandardVersion
} from '../types'

const STORAGE_KEY = 'gsb63:inspection-platform:v2'
const LEGACY_STORAGE_KEY = 'gsb63:inspection-platform'

interface PersistedState {
  standards: StandardVersion[]
  records: InspectionRecord[]
  conflictRevisions: ConflictRevision[]
  audit: AuditEntry[]
}

interface SaveInput {
  id: string
  /** 打开窗口时记录的 revision，用于乐观锁识别并发窗口 */
  baseRevision: number
  operator: string
  assignedTo: string
  dueDate: string
  risk: InspectionRecord['risk']
  stopped: boolean
  items: InspectionItem[]
  disposition: string
  evidence: EvidenceRef[]
}

interface SaveResult {
  ok: boolean
  conflict?: boolean
  conflictId?: string
  review?: boolean
  message: string
}

interface RetestInput {
  recordId: string
  tester: string
  readings: RetestRecord['readings']
  note: string
  /** 复测失败时登记的下一次复测日期 */
  nextRetestDate: string
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** 旧记录补默认版本：按设备型号取创建时刻已发布的最新版；没有适用版本则进入待复核 */
function migrateRecord(record: InspectionRecord, standards: StandardVersion[]): InspectionRecord {
  const next = record as InspectionRecord
  if (!next.deviceModel) next.deviceModel = resolveModel(next.deviceCode)
  if (!Array.isArray(next.evidence)) next.evidence = []
  if (!Array.isArray(next.retests)) next.retests = []
  if (next.nextRetestDate === undefined) next.nextRetestDate = null
  if (!next.disposition) next.disposition = ''
  if (!next.reviewNote) next.reviewNote = ''
  if (next.revision == null) next.revision = next.version ?? 1
  if (!next.lastSavedBy) next.lastSavedBy = next.assignedTo || next.inspector || '历史窗口'
  if (next.standardVersion == null || next.standardVersion === undefined) {
    const std = standardAt(standards, next.deviceModel, next.createdAt || new Date().toISOString())
    if (std) {
      next.standardVersion = std.version
      next.standardLabel = std.label
      next.standardFrozenAt = next.createdAt
      next.items = next.items.map((item) => {
        const stdItem = std.items.find((candidate) => candidate.id === item.id)
        return stdItem ? { ...item, name: stdItem.name, limit: stdItem.limit } : item
      })
    } else {
      next.standardVersion = 0
      next.standardLabel = '无适用版本'
      next.standardFrozenAt = ''
      next.status = '待复核'
      next.stopped = true
      next.reviewNote = `迁移自旧记录：未找到型号 ${next.deviceModel} 的已发布检验标准，转入待复核，停用等待人工补版`
    }
  }
  return next
}

function migrate(raw: Partial<PersistedState> | null): PersistedState {
  const standards: StandardVersion[] = raw?.standards?.length ? raw.standards : deepClone(seedStandards)
  const records: InspectionRecord[] = raw?.records?.length
    ? raw.records.map((record) => migrateRecord(record, standards))
    : deepClone(seedRecords)
  return {
    standards,
    records,
    conflictRevisions: raw?.conflictRevisions ?? deepClone(seedConflictRevisions),
    audit: raw?.audit?.length ? raw.audit : deepClone(seedAudit)
  }
}

function readPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return migrate(JSON.parse(raw) as PersistedState)
    // 兼容升级前只保存 records/audit 的旧键
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy) as { records?: InspectionRecord[]; audit?: AuditEntry[] }
      return migrate({ records: parsed.records, audit: parsed.audit })
    }
  } catch {
    // 落到种子数据
  }
  return migrate(null)
}

function mergeEvidence(existing: EvidenceRef[], incoming: EvidenceRef[]): EvidenceRef[] {
  const map = new Map<string, EvidenceRef>()
  for (const item of [...existing, ...incoming]) {
    if (!map.has(item.id)) map.set(item.id, item)
  }
  return [...map.values()].sort((a, b) => (a.uploadedAt < b.uploadedAt ? -1 : 1))
}

export const useInspectionStore = defineStore('inspection', () => {
  const initial = readPersisted()
  const standards = ref<StandardVersion[]>(initial.standards)
  const records = ref<InspectionRecord[]>(initial.records)
  const conflictRevisions = ref<ConflictRevision[]>(initial.conflictRevisions)
  const audit = ref<AuditEntry[]>(initial.audit)
  const keyword = ref('')
  const status = ref<InspectionStatus | '全部'>('全部')
  const area = ref('全部')
  const liveMessage = ref('本地实时通道已就绪')

  let applyingExternal = false

  const filtered = computed(() => records.value.filter((record) => {
    const haystack = `${record.id} ${record.deviceCode} ${record.deviceName} ${record.inspector} ${record.assignedTo}`.toLowerCase()
    return (!keyword.value || haystack.includes(keyword.value.toLowerCase()))
      && (status.value === '全部' || record.status === status.value)
      && (area.value === '全部' || record.area === area.value)
  }))

  const stats = computed(() => ({
    total: records.value.length,
    blocked: records.value.filter((item) => item.stopped).length,
    overdue: records.value.filter((item) => item.dueDate < '2026-09-29' && !['已关闭', '待复核'].includes(item.status)).length,
    closed: records.value.filter((item) => item.status === '已关闭').length,
    review: records.value.filter((item) => item.status === '待复核').length,
    conflicts: conflictRevisions.value.filter((item) => item.status === '待解决').length
  }))

  const modelOptions = computed(() => {
    const seen = new Map<string, string>()
    for (const item of standards.value) seen.set(item.deviceModel, item.modelName)
    return [...seen.entries()].map(([value, label]) => ({ value, label: `${value} · ${label}` }))
  })

  function standardForModel(deviceModel: string): StandardVersion | null {
    const list = standards.value.filter((item) => item.deviceModel === deviceModel)
      .sort((a, b) => b.version - a.version)
    return list[0] ?? null
  }

  function addAudit(recordId: string, action: string, operator: string, detail: string, standardLabel: string | null = null) {
    audit.value.unshift({
      id: `${recordId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      recordId,
      action,
      operator,
      detail,
      standardLabel,
      createdAt: new Date().toISOString()
    })
  }

  /** 新任务按当前发布版本执行，标准快照在创建时冻结；无适用版本则登记待复核 */
  function addRecord(draft: InspectionDraft): SaveResult & { record?: InspectionRecord } {
    const deviceModel = draft.deviceModel || resolveModel(draft.deviceCode)
    const now = new Date().toISOString()
    const standard = standardAt(standards.value, deviceModel, now)
    if (!standard) {
      // 没有适用版本：进入待复核，保持停用，等待发布/补绑标准
      const record: InspectionRecord = {
        id: `INS-${Date.now().toString().slice(-10)}`,
        ...draft,
        deviceModel,
        inspectedAt: now,
        status: '待复核',
        stopped: true,
        items: [],
        evidence: [],
        disposition: '',
        standardVersion: 0,
        standardLabel: '无适用版本',
        standardFrozenAt: '',
        reviewNote: `型号 ${deviceModel} 暂无已发布检验标准，登记后进入待复核，停用等待人工处理`,
        retests: [],
        nextRetestDate: null,
        revision: 1,
        version: 1,
        lastSavedBy: draft.inspector,
        createdAt: now,
        updatedAt: now
      }
      records.value.unshift(record)
      addAudit(record.id, '创建检验记录', draft.inspector,
        `型号 ${deviceModel} 没有已发布的适用标准版本，任务进入待复核，设备先停用隔离`, null)
      return { ok: true, review: true, record, message: `型号 ${deviceModel} 无适用标准，已进入待复核` }
    }
    const record = createOfflineInspection({ ...draft, deviceModel }, standard)
    record.lastSavedBy = draft.inspector
    records.value.unshift(record)
    addAudit(record.id, '创建检验记录', draft.inspector,
      `任务开始，按当前发布版本 ${standard.label} 冻结检验标准（${standard.items.length} 个检验项）；标准日后再发布不影响本任务`, standard.label)
    return { ok: true, record, message: `已创建 ${record.id}，按 ${standard.label} 执行` }
  }

  /**
   * 现场窗口保存：乐观锁。
   * baseRevision 落后于当前 revision，说明另一窗口已先保存——
   * 后保存窗口保留自己的输入，先保存一方的责任人、处置结论、证据编号和逐项读数留档为冲突修订。
   */
  function saveRecord(input: SaveInput): SaveResult {
    const record = records.value.find((item) => item.id === input.id)
    if (!record) return { ok: false, message: '记录不存在' }
    if (record.standardVersion === 0) {
      return { ok: false, message: '该记录处于待复核、未绑定标准版本，不能按检验保存；请先补绑适用版本' }
    }
    const now = new Date().toISOString()
    const label = record.standardLabel

    if (input.baseRevision !== record.revision) {
      const loserOperator = record.lastSavedBy
      const revision: ConflictRevision = {
        id: `CFL-${Date.now().toString().slice(-10)}`,
        recordId: record.id,
        detectedAt: now,
        resolvedAt: null,
        winnerOperator: input.operator,
        loserOperator,
        reason: `本窗口基于 R${input.baseRevision} 保存，但记录已被「${loserOperator}」先保存到 R${record.revision}；后保存窗口的输入已保留，先保存一方的现场记录留档为冲突修订`,
        status: '待解决',
        loserSnapshot: {
          assignedTo: record.assignedTo,
          disposition: record.disposition,
          evidenceIds: record.evidence.map((item) => item.id),
          items: deepClone(record.items)
        },
        winnerSnapshot: {
          assignedTo: input.assignedTo,
          disposition: input.disposition,
          evidenceIds: input.evidence.map((item) => item.id),
          items: deepClone(input.items)
        }
      }
      conflictRevisions.value.unshift(revision)

      Object.assign(record, {
        assignedTo: input.assignedTo,
        dueDate: input.dueDate,
        risk: input.risk,
        stopped: input.stopped,
        items: deepClone(input.items),
        disposition: input.disposition,
        lastSavedBy: input.operator,
        evidence: mergeEvidence(record.evidence, input.evidence)
      })
      record.revision += 1
      record.version = record.revision
      record.updatedAt = now

      addAudit(record.id, '生成冲突修订', '系统',
        `后保存窗口（${input.operator}）的输入已保留；先保存的「${loserOperator}」责任人「${revision.loserSnapshot.assignedTo}」、处置结论「${revision.loserSnapshot.disposition || '—'}」与证据 ${revision.loserSnapshot.evidenceIds.join('、') || '无'} 已留档至 ${revision.id}，证据编号全部保留`,
        label)
      return { ok: true, conflict: true, conflictId: revision.id, message: `检测到并发保存：已保留本窗口输入，先保存内容留档为 ${revision.id}` }
    }

    Object.assign(record, {
      assignedTo: input.assignedTo,
      dueDate: input.dueDate,
      risk: input.risk,
      stopped: input.stopped,
      items: deepClone(input.items),
      disposition: input.disposition,
      lastSavedBy: input.operator,
      evidence: mergeEvidence(record.evidence, input.evidence)
    })
    record.revision += 1
    record.version = record.revision
    record.updatedAt = now
    addAudit(record.id, '现场检验保存', input.operator,
      `按开始时冻结版本 ${label} 保存至 R${record.revision}，现场证据 ${record.evidence.length} 份`, label)
    return { ok: true, message: `检验记录已保存（R${record.revision}）` }
  }

  /** 将冲突修订中先保存一方的字段并回记录（证据已在冲突时自动合并保留） */
  function mergeConflictField(recordId: string, conflictId: string, field: 'assignedTo' | 'disposition' | 'items', operator: string) {
    const revision = conflictRevisions.value.find((item) => item.id === conflictId && item.recordId === recordId)
    const record = records.value.find((item) => item.id === recordId)
    if (!revision || !record) return
    const fieldLabel = field === 'assignedTo' ? '责任人' : field === 'disposition' ? '处置结论' : '逐项检验读数'
    if (field === 'assignedTo') record.assignedTo = revision.loserSnapshot.assignedTo
    if (field === 'disposition') record.disposition = revision.loserSnapshot.disposition
    if (field === 'items') {
      // 逐项并入先保存一方的读数/备注，但保留后保存一方后续录入，避免再次覆盖
      record.items = record.items.map((item) => {
        const loserItem = revision.loserSnapshot.items.find((candidate) => candidate.id === item.id)
        return loserItem ? { ...item, reading: loserItem.reading, note: loserItem.note ? `${item.note ? `${item.note}；` : ''}先保存窗口留档：${loserItem.note}` : item.note } : item
      })
    }
    revision.status = '已并入'
    revision.resolvedAt = new Date().toISOString()
    record.revision += 1
    record.version = record.revision
    record.updatedAt = new Date().toISOString()
    addAudit(recordId, '并入冲突修订', operator,
      `冲突修订 ${conflictId} 中先保存窗口「${revision.loserOperator}」的${fieldLabel}已并回记录（${field === 'assignedTo' ? `责任人：${revision.loserSnapshot.assignedTo}` : ''}）`,
      record.standardLabel)
  }

  function conflictsOf(recordId: string): ConflictRevision[] {
    return conflictRevisions.value.filter((item) => item.recordId === recordId)
      .sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : -1))
  }

  /** 看板调度：仅调整责任人，不属于现场窗口保存，不产生冲突修订 */
  function reassign(id: string, assignedTo: string, operator = '调度员') {
    const record = records.value.find((item) => item.id === id)
    if (!record) return
    record.assignedTo = assignedTo
    record.updatedAt = new Date().toISOString()
    addAudit(id, '调整责任归属', operator, `责任人调整为 ${assignedTo}`, record.standardLabel)
  }

  /** 演练用：模拟另一窗口（如晚班）已先完成保存，使当前打开窗口的基准版本落后 */
  function simulateConcurrentSave(id: string, operator = '晚班窗口 · 郑涛') {
    const record = records.value.find((item) => item.id === id)
    if (!record) return
    record.assignedTo = '维修二组'
    record.disposition = '更换锁止销并复查压杠回弹，磨损点补焊加强'
    record.lastSavedBy = operator
    record.revision += 1
    record.version = record.revision
    record.updatedAt = new Date().toISOString()
    addAudit(id, '现场检验保存', operator,
      `另一窗口先保存至 R${record.revision}（演练数据），按开始时冻结版本 ${record.standardLabel} 判定`, record.standardLabel)
  }

  function publishStandard(input: {
    deviceModel: string
    modelName: string
    changeNote: string
    items: StandardItem[]
    publishedBy: string
  }): StandardVersion {
    const versions = standards.value.filter((item) => item.deviceModel === input.deviceModel)
    const version = versions.length ? Math.max(...versions.map((item) => item.version)) + 1 : 1
    const standard: StandardVersion = {
      id: `STD-${input.deviceModel}-V${version}`,
      deviceModel: input.deviceModel,
      modelName: input.modelName,
      version,
      label: `V${version}`,
      publishedAt: new Date().toISOString(),
      publishedBy: input.publishedBy,
      changeNote: input.changeNote,
      items: input.items.map((item) => ({ ...item }))
    }
    standards.value.push(standard)
    addAudit('STANDARD', `发布检验标准 ${standard.label}`, input.publishedBy,
      `型号 ${input.deviceModel}（${input.modelName}）发布新版本，共 ${input.items.length} 个检验项。新任务按本版执行；已开始任务仍按各自开始时冻结的版本判定，不串用新标准。${input.changeNote}`,
      standard.label)
    return standard
  }

  /** 待复核旧记录人工补绑适用版本，之后按该版本重新录入判定 */
  function adoptStandard(recordId: string, standardId: string, operator: string): { ok: boolean; message: string } {
    const record = records.value.find((item) => item.id === recordId)
    const standard = standards.value.find((item) => item.id === standardId)
    if (!record || !standard) return { ok: false, message: '记录或标准版本不存在' }
    record.deviceModel = standard.deviceModel
    record.standardVersion = standard.version
    record.standardLabel = standard.label
    record.standardFrozenAt = new Date().toISOString()
    record.reviewNote = `已于 ${record.standardFrozenAt.replace('T', ' ').slice(0, 16)} 补绑 ${standard.label}，按该版本重新录入判定`
    record.items = standard.items.map((item) => ({
      id: item.id, name: item.name, result: '不适用' as const, reading: '待录入', limit: item.limit, note: ''
    }))
    record.status = '待检验'
    record.updatedAt = new Date().toISOString()
    addAudit(recordId, '补绑检验标准', operator,
      `待复核旧记录补绑 ${standard.label}（${standard.modelName}），检验项按该版本重建，停用维持至检验/复测通过`, standard.label)
    return { ok: true, message: `已补绑 ${standard.label}，请按该版本录入检验` }
  }

  /** 复测：未通过继续停用并留下下一次复测；全部通过才能恢复开放并闭环 */
  function submitRetest(input: RetestInput): { ok: boolean; message: string } {
    const record = records.value.find((item) => item.id === input.recordId)
    if (!record) return { ok: false, message: '记录不存在' }
    const passed = input.readings.length > 0 && input.readings.every((item) => item.pass)
    const now = new Date().toISOString()
    const retest: RetestRecord = {
      id: `RTS-${Date.now().toString().slice(-10)}`,
      recordId: record.id,
      round: record.retests.length + 1,
      testedAt: now,
      tester: input.tester,
      result: passed ? '通过' : '未通过',
      readings: deepClone(input.readings),
      note: input.note,
      nextRetestDate: passed ? null : input.nextRetestDate
    }
    record.retests.push(retest)

    if (passed) {
      // 复测通过：把对应检验项恢复为正常，解除停用并闭环放行
      for (const reading of input.readings) {
        const item = record.items.find((candidate) => candidate.id === reading.itemId)
        if (item) {
          item.result = '正常'
          item.reading = reading.reading
          item.note = `${item.note ? `${item.note}；` : ''}第 ${retest.round} 轮复测通过`
        }
      }
      if (hasAbnormalItem(record)) {
        return { ok: false, message: '复测读数虽通过，但记录中仍有其他异常项，不能放行，请继续整改' }
      }
      record.stopped = false
      record.status = '已关闭'
      record.nextRetestDate = null
      record.updatedAt = now
      addAudit(record.id, '复测通过放行', input.tester,
        `第 ${retest.round} 轮复测全部符合 ${record.standardLabel}，设备恢复开放，任务闭环`, record.standardLabel)
      return { ok: true, message: `第 ${retest.round} 轮复测通过，设备已恢复开放并关闭任务` }
    }

    // 复测失败：继续停用，并留下下一次复测安排
    for (const reading of input.readings.filter((item) => !item.pass)) {
      const item = record.items.find((candidate) => candidate.id === reading.itemId)
      if (item) item.note = `${item.note ? `${item.note}；` : ''}第 ${retest.round} 轮复测未通过`
    }
    record.stopped = true
    record.status = '停用'
    record.nextRetestDate = input.nextRetestDate
    record.updatedAt = now
    addAudit(record.id, '复测未通过', input.tester,
      `第 ${retest.round} 轮复测存在不符合 ${record.standardLabel} 的项目，设备继续停用，已登记 ${input.nextRetestDate} 下一次复测`, record.standardLabel)
    return { ok: true, message: `第 ${retest.round} 轮复测未通过，设备继续停用，下一次复测 ${input.nextRetestDate}` }
  }

  function transition(id: string, next: InspectionStatus, detail: string, operator = '当前用户') {
    const record = records.value.find((item) => item.id === id)
    if (!record) return { ok: false, message: '记录不存在' }
    if (record.status === '待复核') {
      return { ok: false, message: '待复核记录未绑定标准版本，请先补绑适用版本再流转' }
    }
    if (next === '已关闭' && hasAbnormalItem(record)) {
      return { ok: false, message: '仍有异常项，不能关闭任务；整改后须复测通过才能恢复开放' }
    }
    if (next === '待复测' && !record.stopped && record.risk === '紧急') {
      return { ok: false, message: '紧急风险缺陷必须先执行停用' }
    }
    record.status = next
    record.revision += 1
    record.version = record.revision
    record.updatedAt = new Date().toISOString()
    addAudit(id, `状态流转：${next}`, operator, detail, record.standardLabel)
    return { ok: true, message: `已流转至${next}` }
  }

  /** 上传现场证据，返回证据编号（编号一旦生成即长期保留，冲突保存也不会丢失） */
  function uploadEvidence(recordId: string, name: string, uploadedBy: string): EvidenceRef {
    const record = records.value.find((item) => item.id === recordId)!
    const item: EvidenceRef = {
      id: `EV-${Date.now().toString().slice(-10)}`,
      name: name || '现场照片',
      uploadedAt: new Date().toISOString(),
      uploadedBy
    }
    record.evidence = mergeEvidence(record.evidence, [item])
    return item
  }

  function defaultNextRetestDate(): string {
    const date = new Date()
    date.setDate(date.getDate() + 2)
    return toIsoDate(date)
  }

  function resetDemo() {
    const fresh = migrate(null)
    standards.value = fresh.standards
    records.value = fresh.records
    conflictRevisions.value = fresh.conflictRevisions
    audit.value = fresh.audit
  }

  // 持久化（同步写入，配合外部更新标志避免跨标签回环）
  watch([records, audit, standards, conflictRevisions], () => {
    if (applyingExternal) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      standards: standards.value,
      records: records.value,
      conflictRevisions: conflictRevisions.value,
      audit: audit.value
    } satisfies PersistedState))
  }, { deep: true, flush: 'sync' })

  // 早晚班在两个窗口/标签同时操作：后保存标签的写入会同步到先打开的页面
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return
      try {
        const fresh = migrate(JSON.parse(event.newValue) as PersistedState)
        applyingExternal = true
        standards.value = fresh.standards
        records.value = fresh.records
        conflictRevisions.value = fresh.conflictRevisions
        audit.value = fresh.audit
        applyingExternal = false
        liveMessage.value = '已同步另一窗口的最新保存'
      } catch {
        applyingExternal = false
      }
    })
  }

  return {
    standards, records, conflictRevisions, audit,
    keyword, status, area, liveMessage,
    filtered, stats, modelOptions,
    addRecord, saveRecord, mergeConflictField, conflictsOf, reassign, simulateConcurrentSave,
    publishStandard, adoptStandard, submitRetest, transition,
    standardForModel, uploadEvidence, defaultNextRetestDate, resetDemo
  }
})
