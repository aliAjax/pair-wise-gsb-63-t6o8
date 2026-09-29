import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { buildSeed } from '../data/seed'
import { seedStandards } from '../data/standards'
import {
  adoptConflictProposal,
  applyRetest,
  assignStandard,
  buildNewRecord,
  newEvidenceId,
  newRecordId,
  publishStandard,
  reopen,
  saveInspection,
  transitionStatus,
  type RetestInput
} from '../services/domain'
import type {
  AuditEntry,
  InspectionDraft,
  InspectionRecord,
  InspectionStandard,
  InspectionStatus,
  SaveOutcome,
  SavePayload
} from '../types'

const STORAGE_KEY = 'gsb63:inspection-platform-v2'

interface PersistedState {
  standards: InspectionStandard[]
  records: InspectionRecord[]
  audit: AuditEntry[]
}

function readPersisted(): PersistedState {
  const fallback = buildSeed()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { standards: structuredClone(seedStandards), ...fallback }
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      standards: parsed.standards?.length ? parsed.standards : structuredClone(seedStandards),
      records: parsed.records?.length ? parsed.records : fallback.records,
      audit: parsed.audit ?? fallback.audit
    }
  } catch {
    return { standards: structuredClone(seedStandards), ...fallback }
  }
}

function auditFromRevision(record: InspectionRecord, revisionId: string): AuditEntry | undefined {
  const revision = record.revisions.find((item) => item.id === revisionId)
  if (!revision) return undefined
  return {
    id: `${record.id}-AU-${revision.id}`,
    recordId: record.id,
    action: revision.kind,
    operator: revision.operator,
    detail: revision.note,
    createdAt: revision.at
  }
}

export const useInspectionStore = defineStore('inspection', () => {
  const initial = readPersisted()
  const standards = ref<InspectionStandard[]>(initial.standards)
  const records = ref<InspectionRecord[]>(initial.records)
  const audit = ref<AuditEntry[]>(initial.audit)
  const keyword = ref('')
  const status = ref<InspectionStatus | '全部'>('全部')
  const area = ref('全部')
  const liveMessage = ref('本地实时通道已就绪')

  const filtered = computed(() => records.value.filter((record) => {
    const haystack = `${record.id} ${record.deviceCode} ${record.deviceName} ${record.inspector} ${record.assignedTo} ${record.standardId}`.toLowerCase()
    return (!keyword.value || haystack.includes(keyword.value.toLowerCase()))
      && (status.value === '全部' || record.status === status.value)
      && (area.value === '全部' || record.area === area.value)
  }))

  const stats = computed(() => ({
    total: records.value.length,
    blocked: records.value.filter((item) => item.stopped).length,
    review: records.value.filter((item) => item.status === '待复核').length,
    retestPending: records.value.filter((item) => ['待复测', '停用'].includes(item.status)).length,
    closed: records.value.filter((item) => item.status === '已关闭' && !item.stopped).length
  }))

  function pushAuditFrom(record: InspectionRecord) {
    const latest = record.revisions[record.revisions.length - 1]
    const entry = auditFromRevision(record, latest.id)
    if (entry) audit.value.unshift(entry)
  }

  function findRecord(id: string): InspectionRecord | undefined {
    return records.value.find((item) => item.id === id)
  }

  function standardById(id: string): InspectionStandard | undefined {
    return standards.value.find((item) => item.id === id)
  }

  function addRecord(draft: InspectionDraft): InspectionRecord {
    const now = new Date().toISOString()
    const record = buildNewRecord(draft, standards.value, now, newRecordId())
    records.value.unshift(record)
    pushAuditFrom(record)
    return record
  }

  /** 多窗口保存：携带本窗口打开时的修订号，冲突时生成冲突修订而非覆盖 */
  function saveRecord(id: string, payload: SavePayload): SaveOutcome {
    const record = findRecord(id)
    if (!record) return { ok: false, conflict: false, message: '记录不存在' }
    const outcome = saveInspection(record, payload, standards.value)
    if (outcome.ok) pushAuditFrom(record)
    return outcome
  }

  function adoptProposal(id: string, revisionId: string, operator: string): SaveOutcome {
    const record = findRecord(id)
    if (!record) return { ok: false, conflict: false, message: '记录不存在' }
    const outcome = adoptConflictProposal(record, revisionId, operator, standards.value)
    if (outcome.ok) pushAuditFrom(record)
    return outcome
  }

  function assignStandardVersion(id: string, standardId: string, operator: string) {
    const record = findRecord(id)
    const standard = standardById(standardId)
    if (!record || !standard) return
    assignStandard(record, standard, operator)
    pushAuditFrom(record)
  }

  function transition(id: string, next: InspectionStatus, detail: string, operator = '当前用户') {
    const record = findRecord(id)
    if (!record) return { ok: false, message: '记录不存在' }
    const result = transitionStatus(record, next, operator, detail)
    if (result.ok) pushAuditFrom(record)
    return result
  }

  function retest(id: string, input: RetestInput) {
    const record = findRecord(id)
    if (!record) return { ok: false, message: '记录不存在' }
    const result = applyRetest(record, input)
    if (result.ok) pushAuditFrom(record)
    return result
  }

  function reopenDevice(id: string, operator: string) {
    const record = findRecord(id)
    if (!record) return { ok: false, message: '记录不存在' }
    const result = reopen(record, operator)
    if (result.ok) pushAuditFrom(record)
    return result
  }

  function addEvidenceId(id: string): string | undefined {
    const record = findRecord(id)
    if (!record) return undefined
    const evidenceId = newEvidenceId()
    record.evidenceIds.push(evidenceId)
    return evidenceId
  }

  function releaseStandard(
    family: string,
    familyName: string,
    changeNote: string,
    patchItems: Array<{ id: string; threshold?: number; limit?: string; requirement?: string }>,
    operator: string
  ): InspectionStandard {
    const standard = publishStandard(standards.value, family, familyName, operator, changeNote, patchItems)
    audit.value.unshift({
      id: `STD-AU-${standard.id}`,
      recordId: '—',
      action: '标准发布',
      operator,
      detail: `${standard.id} 已发布：${standard.changeNote}。仅对发布之后开始的检验任务生效，在途任务继续按开始时版本判定。`,
      createdAt: standard.publishedAt
    })
    return standard
  }

  function resetDemo() {
    const seed = buildSeed()
    standards.value = structuredClone(seedStandards)
    records.value = seed.records
    audit.value = seed.audit
  }

  watch([records, audit, standards], () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      standards: standards.value,
      records: records.value,
      audit: audit.value
    }))
  }, { deep: true })

  return {
    standards, records, audit, keyword, status, area, liveMessage,
    filtered, stats,
    findRecord, standardById,
    addRecord, saveRecord, adoptProposal, assignStandardVersion,
    transition, retest, reopenDevice, addEvidenceId,
    releaseStandard, resetDemo
  }
})
