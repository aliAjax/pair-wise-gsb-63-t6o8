export type InspectionStatus = '待检验' | '需整改' | '整改中' | '待复测' | '已关闭' | '停用' | '待复核'
export type RiskLevel = '低' | '中' | '高' | '紧急'
export type CheckResult = '正常' | '异常' | '不适用'

export interface StandardItem {
  id: string
  name: string
  limit: string
  method: string
}

/** 检验标准发布版本：按设备型号适用，发布后内容冻结、不再就地改写 */
export interface StandardVersion {
  id: string
  /** 适用设备型号，如 AM / RC / CR / WF */
  deviceModel: string
  modelName: string
  version: number
  /** 版本标签，如 V2 */
  label: string
  publishedAt: string
  publishedBy: string
  changeNote: string
  items: StandardItem[]
}

export interface InspectionItem {
  id: string
  name: string
  result: CheckResult
  reading: string
  /** 判定时使用的限值（来自标准快照，不随后续发布而变化） */
  limit: string
  note: string
}

export interface EvidenceRef {
  id: string
  name: string
  uploadedAt: string
  uploadedBy: string
}

/** 两个窗口先后保存同一条记录时，先保存一方的字段留档 */
export interface ConflictRevision {
  id: string
  recordId: string
  detectedAt: string
  resolvedAt: string | null
  /** 后保存的窗口（冲突修订最终并入的一方） */
  winnerOperator: string
  /** 先保存但被盖写的窗口责任人 */
  loserOperator: string
  reason: string
  /** 先保存一方的现场输入，逐条留档，不得丢失 */
  loserSnapshot: {
    assignedTo: string
    disposition: string
    evidenceIds: string[]
    items: InspectionItem[]
  }
  /** 后保存一方的输入，便于并排核对 */
  winnerSnapshot: {
    assignedTo: string
    disposition: string
    evidenceIds: string[]
    items: InspectionItem[]
  }
  status: '待解决' | '已并入'
}

/** 复测记录：失败继续停用并自动登记下一次复测，成功才允许恢复开放 */
export interface RetestRecord {
  id: string
  recordId: string
  round: number
  testedAt: string
  tester: string
  result: '通过' | '未通过'
  readings: Array<{ itemId: string; itemName: string; reading: string; limit: string; pass: boolean }>
  note: string
  /** 复测未通过时登记的下一次复测安排 */
  nextRetestDate: string | null
}

export interface InspectionRecord {
  id: string
  deviceCode: string
  deviceName: string
  /** 设备型号，对应检验标准 deviceModel */
  deviceModel: string
  area: string
  shift: string
  inspector: string
  inspectedAt: string
  status: InspectionStatus
  risk: RiskLevel
  stopped: boolean
  assignedTo: string
  dueDate: string
  items: InspectionItem[]
  /** 现场证据编号，多窗口保存时不允许丢失 */
  evidence: EvidenceRef[]
  /** 缺陷处置结论 */
  disposition: string
  /** 判定所依据的标准版本号 */
  standardVersion: number
  standardLabel: string
  /** 标准版本在任务开始（创建）时即冻结 */
  standardFrozenAt: string
  /** 无适用标准的旧记录进入待复核 */
  reviewNote: string
  retests: RetestRecord[]
  /** 下一次复测安排日期（复测失败后自动留下） */
  nextRetestDate: string | null
  /** 乐观锁：每次保存递增，用于识别两个窗口的并发覆盖 */
  revision: number
  /** 最近一次执行保存的窗口操作人，冲突时用于归属先保存一方 */
  lastSavedBy: string
  /** 遗留的记录展示版本号（每次保存 +1） */
  version: number
  createdAt: string
  updatedAt: string
}

export interface AuditEntry {
  id: string
  recordId: string
  action: string
  operator: string
  detail: string
  /** 该次判定/操作所依据的标准版本，便于沿版本追溯 */
  standardLabel: string | null
  createdAt: string
}

export interface InspectionDraft {
  deviceCode: string
  deviceName: string
  deviceModel: string
  area: string
  shift: string
  inspector: string
  risk: RiskLevel
  assignedTo: string
  dueDate: string
}
